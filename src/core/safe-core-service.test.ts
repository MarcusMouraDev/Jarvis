import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAgentCatalogFromDisk } from "./agent-catalog";
import {
  closeCoreStore,
  openCoreStore,
  type CoreSession,
  type CoreStore,
} from "./core-store";
import {
  SafeCoreService,
  SafeCoreServiceError,
  type SafeCoreOrchestratorPort,
  type SafeCoreToolGatewayPort,
} from "./safe-core-service";

const originalDataDir = process.env.JARVIS_DATA_DIR;

describe("SafeCoreService", () => {
  let dataDir: string;
  let store: CoreStore;
  let session: CoreSession;
  let orchestrator: SafeCoreOrchestratorPort;
  let gateway: SafeCoreToolGatewayPort;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-safe-service-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    store = openCoreStore();
    session = store.createSafeSession({
      sessionId: "session-safe",
      csrfHash: "a".repeat(64),
      defaultAgentId: "Hermes",
      expiresAt: "2026-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
    });
    orchestrator = {
      execute: vi.fn(async ({ runId }) => ({ status: "completed" as const, runId })),
      cancel: vi.fn(() => true),
      hasPendingContinuation: vi.fn(() => true),
      resumePendingTool: vi.fn(async ({ runId }) => ({
        status: "completed" as const,
        runId,
      })),
      discardPendingContinuation: vi.fn(),
    };
    gateway = {
      decideApproval: vi.fn((input) =>
        store.decideSafeApproval({ ...input, now: "2026-08-08T10:05:00.000Z" }),
      ),
    };
  });

  afterEach(() => {
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
  });

  function service(options: { workspaceNames?: string[]; projectsRoot?: string } = {}) {
    return new SafeCoreService({
      store,
      catalog: loadAgentCatalogFromDisk(),
      orchestrator,
      toolGateway: gateway,
      projectsRoot: options.projectsRoot,
      listWorkspaceNames: () => options.workspaceNames ?? ["jarvis", "private-project"],
    });
  }

  it("updates the default agent and returns path-free catalog/workspace summaries", () => {
    const core = service({ workspaceNames: ["jarvis", "client-secret"] });

    expect(core.updateDefaultAgent(session, { defaultAgentId: "Planner" })).toMatchObject({
      defaultAgentId: "Planner",
    });
    expect(core.listAgents().map((agent) => agent.id)).toEqual([
      "Hermes",
      "Planner",
      "Developer",
      "Builder",
    ]);
    const serialized = JSON.stringify(core.listWorkspaces(session));
    expect(serialized).toContain("jarvis");
    expect(serialized).not.toContain(path.dirname(process.cwd()));
    expect(serialized).not.toContain("path");
  });

  it("creates one immutable run, persists no raw prompt event and isolates snapshots", async () => {
    const core = service();
    const snapshot = await core.createRun(session, {
      prompt: "Do not publish this raw prompt",
      agentId: "Hermes",
      privacyClass: "internal",
      workspace: { kind: "none" },
    });

    expect(snapshot.run).toMatchObject({
      agentId: "Hermes",
      requestedModel: "cursor-text",
      workspace: { kind: "none", label: "Sem workspace" },
    });
    expect(orchestrator.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.sessionId,
        runId: snapshot.run.runId,
        prompt: "Do not publish this raw prompt",
      }),
    );
    expect(JSON.stringify(snapshot.events)).not.toContain("Do not publish this raw prompt");

    store.createSafeSession({
      sessionId: "session-other",
      csrfHash: "b".repeat(64),
      defaultAgentId: "Hermes",
      expiresAt: "2026-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
    });
    const other = store.getSession("session-other")!;
    expect(core.getRunSnapshot(other, snapshot.run.runId)).toBeNull();
    expect(core.listRuns(other)).toEqual([]);
  });

  it("rejects an agent/workspace mismatch before creating a run", async () => {
    const core = service();

    await expect(
      core.createRun(session, {
        prompt: "Develop without a repository",
        agentId: "Developer",
        workspace: { kind: "none" },
      }),
    ).rejects.toBeInstanceOf(SafeCoreServiceError);
    expect(store.listRunsForSession(session.sessionId)).toEqual([]);
    expect(orchestrator.execute).not.toHaveBeenCalled();
  });

  it("persists a sanitized terminal protocol error when orchestration cannot start", async () => {
    vi.mocked(orchestrator.execute).mockRejectedValue(
      new Error("credential=/Users/example/private-value"),
    );
    const core = service();

    const created = await core.createRun(session, {
      prompt: "Start safely",
      workspace: { kind: "none" },
    });
    await Promise.resolve();

    const snapshot = core.getRunSnapshot(session, created.run.runId)!;
    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.events.at(-1)).toMatchObject({
      type: "protocol.error",
      payload: { code: "orchestrator_start_failed" },
    });
    expect(JSON.stringify(snapshot.events)).not.toContain("private-value");
  });

  it("checks continuation custody before approving and resumes the same run", async () => {
    const core = service();
    const run = store.createRun({
      runId: "run-approval",
      sessionId: session.sessionId,
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "waiting_approval",
    });
    store.createSafeInvocation({
      invocationId: "invocation-approval",
      approvalId: "approval-1",
      sessionId: session.sessionId,
      runId: run.runId,
      toolId: "file.patch",
      toolVersion: "1.0.0",
      input: { diff: "bound" },
      inputDigest: "b".repeat(64),
      workspace: { kind: "none" },
      workspaceDigest: "c".repeat(64),
      bindingDigest: "d".repeat(64),
      effect: { target: "src/a.ts", operation: "patch" },
      sideEffect: "local",
      idempotent: false,
      createdAt: "2026-08-08T10:00:00.000Z",
      expiresAt: "2026-08-08T10:10:00.000Z",
    });
    store.appendEvent({
      runId: run.runId,
      type: "tool.approval_required",
      payload: {
        approvalId: "approval-1",
        invocationId: "invocation-approval",
        preview: { diff: "sanitized preview" },
      },
    });

    await core.decideApproval(session, "approval-1", { decision: "approved" });

    expect(orchestrator.hasPendingContinuation).toHaveBeenCalledBefore(
      gateway.decideApproval as ReturnType<typeof vi.fn>,
    );
    expect(gateway.decideApproval).toHaveBeenCalledWith({
      approvalId: "approval-1",
      sessionId: session.sessionId,
      decision: "approved",
    });
    expect(orchestrator.resumePendingTool).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      runId: run.runId,
      invocationId: "invocation-approval",
    });
    expect(store.getSafeApproval("approval-1")?.status).toBe("approved");
  });

  it("leaves approval pending when an exact continuation is unavailable", async () => {
    vi.mocked(orchestrator.hasPendingContinuation).mockReturnValue(false);
    const core = service();
    const run = store.createRun({
      runId: "run-unavailable",
      sessionId: session.sessionId,
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "waiting_approval",
    });
    store.createSafeInvocation({
      invocationId: "invocation-unavailable",
      approvalId: "approval-unavailable",
      sessionId: session.sessionId,
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

    await expect(
      core.decideApproval(session, "approval-unavailable", {
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "continuation_unavailable" });
    expect(gateway.decideApproval).not.toHaveBeenCalled();
    expect(store.getSafeApproval("approval-unavailable")?.status).toBe("pending");
  });

  it("denies an approval, discards its continuation and cancels the run", async () => {
    const core = service();
    const run = store.createRun({
      runId: "run-denied",
      sessionId: session.sessionId,
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "waiting_approval",
    });
    store.createSafeInvocation({
      invocationId: "invocation-denied",
      approvalId: "approval-denied",
      sessionId: session.sessionId,
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

    await core.decideApproval(session, "approval-denied", { decision: "denied" });

    expect(orchestrator.discardPendingContinuation).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      runId: run.runId,
      invocationId: "invocation-denied",
    });
    expect(orchestrator.cancel).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      runId: run.runId,
    });
    expect(store.getSafeApproval("approval-denied")?.status).toBe("denied");
  });
});
