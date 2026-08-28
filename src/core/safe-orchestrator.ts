import { createHash, randomUUID } from "node:crypto";
import { toJSONSchema } from "zod";
import { getAgent, type AgentCatalog, type AgentDefinition } from "./agent-catalog";
import type { CoreEvent, CoreRun, CoreStore, JsonValue } from "./core-store";
import { buildSafeFallbackAliases, selectSafeModelAlias } from "./model-gateway";
import type {
  SafeModelAdapter,
  SafeModelEvent,
  SafeModelMessage,
  SafeModelToolDefinition,
} from "./safe-model-adapters";
import { getSafeToolManifest } from "./safe-tool-manifests";
import type { GatewayResult } from "./tool-gateway";
import { stableJson } from "@/lib/stable-json";
import {
  compileJarvisSystemInstruction,
  loadJarvisSoulPolicy,
  type JarvisSoulPolicy,
} from "./jarvis-soul";

const MAX_STEPS = 8;

type AdapterAlias = SafeModelAdapter["alias"];
type AdapterMap = Partial<Record<AdapterAlias, SafeModelAdapter>>;

export interface OrchestratorToolGateway {
  invoke(request: {
    sessionId: string;
    runId: string;
    toolId: string;
    input: unknown;
  }): Promise<GatewayResult>;
  resume(request: {
    sessionId: string;
    runId: string;
    invocationId: string;
    input: unknown;
  }): Promise<GatewayResult>;
}

export interface SafeModelOrchestratorOptions {
  store: CoreStore;
  catalog: AgentCatalog;
  adapters: AdapterMap;
  toolGateway: OrchestratorToolGateway;
  serverMaxTimeoutMs: number;
  serverMaxBudgetUsd: number;
  soulPolicy?: JarvisSoulPolicy;
}

export interface ExecuteSafeRunInput {
  sessionId: string;
  runId: string;
  prompt: string;
  context: JsonValue;
  allowPaidProvider?: boolean;
  approvedCloudEgressDigest?: string;
  maxCostUsd?: number;
  timeoutMs?: number;
}

export interface ResumeSafeToolInput {
  sessionId: string;
  runId: string;
  invocationId: string;
  toolInput: JsonValue;
  prompt: string;
  context: JsonValue;
}

export type SafeOrchestratorResult =
  | { status: "completed"; runId: string }
  | { status: "cancelled"; runId: string }
  | { status: "failed"; runId: string; reason: string }
  | {
      status: "approval_required";
      runId: string;
      invocationId: string;
      approvalId: string;
      expiresAt: string;
      preview: JsonValue;
    };

interface BoundRunInput {
  prompt: string;
  context: JsonValue;
  inputDigest: string;
  allowPaidProvider: boolean;
  approvedCloudEgressDigest: string | null;
  maxCostUsd: number | null;
  timeoutMs: number | null;
  soulPolicyDigest: string;
}

interface PendingToolCall {
  invocationId: string;
  callId: string;
  toolId: string;
  input: JsonValue;
  signature: string;
}

interface LoopState {
  run: CoreRun;
  agent: AgentDefinition;
  bound: BoundRunInput;
  messages: SafeModelMessage[];
  seenToolCalls: Set<string>;
  stepCount: number;
  fallbackCount: number;
  spentUsd: number;
  signal: AbortSignal;
}

interface ActiveRun {
  sessionId: string;
  controller: AbortController;
}

interface PendingContinuation {
  sessionId: string;
  runId: string;
  invocationId: string;
  toolInput: JsonValue;
  prompt: string;
  context: JsonValue;
}

type PendingContinuationBinding = Pick<
  PendingContinuation,
  "sessionId" | "runId" | "invocationId"
>;

function asRecord(value: JsonValue): { [key: string]: JsonValue } | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        entry === undefined ? [] : [[key, asJsonValue(entry)]],
      ),
    );
  }
  throw new TypeError("orchestrator_value_not_json");
}

function digest(value: JsonValue): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function toolCallSignature(toolId: string, input: JsonValue): string {
  return digest({ toolId, input });
}

function modelContent(prompt: string, context: JsonValue): string {
  return context === null ? prompt : `${prompt}\n\nContext:\n${stableJson(context)}`;
}

function eventPayload(event: SafeModelEvent): JsonValue {
  return asJsonValue(
    Object.fromEntries(Object.entries(event).filter(([key]) => key !== "type")),
  );
}

function errorReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "orchestrator_failed";
}

function numberField(record: { [key: string]: JsonValue }, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseBoundInput(
  event: CoreEvent,
  prompt: string,
  context: JsonValue,
  soulPolicyDigest: string,
): BoundRunInput {
  const payload = asRecord(event.payload);
  if (!payload || typeof payload.inputDigest !== "string") {
    throw new Error("run_input_not_bound");
  }
  if (digest({ prompt, context }) !== payload.inputDigest) {
    throw new Error("run_input_binding_mismatch");
  }
  if (typeof payload.soulPolicyDigest === "string" && payload.soulPolicyDigest !== soulPolicyDigest) {
    throw new Error("soul_policy_mismatch");
  }
  return {
    prompt,
    context,
    inputDigest: payload.inputDigest,
    allowPaidProvider: payload.allowPaidProvider === true,
    approvedCloudEgressDigest:
      typeof payload.approvedCloudEgressDigest === "string"
        ? payload.approvedCloudEgressDigest
        : null,
    maxCostUsd: typeof payload.maxCostUsd === "number" ? payload.maxCostUsd : null,
    timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : null,
    soulPolicyDigest:
      typeof payload.soulPolicyDigest === "string" ? payload.soulPolicyDigest : soulPolicyDigest,
  };
}

function pendingToolCall(events: CoreEvent[], invocationId: string): PendingToolCall {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "tool.approval_required") continue;
    const payload = asRecord(event.payload);
    if (
      payload?.invocationId === invocationId &&
      typeof payload.callId === "string" &&
      typeof payload.toolId === "string" &&
      payload.input !== undefined
    ) {
      return {
        invocationId,
        callId: payload.callId,
        toolId: payload.toolId,
        input: payload.input,
        signature:
          typeof payload.signature === "string"
            ? payload.signature
            : toolCallSignature(payload.toolId, payload.input),
      };
    }
  }
  throw new Error("pending_tool_call_not_found");
}

function reconstructMessages(
  events: CoreEvent[],
  prompt: string,
  context: JsonValue,
  inputOverrides: ReadonlyMap<string, JsonValue> = new Map(),
): SafeModelMessage[] {
  const messages: SafeModelMessage[] = [
    { role: "user", content: modelContent(prompt, context) },
  ];
  const calls = new Map<
    string,
    { callId: string; toolId: string; input: JsonValue }
  >();
  for (const event of events) {
    const payload = asRecord(event.payload);
    if (
      event.type === "tool.call" &&
      payload &&
      typeof payload.callId === "string" &&
      typeof payload.toolId === "string" &&
      payload.input !== undefined
    ) {
      calls.set(payload.callId, {
        callId: payload.callId,
        toolId: payload.toolId,
        input: inputOverrides.get(payload.callId) ?? payload.input,
      });
    }
    if (
      event.type === "tool.completed" &&
      payload &&
      typeof payload.callId === "string" &&
      typeof payload.toolId === "string" &&
      payload.output !== undefined
    ) {
      const call = calls.get(payload.callId);
      if (!call || call.toolId !== payload.toolId) throw new Error("tool_history_incomplete");
      messages.push({ role: "assistant_tool_call", ...call });
      messages.push({
        role: "tool",
        callId: payload.callId,
        toolId: payload.toolId,
        output: payload.output,
      });
    }
  }
  return messages;
}

function historicalToolCalls(events: CoreEvent[]): Set<string> {
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool.approval_required" && event.type !== "tool.completed") continue;
    const payload = asRecord(event.payload);
    if (payload && typeof payload.signature === "string") {
      seen.add(payload.signature);
    } else if (payload && typeof payload.toolId === "string" && payload.input !== undefined) {
      seen.add(toolCallSignature(payload.toolId, payload.input));
    }
  }
  return seen;
}

function modelTools(agent: AgentDefinition): SafeModelToolDefinition[] {
  return agent.tools.map((toolId) => {
    const manifest = getSafeToolManifest(toolId);
    if (!manifest) throw new Error("tool_manifest_not_found");
    const schema = JSON.parse(
      JSON.stringify(toJSONSchema(manifest.inputSchema, { target: "draft-07", io: "input" })),
    ) as JsonValue;
    return {
      id: manifest.id,
      name: manifest.id.replaceAll(".", "__"),
      description: manifest.description,
      inputSchema: schema,
    };
  });
}

export class SafeModelOrchestrator {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingContinuations = new Map<string, PendingContinuation>();

  constructor(private readonly options: SafeModelOrchestratorOptions) {
    if (!Number.isFinite(options.serverMaxTimeoutMs) || options.serverMaxTimeoutMs <= 0) {
      throw new TypeError("invalid_server_timeout");
    }
    if (!Number.isFinite(options.serverMaxBudgetUsd) || options.serverMaxBudgetUsd < 0) {
      throw new TypeError("invalid_server_budget");
    }
  }

  async execute(input: ExecuteSafeRunInput): Promise<SafeOrchestratorResult> {
    const { run, agent } = this.boundRun(input.sessionId, input.runId);
    if (run.status !== "pending") throw new Error("run_not_pending");
    if (
      input.maxCostUsd !== undefined &&
      (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd < 0)
    ) {
      throw new TypeError("invalid_run_budget");
    }
    if (
      input.timeoutMs !== undefined &&
      (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)
    ) {
      throw new TypeError("invalid_run_timeout");
    }
    const bound: BoundRunInput = {
      prompt: input.prompt,
      context: input.context,
      inputDigest: digest({ prompt: input.prompt, context: input.context }),
      allowPaidProvider: input.allowPaidProvider === true,
      approvedCloudEgressDigest: input.approvedCloudEgressDigest ?? null,
      maxCostUsd: input.maxCostUsd ?? null,
      timeoutMs: input.timeoutMs ?? null,
      soulPolicyDigest: this.soulPolicy().digest,
    };
    return this.withActiveRun(run, agent, bound.timeoutMs, async (signal) => {
      try {
        this.options.store.transitionRunStatus({
          runId: run.runId,
          sessionId: input.sessionId,
          from: ["pending"],
          to: "running",
        });
        this.append(run.runId, "run.input_bound", {
          inputDigest: bound.inputDigest,
          contextDigest: digest(bound.context),
          allowPaidProvider: bound.allowPaidProvider,
          approvedCloudEgressDigest: bound.approvedCloudEgressDigest,
          maxCostUsd: bound.maxCostUsd,
          timeoutMs: bound.timeoutMs,
          soulPolicyDigest: bound.soulPolicyDigest,
        });
        return await this.executeLoop({
          run: { ...run, status: "running" },
          agent,
          bound,
          messages: [{ role: "user", content: modelContent(input.prompt, input.context) }],
          seenToolCalls: new Set(),
          stepCount: 0,
          fallbackCount: 0,
          spentUsd: 0,
          signal,
        });
      } catch (error) {
        return this.failRun(run, errorReason(error));
      }
    });
  }

  async resumeTool(input: ResumeSafeToolInput): Promise<SafeOrchestratorResult> {
    const { run, agent } = this.boundRun(input.sessionId, input.runId);
    if (run.status !== "waiting_approval") throw new Error("run_not_waiting_approval");
    const events = this.options.store.replayEvents(run.runId);
    const boundEvent = events.find((event) => event.type === "run.input_bound");
    if (!boundEvent) throw new Error("run_input_not_bound");
    const bound = parseBoundInput(
      boundEvent,
      input.prompt,
      input.context,
      this.soulPolicy().digest,
    );
    const pending = pendingToolCall(events, input.invocationId);

    return this.withActiveRun(run, agent, bound.timeoutMs, async (signal) => {
      const result = await this.options.toolGateway.resume({
        sessionId: input.sessionId,
        runId: input.runId,
        invocationId: input.invocationId,
        input: input.toolInput,
      });
      try {
        if (result.status === "approval_required") return this.approvalResult(result);
        this.options.store.transitionRunStatus({
          runId: run.runId,
          sessionId: input.sessionId,
          from: ["waiting_approval"],
          to: "running",
        });
        this.append(
          run.runId,
          "tool.completed",
          asJsonValue({
            callId: pending.callId,
            toolId: pending.toolId,
            invocationId: result.invocationId,
            signature: pending.signature,
            output: result.output,
            ...(result.compression ? { compression: result.compression } : {}),
          }),
        );
        const resumedEvents = this.options.store.replayEvents(run.runId);
        return await this.executeLoop({
          run: { ...run, status: "running" },
          agent,
          bound,
          messages: reconstructMessages(
            resumedEvents,
            bound.prompt,
            bound.context,
            new Map([[pending.callId, input.toolInput]]),
          ),
          seenToolCalls: historicalToolCalls(resumedEvents),
          stepCount: resumedEvents.filter((event) => event.type === "orchestrator.step").length,
          fallbackCount: resumedEvents.filter((event) => event.type === "model.retry").length,
          spentUsd: resumedEvents.reduce((total, event) => {
            const payload = asRecord(event.payload);
            return event.type === "usage" && payload
              ? total + numberField(payload, "estimatedCostUsd")
              : total;
          }, 0),
          signal,
        });
      } catch (error) {
        return this.failRun(run, errorReason(error));
      }
    });
  }

  cancel(input: { sessionId: string; runId: string }): boolean {
    const active = this.activeRuns.get(input.runId);
    if (active?.sessionId === input.sessionId) {
      active.controller.abort("cancelled");
      this.discardRunContinuations(input.sessionId, input.runId);
      const run = this.options.store.getRun(input.runId);
      if (run) this.abortRun(run, "cancelled");
      return true;
    }
    const run = this.options.store.getRun(input.runId);
    if (!run || run.sessionId !== input.sessionId || run.status !== "waiting_approval") {
      return false;
    }
    this.append(run.runId, "abort", { reason: "cancelled" });
    this.options.store.transitionRunStatus({
      runId: run.runId,
      sessionId: input.sessionId,
      from: ["waiting_approval"],
      to: "cancelled",
    });
    this.discardRunContinuations(input.sessionId, input.runId);
    return true;
  }

  hasPendingContinuation(input: PendingContinuationBinding): boolean {
    const pending = this.pendingContinuations.get(input.invocationId);
    return (
      pending?.sessionId === input.sessionId &&
      pending.runId === input.runId &&
      pending.invocationId === input.invocationId
    );
  }

  async resumePendingTool(
    input: PendingContinuationBinding,
  ): Promise<SafeOrchestratorResult> {
    const pending = this.pendingContinuations.get(input.invocationId);
    if (
      !pending ||
      pending.sessionId !== input.sessionId ||
      pending.runId !== input.runId
    ) {
      throw new Error("continuation_unavailable");
    }
    const result = await this.resumeTool({
      ...input,
      toolInput: pending.toolInput,
      prompt: pending.prompt,
      context: pending.context,
    });
    if (result.status !== "approval_required") {
      this.pendingContinuations.delete(input.invocationId);
    }
    return result;
  }

  discardPendingContinuation(input: PendingContinuationBinding): void {
    if (this.hasPendingContinuation(input)) {
      this.pendingContinuations.delete(input.invocationId);
    }
  }

  private async executeLoop(state: LoopState): Promise<SafeOrchestratorResult> {
    const tools = modelTools(state.agent);
    let currentAlias = state.run.requestedModel;

    while (true) {
      if (state.signal.aborted) return this.abortRun(state.run, state.signal.reason);
      if (state.stepCount >= MAX_STEPS) return this.failRun(state.run, "step_limit");
      state.stepCount += 1;
      this.append(state.run.runId, "orchestrator.step", { step: state.stepCount });

      let selected;
      let adapter: SafeModelAdapter;
      try {
        ({ selected, adapter } = this.selectAdapter(state, currentAlias));
      } catch (error) {
        return this.failRun(state.run, errorReason(error));
      }
      if (
        selected.costsExtra &&
        state.spentUsd >= this.budgetLimit(state.agent, state.bound.maxCostUsd)
      ) {
        return this.failRun(state.run, "budget_exceeded");
      }
      this.append(state.run.runId, "model.selected", {
        alias: selected.alias,
        provider: selected.provider,
        model: selected.model,
        costsExtra: selected.costsExtra,
        reason: currentAlias === state.run.requestedModel ? selected.reason : "fallback",
        ...(selected.cloudEgressDigest
          ? { cloudEgressDigest: selected.cloudEgressDigest }
          : {}),
      });

      const requestTools = adapter.supportsTools ? tools : [];
      const calls: Extract<SafeModelEvent, { type: "tool.call" }>[] = [];
      let providerError: Extract<SafeModelEvent, { type: "error" }> | null = null;
      let completion: Extract<SafeModelEvent, { type: "completion" }> | null = null;
      try {
        for await (const event of adapter.stream(
          {
            requestId: randomUUID(),
            messages: state.messages,
            tools: requestTools,
            systemInstruction: compileJarvisSystemInstruction(this.soulPolicy()),
          },
          state.signal,
        )) {
          this.append(state.run.runId, event.type, eventPayload(event));
          if (event.type === "usage") {
            state.spentUsd += event.estimatedCostUsd;
            if (state.spentUsd > this.budgetLimit(state.agent, state.bound.maxCostUsd)) {
              return this.failRun(state.run, "budget_exceeded");
            }
          } else if (event.type === "tool.call") {
            calls.push(event);
          } else if (event.type === "error") {
            providerError = event;
            break;
          } else if (event.type === "abort") {
            return this.abortRun(state.run, event.reason, true);
          } else if (event.type === "completion") {
            completion = event;
          }
        }
      } catch (error) {
        return state.signal.aborted
          ? this.abortRun(state.run, state.signal.reason)
          : this.failRun(state.run, errorReason(error));
      }

      if (state.signal.aborted) return this.abortRun(state.run, state.signal.reason);
      if (providerError) {
        const fallback = this.nextFallback(state, currentAlias, providerError, state.messages);
        if (!fallback) return this.failRun(state.run, providerError.classification);
        state.fallbackCount += 1;
        this.append(state.run.runId, "model.retry", {
          from: currentAlias,
          to: fallback,
          classification: providerError.classification,
          attempt: state.fallbackCount,
        });
        currentAlias = fallback;
        continue;
      }

      for (const call of calls) {
        if (!adapter.supportsTools) return this.failRun(state.run, "unsupported_tool_call");
        const signature = toolCallSignature(call.toolId, call.input);
        if (state.seenToolCalls.has(signature)) {
          return this.failRun(state.run, "repeated_tool_call");
        }
        state.seenToolCalls.add(signature);
        let result: GatewayResult;
        try {
          result = await this.options.toolGateway.invoke({
            sessionId: state.run.sessionId!,
            runId: state.run.runId,
            toolId: call.toolId,
            input: call.input,
          });
        } catch (error) {
          return this.failRun(state.run, errorReason(error));
        }
        if (state.signal.aborted) return this.abortRun(state.run, state.signal.reason);
        if (result.status === "approval_required") {
          this.append(state.run.runId, "tool.approval_required", {
            callId: call.callId,
            toolId: call.toolId,
            input: call.input,
            signature,
            invocationId: result.invocationId,
            approvalId: result.approvalId,
            expiresAt: result.expiresAt,
            preview: result.preview,
          });
          this.options.store.transitionRunStatus({
            runId: state.run.runId,
            sessionId: state.run.sessionId!,
            from: ["running"],
            to: "waiting_approval",
          });
          this.pendingContinuations.set(result.invocationId, {
            sessionId: state.run.sessionId!,
            runId: state.run.runId,
            invocationId: result.invocationId,
            toolInput: call.input,
            prompt: state.bound.prompt,
            context: state.bound.context,
          });
          return this.approvalResult(result);
        }
        const output = asJsonValue(result.output);
        this.append(
          state.run.runId,
          "tool.completed",
          asJsonValue({
            callId: call.callId,
            toolId: call.toolId,
            invocationId: result.invocationId,
            signature,
            output: result.output,
            ...(result.compression ? { compression: result.compression } : {}),
          }),
        );
        state.messages.push({
          role: "assistant_tool_call",
          callId: call.callId,
          toolId: call.toolId,
          input: call.input,
        });
        state.messages.push({
          role: "tool",
          callId: call.callId,
          toolId: call.toolId,
          output,
        });
      }

      if (calls.length > 0) {
        currentAlias = state.run.requestedModel;
        continue;
      }
      if (!completion) return this.failRun(state.run, "provider_incomplete");
      this.append(state.run.runId, "run.completed", { steps: state.stepCount });
      this.options.store.transitionRunStatus({
        runId: state.run.runId,
        sessionId: state.run.sessionId!,
        from: ["running"],
        to: "completed",
      });
      return { status: "completed", runId: state.run.runId };
    }
  }

  private selectAdapter(state: LoopState, alias: string) {
    const adapter = this.options.adapters[alias as AdapterAlias];
    if (!adapter || adapter.alias !== alias) throw new Error("model_unavailable");
    const selected = selectSafeModelAlias({
      catalog: this.options.catalog,
      requestedAlias: alias,
      privacyClass: state.run.privacyClass,
      availableAliases: Object.keys(this.options.adapters),
      allowPaidProvider: state.bound.allowPaidProvider,
      modelIds: Object.fromEntries(
        Object.entries(this.options.adapters).flatMap(([candidate, value]) =>
          value ? [[candidate, value.model]] : [],
        ),
      ),
      content: state.bound.prompt,
      context: state.bound.context,
      approvedCloudEgressDigest: state.bound.approvedCloudEgressDigest ?? undefined,
    });
    return { selected, adapter };
  }

  private soulPolicy(): JarvisSoulPolicy {
    return this.options.soulPolicy ?? loadJarvisSoulPolicy();
  }

  private nextFallback(
    state: LoopState,
    currentAlias: string,
    error: Extract<SafeModelEvent, { type: "error" }>,
    messages: SafeModelMessage[],
  ): string | null {
    if (!error.retryable || state.fallbackCount >= 2) return null;
    const toolTurn = messages.some((message) => message.role !== "user");
    const candidates = buildSafeFallbackAliases({
      catalog: this.options.catalog,
      requestedAlias: currentAlias,
      classification: error.classification,
      maxFallbacks: 2 - state.fallbackCount,
    });
    for (const alias of candidates) {
      const adapter = this.options.adapters[alias as AdapterAlias];
      if (!adapter || (toolTurn && !adapter.supportsTools)) continue;
      try {
        this.selectAdapter(state, alias);
        return alias;
      } catch {
        continue;
      }
    }
    return null;
  }

  private budgetLimit(agent: AgentDefinition, requested: number | null): number {
    const runLimit = requested ?? agent.budgetUsd;
    if (!Number.isFinite(runLimit) || runLimit < 0) throw new Error("invalid_run_budget");
    return Math.min(runLimit, this.options.serverMaxBudgetUsd);
  }

  private boundRun(sessionId: string, runId: string): { run: CoreRun; agent: AgentDefinition } {
    const run = this.options.store.getRun(runId);
    if (!run || run.sessionId !== sessionId) throw new Error("run_binding_mismatch");
    const agent = getAgent(this.options.catalog, run.agentId);
    if (!agent) throw new Error("agent_not_found");
    return { run, agent };
  }

  private append(runId: string, type: string, payload: JsonValue): CoreEvent {
    return this.options.store.appendEvent({ runId, type, payload });
  }

  private failRun(run: CoreRun, reason: string): SafeOrchestratorResult {
    const current = this.options.store.getRun(run.runId);
    if (current?.status === "cancelled") return { status: "cancelled", runId: run.runId };
    if (current && ["running", "waiting_approval", "pending"].includes(current.status)) {
      this.append(run.runId, "run.failed", { reason });
      this.options.store.transitionRunStatus({
        runId: run.runId,
        sessionId: run.sessionId!,
        from: [current.status],
        to: "failed",
      });
    }
    return { status: "failed", runId: run.runId, reason };
  }

  private abortRun(
    run: CoreRun,
    rawReason: unknown,
    eventPersisted = false,
  ): SafeOrchestratorResult {
    const reason = rawReason === "timeout" ? "timeout" : "cancelled";
    const current = this.options.store.getRun(run.runId);
    if (current?.status === "cancelled") {
      return { status: "cancelled", runId: run.runId };
    }
    if (current?.status === "failed") {
      return { status: "failed", runId: run.runId, reason };
    }
    if (!eventPersisted) this.append(run.runId, "abort", { reason });
    const after = this.options.store.getRun(run.runId);
    if (after && ["pending", "running", "waiting_approval"].includes(after.status)) {
      this.options.store.transitionRunStatus({
        runId: run.runId,
        sessionId: run.sessionId!,
        from: [after.status],
        to: reason === "cancelled" ? "cancelled" : "failed",
      });
    }
    return reason === "cancelled"
      ? { status: "cancelled", runId: run.runId }
      : { status: "failed", runId: run.runId, reason };
  }

  private approvalResult(result: Extract<GatewayResult, { status: "approval_required" }>) {
    return {
      status: "approval_required" as const,
      runId: result.runId,
      invocationId: result.invocationId,
      approvalId: result.approvalId,
      expiresAt: result.expiresAt,
      preview: result.preview,
    };
  }

  private discardRunContinuations(sessionId: string, runId: string): void {
    for (const [invocationId, pending] of this.pendingContinuations) {
      if (pending.sessionId === sessionId && pending.runId === runId) {
        this.pendingContinuations.delete(invocationId);
      }
    }
  }

  private async withActiveRun(
    run: CoreRun,
    agent: AgentDefinition,
    requestedTimeoutMs: number | null,
    operation: (signal: AbortSignal) => Promise<SafeOrchestratorResult>,
  ): Promise<SafeOrchestratorResult> {
    if (this.activeRuns.has(run.runId)) throw new Error("run_already_active");
    const requested = requestedTimeoutMs ?? agent.timeoutMs;
    if (!Number.isFinite(requested) || requested <= 0) throw new Error("invalid_run_timeout");
    const timeoutMs = Math.min(requested, agent.timeoutMs, this.options.serverMaxTimeoutMs);
    const controller = new AbortController();
    this.activeRuns.set(run.runId, { sessionId: run.sessionId!, controller });
    const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
    timer.unref?.();
    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timer);
      this.activeRuns.delete(run.runId);
    }
  }
}
