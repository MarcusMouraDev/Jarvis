import { basename } from "node:path";
import { homedir } from "node:os";
import { ZodError } from "zod";
import {
  assertResolvedWorkspaceForAgent,
  getAgent,
  resolveWorkspaceForAgent,
  type AgentCatalog,
} from "./agent-catalog";
import type {
  CoreEvent,
  CoreRun,
  CoreSession,
  CoreStore,
  JsonValue,
  SafeToolApproval,
} from "./core-store";
import { redactStructured } from "./policy";
import {
  approvalDecisionRequestSchema,
  createRunRequestSchema,
  safeAgentIds,
  updateSessionRequestSchema,
  type SafeAgentSummary,
  type SafeApprovalView,
  type SafeRunSnapshot,
  type SafeRunSummary,
  type SafeWorkspaceChoice,
  type SafeWorkspaceView,
} from "./safe-api-contract";
import type {
  ExecuteSafeRunInput,
  SafeOrchestratorResult,
} from "./safe-orchestrator";
import { toSafeEventEnvelope } from "./safe-event-protocol";
import { resolveWorkspace } from "./workspace-policy";

interface ContinuationBinding {
  sessionId: string;
  runId: string;
  invocationId: string;
}

export interface SafeCoreOrchestratorPort {
  execute(input: ExecuteSafeRunInput): Promise<SafeOrchestratorResult>;
  cancel(input: { sessionId: string; runId: string }): boolean;
  hasPendingContinuation(input: ContinuationBinding): boolean;
  resumePendingTool(input: ContinuationBinding): Promise<SafeOrchestratorResult>;
  discardPendingContinuation(input: ContinuationBinding): void;
}

export interface SafeCoreToolGatewayPort {
  decideApproval(input: {
    approvalId: string;
    sessionId: string;
    decision: "approved" | "denied";
  }): SafeToolApproval;
}

export interface SafeCoreServiceOptions {
  store: CoreStore;
  catalog: AgentCatalog;
  orchestrator: SafeCoreOrchestratorPort;
  toolGateway: SafeCoreToolGatewayPort;
  projectsRoot?: string;
  listWorkspaceNames?: () => string[];
}

export class SafeCoreServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "SafeCoreServiceError";
  }
}

function invalidRequest(): never {
  throw new SafeCoreServiceError("invalid_request", 400);
}

function parseInput<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ZodError) invalidRequest();
    throw error;
  }
}

function policyError(error: unknown): never {
  if (error instanceof SafeCoreServiceError) throw error;
  throw new SafeCoreServiceError("workspace_policy_rejected", 422);
}

function workspacePath(run: CoreRun): string | null {
  const workspace = run.workspace;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return null;
  return typeof workspace.path === "string" ? workspace.path : null;
}

function workspaceView(run: CoreRun): SafeWorkspaceView {
  const workspace = run.workspace;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    return { kind: "none", label: "Sem workspace" };
  }
  if (workspace.kind === "existing" || workspace.kind === "new") {
    const absolute = typeof workspace.path === "string" ? workspace.path : "";
    const name = typeof workspace.name === "string" ? workspace.name : basename(absolute);
    return {
      kind: workspace.kind,
      name,
      label: name || "Workspace",
    };
  }
  return { kind: "none", label: "Sem workspace" };
}

function replacePrivatePaths(value: string, paths: readonly string[]): string {
  return paths
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (current, privatePath) =>
        current
          .split(privatePath)
          .join(privatePath === homedir() ? "<home>" : "<workspace>")
          .split(JSON.stringify(privatePath).slice(1, -1))
          .join(privatePath === homedir() ? "<home>" : "<workspace>"),
      value,
    );
}

function publicJson(value: JsonValue, run: CoreRun): JsonValue {
  const paths = [workspacePath(run), homedir()].filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  const visit = (entry: JsonValue): JsonValue => {
    if (typeof entry === "string") return replacePrivatePaths(entry, paths);
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry).map(([key, child]) => [key, visit(child)]),
      );
    }
    return entry;
  };
  return visit(redactStructured(value));
}

function approvalPreview(events: CoreEvent[], approvalId: string): JsonValue {
  const event = [...events].reverse().find((candidate) => {
    if (candidate.type !== "tool.approval_required") return false;
    const payload = candidate.payload;
    return (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      payload.approvalId === approvalId
    );
  });
  if (!event || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    return {};
  }
  return event.payload.preview ?? {};
}

function runSummary(run: CoreRun): SafeRunSummary {
  return {
    runId: run.runId,
    agentId: run.agentId,
    privacyClass: run.privacyClass,
    requestedModel: run.requestedModel,
    workspace: workspaceView(run),
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export class SafeCoreService {
  constructor(private readonly options: SafeCoreServiceOptions) {}

  updateDefaultAgent(session: CoreSession, input: unknown): CoreSession {
    const parsed = parseInput(() => updateSessionRequestSchema.parse(input));
    if (!getAgent(this.options.catalog, parsed.defaultAgentId)) invalidRequest();
    return this.options.store.updateSessionDefaultAgent(
      session.sessionId,
      parsed.defaultAgentId,
    );
  }

  listAgents(): SafeAgentSummary[] {
    return safeAgentIds.map((id) => {
      const agent = this.options.catalog.agents[id];
      const model = this.options.catalog.models[agent.model];
      return {
        id,
        modelAlias: agent.model,
        provider: model?.provider ?? "unavailable",
        workspaceMode: agent.workspaceMode,
        mutationMode: agent.mutationMode,
        memoryPolicy: agent.memoryPolicy,
        budgetUsd: agent.budgetUsd,
        timeoutMs: agent.timeoutMs,
      };
    });
  }

  listWorkspaces(_session: CoreSession): SafeWorkspaceChoice[] {
    void _session;
    const names = this.options.listWorkspaceNames?.() ?? [];
    return [
      { kind: "none", label: "Sem workspace" },
      ...[...new Set(names)]
        .filter((name) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name))
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({ kind: "existing" as const, name, label: name })),
    ];
  }

  listRuns(session: CoreSession, limit = 20): SafeRunSummary[] {
    return this.options.store
      .listRunsForSession(session.sessionId, limit)
      .map(runSummary);
  }

  async createRun(session: CoreSession, input: unknown): Promise<SafeRunSnapshot> {
    const parsed = parseInput(() => createRunRequestSchema.parse(input));
    const agentId = parsed.agentId ?? session.defaultAgentId ?? "Hermes";
    const agent = getAgent(this.options.catalog, agentId);
    if (!agent) invalidRequest();

    let resolvedWorkspace;
    try {
      const workspaceRequest =
        parsed.workspace.kind === "none"
          ? ({ kind: "none" } as const)
          : parsed.workspace.kind === "existing"
            ? ({ kind: "existing", path: parsed.workspace.name } as const)
            : ({ kind: "new", name: parsed.workspace.name } as const);
      resolveWorkspaceForAgent(this.options.catalog, agentId, workspaceRequest);
      resolvedWorkspace = resolveWorkspace(workspaceRequest, {
        projectsRoot: this.options.projectsRoot,
      });
      assertResolvedWorkspaceForAgent(this.options.catalog, agentId, resolvedWorkspace);
    } catch (error) {
      policyError(error);
    }

    const run = this.options.store.createRun({
      sessionId: session.sessionId,
      agentId,
      privacyClass: parsed.privacyClass,
      requestedModel: agent.model,
      workspace: resolvedWorkspace,
      status: "pending",
    });
    this.options.store.createMessage({
      sessionId: session.sessionId,
      runId: run.runId,
      role: "user",
      content: { text: parsed.prompt },
    });
    this.options.store.appendEvent({
      runId: run.runId,
      type: "run.created",
      payload: {
        agentId,
        privacyClass: parsed.privacyClass,
        requestedModel: agent.model,
        workspace: workspaceView(run),
      },
    });

    void this.options.orchestrator
      .execute({
        sessionId: session.sessionId,
        runId: run.runId,
        prompt: parsed.prompt,
        context: { source: "composer" },
        allowPaidProvider: parsed.allowPaidProvider,
        maxCostUsd: parsed.maxCostUsd,
        timeoutMs: parsed.timeoutMs,
      })
      .catch(() => {
        try {
          this.failOrchestrationStart(run);
        } catch {
          // A concurrent terminal transition wins; never leak or rethrow provider details.
        }
      });

    return this.getRunSnapshot(session, run.runId)!;
  }

  getRunSnapshot(session: CoreSession, runId: string): SafeRunSnapshot | null {
    const run = this.options.store.getRun(runId);
    if (!run || run.sessionId !== session.sessionId) return null;
    const events = this.options.store.replayEvents(run.runId);
    const approvals: SafeApprovalView[] = this.options.store
      .listApprovalsForRun(session.sessionId, run.runId)
      .map((approval) => ({
        approvalId: approval.approvalId,
        invocationId: approval.invocationId,
        toolId: approval.toolId,
        status: approval.status,
        target: publicJson(
          { toolId: approval.toolId, workspace: workspaceView(run) },
          run,
        ),
        effect: publicJson(approval.effect, run),
        preview: publicJson(approvalPreview(events, approval.approvalId), run),
        expiresAt: approval.expiresAt,
        createdAt: approval.createdAt,
      }));
    return {
      run: runSummary(run),
      messages: this.options.store
        .listMessagesForRun(session.sessionId, run.runId)
        .map((message) => ({
          messageId: message.messageId,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        })),
      events: events.map((event) =>
        toSafeEventEnvelope(
          event,
          workspacePath(run) ? [workspacePath(run)!] : [],
        ),
      ),
      approvals,
    };
  }

  cancelRun(session: CoreSession, runId: string): SafeRunSnapshot | null {
    const run = this.options.store.getRun(runId);
    if (!run || run.sessionId !== session.sessionId) return null;
    const cancelled = this.options.orchestrator.cancel({
      sessionId: session.sessionId,
      runId,
    });
    if (!cancelled && run.status === "pending") {
      this.options.store.appendEvent({
        runId,
        type: "abort",
        payload: { reason: "cancelled" },
      });
      this.options.store.transitionRunStatus({
        runId,
        sessionId: session.sessionId,
        from: ["pending"],
        to: "cancelled",
      });
    }
    return this.getRunSnapshot(session, runId);
  }

  async decideApproval(
    session: CoreSession,
    approvalId: string,
    input: unknown,
  ): Promise<SafeRunSnapshot> {
    const parsed = parseInput(() => approvalDecisionRequestSchema.parse(input));
    const approval = this.options.store.getSafeApproval(approvalId);
    if (!approval || approval.sessionId !== session.sessionId) {
      throw new SafeCoreServiceError("approval_not_found", 404);
    }
    const binding = {
      sessionId: session.sessionId,
      runId: approval.runId,
      invocationId: approval.invocationId,
    };
    if (
      parsed.decision === "approved" &&
      !this.options.orchestrator.hasPendingContinuation(binding)
    ) {
      throw new SafeCoreServiceError("continuation_unavailable", 409);
    }

    const decided = this.options.toolGateway.decideApproval({
      approvalId,
      sessionId: session.sessionId,
      decision: parsed.decision,
    });
    if (decided.status === "approved") {
      await this.options.orchestrator.resumePendingTool(binding);
    } else {
      this.options.orchestrator.discardPendingContinuation(binding);
      this.options.orchestrator.cancel({
        sessionId: session.sessionId,
        runId: approval.runId,
      });
    }
    return this.getRunSnapshot(session, approval.runId)!;
  }

  private failOrchestrationStart(run: CoreRun): void {
    const current = this.options.store.getRun(run.runId);
    if (!current || !["pending", "running"].includes(current.status)) return;
    this.options.store.appendEvent({
      runId: run.runId,
      type: "protocol.error",
      payload: { code: "orchestrator_start_failed" },
    });
    this.options.store.transitionRunStatus({
      runId: run.runId,
      sessionId: run.sessionId!,
      from: [current.status],
      to: "failed",
    });
  }
}
