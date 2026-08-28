import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CSRF_STORAGE_KEY,
  ensureSafeSession,
  parseSafeEventStream,
  safeCoreFetch,
  streamRunEvents,
} from "./safe-core-client";
import { encodeSseEnvelope } from "@/core/safe-event-protocol";
import type { SafeEventEnvelope } from "@/core/safe-api-contract";

function envelope(
  overrides: Partial<SafeEventEnvelope> & Pick<SafeEventEnvelope, "eventId" | "seq" | "type">,
): SafeEventEnvelope {
  return {
    v: 1,
    runId: "run-1",
    ts: "2026-08-08T12:00:00.000Z",
    payload: {},
    ...overrides,
  };
}

function utf8Chunks(text: string, cuts: number[]): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const cut of cuts) {
    chunks.push(bytes.slice(start, cut));
    start = cut;
  }
  chunks.push(bytes.slice(start));
  return chunks;
}

async function collect(
  stream: AsyncIterable<SafeEventEnvelope>,
): Promise<SafeEventEnvelope[]> {
  const events: SafeEventEnvelope[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("safe-core-client", () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses SSE envelopes across UTF-8 chunk boundaries and ignores heartbeats", async () => {
    const first = envelope({ eventId: "event-1", seq: 1, type: "text.delta", payload: { text: "á" } });
    const second = envelope({ eventId: "event-2", seq: 2, type: "run.completed" });
    const body =
      encodeSseEnvelope(first) +
      `: heartbeat 2026-08-08T12:00:15.000Z\n\n` +
      encodeSseEnvelope(second);
    const chunks = utf8Chunks(body, [12, 45, 90]);

    const events = await collect(parseSafeEventStream(chunks));
    expect(events.map((event) => event.eventId)).toEqual(["event-1", "event-2"]);
  });

  it("treats malformed JSON as a typed protocol failure", async () => {
    const bad = new TextEncoder().encode("id: x\nevent: broken\ndata: {not-json\n\n");
    await expect(collect(parseSafeEventStream([bad]))).rejects.toThrow(/protocol/i);
  });

  it("aborts an in-flight SSE parse when the signal aborts", async () => {
    const controller = new AbortController();
    const first = envelope({ eventId: "event-1", seq: 1, type: "text.delta", payload: { text: "a" } });
    async function* chunks() {
      yield new TextEncoder().encode(encodeSseEnvelope(first));
      controller.abort();
      yield new TextEncoder().encode(
        encodeSseEnvelope(envelope({ eventId: "event-2", seq: 2, type: "run.completed" })),
      );
    }

    const events: SafeEventEnvelope[] = [];
    await expect(async () => {
      for await (const event of parseSafeEventStream(chunks(), controller.signal)) {
        events.push(event);
      }
    }).rejects.toThrow();
    expect(events.map((event) => event.eventId)).toEqual(["event-1"]);
  });

  it("bootstraps CSRF into sessionStorage and reuses it on protected fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            csrfToken: "csrf-token-1",
            defaultAgentId: "Hermes",
            expiresAt: "2099-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const session = await ensureSafeSession();
    expect(session.csrfToken).toBe("csrf-token-1");
    expect(sessionStorage.getItem(CSRF_STORAGE_KEY)).toContain("csrf-token-1");

    await safeCoreFetch("/api/agents");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/agents",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Jarvis-CSRF": "csrf-token-1" }),
        credentials: "same-origin",
      }),
    );

    await ensureSafeSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces parallel bootstraps into one request", async () => {
    const releases: Array<(value: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = Promise.all([ensureSafeSession(), ensureSafeSession()]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    for (const release of releases) {
      release(
        new Response(
          JSON.stringify({
            csrfToken: "csrf-shared",
            defaultAgentId: "Hermes",
            expiresAt: "2099-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    const [first, second] = await pending;
    expect(first.csrfToken).toBe("csrf-shared");
    expect(second.csrfToken).toBe("csrf-shared");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a protected fetch once after CSRF 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            csrfToken: "csrf-stale",
            defaultAgentId: "Hermes",
            expiresAt: "2099-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            csrfToken: "csrf-fresh",
            defaultAgentId: "Hermes",
            expiresAt: "2099-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await ensureSafeSession();
    const response = await safeCoreFetch("/api/runs", { method: "POST", body: "{}" });
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/runs",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Jarvis-CSRF": "csrf-fresh" }),
      }),
    );
  });

  it("streams run events with CSRF and Last-Event-ID headers", async () => {
    memory.set(
      CSRF_STORAGE_KEY,
      JSON.stringify({
        csrfToken: "csrf-token-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        defaultAgentId: "Hermes",
      }),
    );
    const first = envelope({ eventId: "event-1", seq: 1, type: "text.delta", payload: { text: "hi" } });
    const second = envelope({ eventId: "event-2", seq: 2, type: "run.completed" });
    const body = encodeSseEnvelope(first) + encodeSseEnvelope(second);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const events = await collect(
      streamRunEvents("run-1", "event-1", new AbortController().signal),
    );
    expect(events.map((event) => event.eventId)).toEqual(["event-1", "event-2"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1?stream=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Jarvis-CSRF": "csrf-token-1",
          "Last-Event-ID": "event-1",
        }),
      }),
    );
  });
});
