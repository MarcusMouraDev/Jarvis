import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAgentCatalogFromDisk } from "@/core/agent-catalog";
import { closeCoreStore, openCoreStore, type CoreStore } from "@/core/core-store";
import { SafeCoreService } from "@/core/safe-core-service";
import {
  resetSafeCoreRuntimeForTests,
  setSafeCoreRuntimeForTests,
} from "@/core/safe-core-runtime";
import { GET } from "./route";

const originalDataDir = process.env.JARVIS_DATA_DIR;
const originalSafeCore = process.env.JARVIS_SAFE_AGENT_CORE;
const csrfToken = "csrf-event-route";

describe("GET /api/runs/[runId]/events", () => {
  let dataDir: string;
  let store: CoreStore;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-events-route-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    store = openCoreStore();
    store.createSafeSession({
      sessionId: "session-events",
      csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
      defaultAgentId: "Hermes",
      expiresAt: "2099-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
    });
    const orchestrator = {
      execute: vi.fn(async ({ runId }) => ({ status: "completed" as const, runId })),
      cancel: vi.fn(() => true),
      hasPendingContinuation: vi.fn(() => true),
      resumePendingTool: vi.fn(async ({ runId }) => ({
        status: "completed" as const,
        runId,
      })),
      discardPendingContinuation: vi.fn(),
    };
    const gateway = {
      decideApproval: vi.fn((input) =>
        store.decideSafeApproval({ ...input, now: "2026-08-08T10:05:00.000Z" }),
      ),
    };
    const catalog = loadAgentCatalogFromDisk();
    const service = new SafeCoreService({
      store,
      catalog,
      orchestrator,
      toolGateway: gateway,
      listWorkspaceNames: () => [],
    });
    setSafeCoreRuntimeForTests({ store, catalog, orchestrator, gateway, service });
  });

  afterEach(() => {
    resetSafeCoreRuntimeForTests();
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
    if (originalSafeCore === undefined) delete process.env.JARVIS_SAFE_AGENT_CORE;
    else process.env.JARVIS_SAFE_AGENT_CORE = originalSafeCore;
  });

  function eventRequest(runId: string, lastEventId?: string, csrf = csrfToken) {
    return new Request(`http://localhost/api/runs/${runId}/events`, {
      headers: {
        host: "localhost",
        origin: "http://localhost",
        cookie: "jarvis_session=session-events",
        "X-Jarvis-CSRF": csrf,
        ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
      },
    });
  }

  function terminalRun(runId = "run-events") {
    const run = store.createRun({
      runId,
      sessionId: "session-events",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "running",
    });
    const first = store.appendEvent({
      eventId: `${runId}-event-1`,
      runId,
      type: "text.delta",
      payload: { text: "one" },
    });
    const second = store.appendEvent({
      eventId: `${runId}-event-2`,
      runId,
      type: "run.completed",
      payload: { steps: 1 },
    });
    store.transitionRunStatus({
      runId,
      sessionId: "session-events",
      from: ["running"],
      to: "completed",
    });
    return { run, first, second };
  }

  it("replays persisted envelopes after Last-Event-ID with SSE headers", async () => {
    const { run, first, second } = terminalRun();
    const response = await GET(eventRequest(run.runId, first.eventId), {
      params: Promise.resolve({ runId: run.runId }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(body).not.toContain(first.eventId);
    expect(body).toContain(`id: ${second.eventId}`);
    expect(body).toContain('"v":1');
  });

  it("persists and emits protocol.error for an invalid replay cursor", async () => {
    const { run } = terminalRun("run-invalid-cursor");
    const response = await GET(eventRequest(run.runId, "foreign-event"), {
      params: Promise.resolve({ runId: run.runId }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("event: protocol.error");
    expect(body).toContain("invalid_last_event_id");
    expect(store.replayEvents(run.runId).at(-1)?.type).toBe("protocol.error");
  });

  it("requires CSRF and hides unknown or cross-session run IDs", async () => {
    const { run } = terminalRun("run-hidden");
    const unauthorized = await GET(eventRequest(run.runId, undefined, "wrong"), {
      params: Promise.resolve({ runId: run.runId }),
    });
    expect(unauthorized.status).toBe(401);

    const hidden = await GET(eventRequest("unknown-run"), {
      params: Promise.resolve({ runId: "unknown-run" }),
    });
    expect(hidden.status).toBe(404);
  });
});
