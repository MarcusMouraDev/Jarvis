import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeCoreStore, openCoreStore, type CoreStore } from "./core-store";
import {
  encodeSseEnvelope,
  streamStoredEvents,
  toSafeEventEnvelope,
} from "./safe-event-protocol";

const originalDataDir = process.env.JARVIS_DATA_DIR;

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let value = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return value;
    value += decoder.decode(chunk.value, { stream: true });
  }
}

describe("safe event protocol", () => {
  let dataDir: string;
  let store: CoreStore;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-event-protocol-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    store = openCoreStore();
    store.createSession({ sessionId: "session-events" });
    store.createRun({
      runId: "run-events",
      sessionId: "session-events",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "existing", path: "/private/workspace" },
      status: "running",
    });
  });

  afterEach(() => {
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
  });

  it("maps a stored event to a version-one SSE envelope", () => {
    const event = store.appendEvent({
      eventId: "event-1",
      runId: "run-events",
      type: "run.created",
      payload: { workspace: "/private/workspace/src" },
      createdAt: "2026-08-08T10:00:00.000Z",
    });
    const envelope = toSafeEventEnvelope(event, ["/private/workspace"]);

    expect(envelope).toEqual({
      v: 1,
      eventId: "event-1",
      runId: "run-events",
      seq: 1,
      ts: "2026-08-08T10:00:00.000Z",
      type: "run.created",
      payload: { workspace: "<workspace>/src" },
    });
    expect(encodeSseEnvelope(envelope)).toBe(
      `id: event-1\nevent: run.created\ndata: ${JSON.stringify(envelope)}\n\n`,
    );
  });

  it("replays strictly after a sequence and closes a terminal run", async () => {
    const first = store.appendEvent({
      eventId: "event-1",
      runId: "run-events",
      type: "text.delta",
      payload: { text: "one" },
    });
    const second = store.appendEvent({
      eventId: "event-2",
      runId: "run-events",
      type: "run.completed",
      payload: { steps: 1 },
    });
    store.transitionRunStatus({
      runId: "run-events",
      sessionId: "session-events",
      from: ["running"],
      to: "completed",
    });

    const body = await readStream(
      streamStoredEvents({
        store,
        runId: "run-events",
        afterSeq: first.seq,
        signal: new AbortController().signal,
      }),
    );

    expect(body).not.toContain("event-1");
    expect(body).toContain(`id: ${second.eventId}`);
    expect(store.sequenceForEvent("run-events", second.eventId)).toBe(second.seq);
  });

  it("emits a heartbeat at the injected fifteen-second boundary", async () => {
    let nowMs = 0;
    const abort = new AbortController();
    const stream = streamStoredEvents({
      store,
      runId: "run-events",
      afterSeq: 0,
      signal: abort.signal,
      heartbeatMs: 15_000,
      pollMs: 5_000,
      now: () => new Date(nowMs),
      wait: async (ms) => {
        nowMs += ms;
      },
    });
    const reader = stream.getReader();
    const first = await reader.read();

    expect(new TextDecoder().decode(first.value)).toBe(
      ": heartbeat 1970-01-01T00:00:15.000Z\n\n",
    );
    abort.abort();
    await reader.cancel();
  });

  it("stops polling when the request signal aborts", async () => {
    const abort = new AbortController();
    let waits = 0;
    const stream = streamStoredEvents({
      store,
      runId: "run-events",
      afterSeq: 0,
      signal: abort.signal,
      wait: async () => {
        waits += 1;
        abort.abort();
      },
    });

    await expect(readStream(stream)).resolves.toBe("");
    expect(waits).toBe(1);
  });
});
