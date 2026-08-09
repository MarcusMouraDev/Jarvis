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
import { GET as agentsGET } from "./agents/route";
import { GET as workspacesGET } from "./workspaces/route";
import { PATCH as sessionPATCH } from "./session/bootstrap/route";
import { GET as runGET } from "./runs/[runId]/route";
import { POST as cancelPOST } from "./runs/[runId]/cancel/route";
import { POST as approvalPOST } from "./approvals/[approvalId]/route";

const originalDataDir = process.env.JARVIS_DATA_DIR;
const originalSafeCore = process.env.JARVIS_SAFE_AGENT_CORE;
const csrfToken = "csrf-safe-routes";

describe("safe-core JSON routes", () => {
  let dataDir: string;
  let store: CoreStore;
  let orchestrator: {
    execute: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    hasPendingContinuation: ReturnType<typeof vi.fn>;
    resumePendingTool: ReturnType<typeof vi.fn>;
    discardPendingContinuation: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-safe-routes-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    store = openCoreStore();
    store.createSafeSession({
      sessionId: "session-routes",
      csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
      defaultAgentId: "Hermes",
      expiresAt: "2099-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
    });
    orchestrator = {
      execute: vi.fn(async ({ runId }) => ({ status: "completed", runId })),
      cancel: vi.fn(() => true),
      hasPendingContinuation: vi.fn(() => true),
      resumePendingTool: vi.fn(async ({ runId }) => ({ status: "completed", runId })),
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
      listWorkspaceNames: () => ["jarvis"],
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

  function request(url: string, init: RequestInit = {}) {
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

  it("returns the agent catalog and path-free workspace choices", async () => {
    const agents = await agentsGET(request("http://localhost/api/agents"));
    const workspaces = await workspacesGET(
      request("http://localhost/api/workspaces"),
    );
    expect(agents.status).toBe(200);
    const agentBody = (await agents.json()) as {
      agents: Array<{ id: string; modelAlias: string }>;
    };
    expect(agentBody.agents[0]).toMatchObject({
      id: "Hermes",
      modelAlias: "cursor-text",
    });
    const workspaceBody = await workspaces.text();
    expect(workspaceBody).toContain("jarvis");
    expect(workspaceBody).not.toContain(process.cwd());
    expect(workspaceBody).not.toContain('"path"');
  });

  it("returns disabled before constructing safe runtime state", async () => {
    resetSafeCoreRuntimeForTests();
    process.env.JARVIS_SAFE_AGENT_CORE = "0";
    process.env.JARVIS_MAX_RUN_TIMEOUT_MS = "invalid";
    try {
      const response = await agentsGET(
        new Request("http://localhost/api/agents", {
          headers: { host: "localhost" },
        }),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "safe_core_disabled" });
    } finally {
      delete process.env.JARVIS_MAX_RUN_TIMEOUT_MS;
    }
  });

  it("updates only a validated session default agent", async () => {
    const response = await sessionPATCH(
      request("http://localhost/api/session/bootstrap", {
        method: "PATCH",
        body: JSON.stringify({ defaultAgentId: "Planner" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ defaultAgentId: "Planner" });
    expect(store.getSession("session-routes")?.defaultAgentId).toBe("Planner");
  });

  it("gets and cancels a same-session run while hiding cross-session identifiers", async () => {
    const run = store.createRun({
      runId: "run-route",
      sessionId: "session-routes",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "running",
    });
    const context = { params: Promise.resolve({ runId: run.runId }) };
    const detail = await runGET(
      request(`http://localhost/api/runs/${run.runId}`),
      context,
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ run: { runId: run.runId } });

    const cancelled = await cancelPOST(
      request(`http://localhost/api/runs/${run.runId}/cancel`, { method: "POST" }),
      context,
    );
    expect(cancelled.status).toBe(200);
    expect(orchestrator.cancel).toHaveBeenCalledWith({
      sessionId: "session-routes",
      runId: run.runId,
    });

    const hidden = await runGET(
      request("http://localhost/api/runs/not-owned"),
      { params: Promise.resolve({ runId: "not-owned" }) },
    );
    expect(hidden.status).toBe(404);
  });

  it("decides an exact approval and resumes its same run", async () => {
    const run = store.createRun({
      runId: "run-approval",
      sessionId: "session-routes",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "waiting_approval",
    });
    store.createSafeInvocation({
      invocationId: "invocation-route",
      approvalId: "approval-route",
      sessionId: "session-routes",
      runId: run.runId,
      toolId: "file.patch",
      toolVersion: "1.0.0",
      input: { diff: "bound" },
      inputDigest: "b".repeat(64),
      workspace: { kind: "none" },
      workspaceDigest: "c".repeat(64),
      bindingDigest: "d".repeat(64),
      effect: { target: "src/a.ts" },
      sideEffect: "local",
      idempotent: false,
      createdAt: "2026-08-08T10:00:00.000Z",
      expiresAt: "2026-08-08T10:10:00.000Z",
    });

    const response = await approvalPOST(
      request("http://localhost/api/approvals/approval-route", {
        method: "POST",
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ approvalId: "approval-route" }) },
    );
    expect(response.status).toBe(200);
    expect(orchestrator.resumePendingTool).toHaveBeenCalledWith({
      sessionId: "session-routes",
      runId: run.runId,
      invocationId: "invocation-route",
    });
  });
});
