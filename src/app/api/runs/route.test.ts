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
import { GET, POST } from "./route";

const originalDataDir = process.env.JARVIS_DATA_DIR;
const originalSafeCore = process.env.JARVIS_SAFE_AGENT_CORE;
const csrfToken = "csrf-safe-runs";

describe("/api/runs safe-core switch", () => {
  let dataDir: string;
  let store: CoreStore;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-runs-route-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    store = openCoreStore();
    store.createSafeSession({
      sessionId: "session-routes",
      csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
      defaultAgentId: "Hermes",
      expiresAt: "2099-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
    });
    const orchestrator = {
      execute: vi.fn(async ({ runId }: { runId: string }) => ({
        status: "completed" as const,
        runId,
      })),
      cancel: vi.fn(() => true),
      hasPendingContinuation: vi.fn(() => true),
      resumePendingTool: vi.fn(async ({ runId }: { runId: string }) => ({
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

  function protectedRequest(
    url = "http://localhost/api/runs",
    init: RequestInit = {},
  ) {
    return new Request(url, {
      ...init,
      headers: {
        host: "localhost",
        origin: "http://localhost",
        cookie: "jarvis_session=session-routes",
        "X-Jarvis-CSRF": csrfToken,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  }

  it("preserves the legacy GET response while the safe flag is off", async () => {
    process.env.JARVIS_SAFE_AGENT_CORE = "0";
    const response = await GET(
      new Request("http://localhost/api/runs", { headers: { host: "localhost" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ runs: expect.any(Array) });
  });

  it("requires the protected session before safe run access", async () => {
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    const response = await POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello", workspace: { kind: "none" } }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("creates and lists only runs bound to the authenticated session", async () => {
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    const createdResponse = await POST(
      protectedRequest(undefined, {
        method: "POST",
        body: JSON.stringify({
          prompt: "safe request",
          agentId: "Hermes",
          workspace: { kind: "none" },
        }),
      }),
    );
    expect(createdResponse.status).toBe(202);
    const created = (await createdResponse.json()) as { run: { runId: string } };

    const listedResponse = await GET(protectedRequest());
    expect(listedResponse.status).toBe(200);
    expect(await listedResponse.json()).toMatchObject({
      runs: [expect.objectContaining({ runId: created.run.runId, agentId: "Hermes" })],
    });
    expect(listedResponse.headers.get("cache-control")).toBe("no-store");
    expect(listedResponse.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("returns a sanitized 400 for invalid JSON", async () => {
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    const response = await POST(
      protectedRequest(undefined, { method: "POST", body: "not-json" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
  });
});
