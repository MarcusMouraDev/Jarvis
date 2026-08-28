import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAgentCatalogFromYaml } from "./agent-catalog";
import { closeCoreStore, openCoreStore, type CoreStore, type JsonValue } from "./core-store";
import type {
  SafeModelAdapter,
  SafeModelEvent,
  SafeModelProvider,
  SafeModelRequest,
} from "./safe-model-adapters";
import { SafeModelOrchestrator, type OrchestratorToolGateway } from "./safe-orchestrator";

const originalDataDir = process.env.JARVIS_DATA_DIR;

const catalog = loadAgentCatalogFromYaml(`
version: 1
default_model: local
models:
  local: { provider: local, costs_extra: false, fallback: [] }
  gemini: { provider: google, costs_extra: true, fallback: [codex-openai] }
  codex-openai: { provider: openai, costs_extra: true, fallback: [cursor-text] }
  cursor-text: { provider: cursor, costs_extra: false, fallback: [] }
agents:
  Hermes:
    workspace_mode: optional_existing
    mutation_mode: controlled
    tools: [code.context, terminal.read, terminal.run, file.patch]
    memory_policy: manual
    budget_usd: 0
    timeout_ms: 1000
`);

function eventBase(provider: SafeModelProvider, model: string) {
  return { provider, model } as const;
}

class ScriptedAdapter implements SafeModelAdapter {
  readonly supportsTools: boolean;
  calls = 0;
  requests: SafeModelRequest[] = [];

  constructor(
    readonly alias: SafeModelAdapter["alias"],
    readonly provider: SafeModelProvider,
    readonly model: string,
    private readonly scripts: Array<
      SafeModelEvent[] | ((request: SafeModelRequest, signal?: AbortSignal) => AsyncIterable<SafeModelEvent>)
    >,
    options: { supportsTools?: boolean } = {},
  ) {
    this.supportsTools = options.supportsTools ?? true;
  }

  async *stream(request: SafeModelRequest, signal?: AbortSignal) {
    this.requests.push(request);
    const script = this.scripts[Math.min(this.calls, this.scripts.length - 1)];
    this.calls += 1;
    if (typeof script === "function") {
      yield* script(request, signal);
      return;
    }
    for (const event of script) yield event;
  }
}

function completed(provider: SafeModelProvider, model: string, text = "ok"): SafeModelEvent[] {
  return [
    { ...eventBase(provider, model), type: "text.delta", text },
    { ...eventBase(provider, model), type: "completion", finishReason: "stop" },
  ];
}

function immediateGateway(output: JsonValue = { ok: true }): OrchestratorToolGateway {
  return {
    async invoke(request) {
      return {
        status: "completed",
        invocationId: `invocation-${request.toolId}`,
        runId: request.runId,
        toolId: request.toolId as "code.context",
        output,
      };
    },
    async resume(request) {
      return {
        status: "completed",
        invocationId: request.invocationId,
        runId: request.runId,
        toolId: "file.patch",
        output,
      };
    },
  };
}

describe("SafeModelOrchestrator", () => {
  let dataDir: string;
  let store: CoreStore;
  let runNumber = 0;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-orchestrator-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    store = openCoreStore();
    store.createSession({ sessionId: "session-1" });
  });

  afterEach(() => {
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
  });

  function createRun(requestedModel = "local", privacyClass = "internal") {
    const runId = `run-${++runNumber}`;
    store.createRun({
      runId,
      sessionId: "session-1",
      agentId: "Hermes",
      privacyClass: privacyClass as "internal",
      requestedModel,
      workspace: { kind: "existing", path: process.cwd() },
      status: "pending",
    });
    return runId;
  }

  it("persists normalized local events and completes the existing run", async () => {
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      [
        { ...eventBase("local", "qwen-local"), type: "text.delta", text: "Local answer" },
        {
          ...eventBase("local", "qwen-local"),
          type: "usage",
          promptTokens: 4,
          completionTokens: 2,
          totalTokens: 6,
          estimatedCostUsd: 0,
        },
        { ...eventBase("local", "qwen-local"), type: "completion", finishReason: "stop" },
      ],
    ]);
    const runId = createRun();
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { local },
      toolGateway: immediateGateway(),
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 0,
    });

    const result = await orchestrator.execute({
      sessionId: "session-1",
      runId,
      prompt: "Keep this local",
      context: { source: "composer" },
    });

    expect(result).toEqual({ status: "completed", runId });
    expect(store.getRun(runId)?.status).toBe("completed");
    expect(local.requests[0]?.systemInstruction).toContain("Você é Jarvis");
    expect(local.requests[0]?.messages).toContainEqual({
      role: "user",
      content: "Keep this local\n\nContext:\n{\"source\":\"composer\"}",
    });
    expect(store.replayEvents(runId).map((event) => event.type)).toEqual([
      "run.input_bound",
      "orchestrator.step",
      "model.selected",
      "text.delta",
      "usage",
      "completion",
      "run.completed",
    ]);
  });

  it("makes at most two visible cloud fallbacks and only for retryable failures", async () => {
    const gemini = new ScriptedAdapter("gemini", "google", "gemini-safe", [
      [
        {
          ...eventBase("google", "gemini-safe"),
          type: "error",
          classification: "server_error",
          retryable: true,
        },
      ],
    ]);
    const codex = new ScriptedAdapter("codex-openai", "openai", "codex-safe", [
      [
        {
          ...eventBase("openai", "codex-safe"),
          type: "error",
          classification: "rate_limit",
          retryable: true,
        },
      ],
    ]);
    const cursor = new ScriptedAdapter(
      "cursor-text",
      "cursor",
      "cursor-safe",
      [completed("cursor", "cursor-safe")],
      { supportsTools: false },
    );
    const runId = createRun("gemini", "public");
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { gemini, "codex-openai": codex, "cursor-text": cursor },
      toolGateway: immediateGateway(),
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 1,
    });

    const result = await orchestrator.execute({
      sessionId: "session-1",
      runId,
      prompt: "Public request",
      context: null,
      allowPaidProvider: true,
      maxCostUsd: 0.25,
    });

    expect(result).toEqual({ status: "completed", runId });
    expect(
      store
        .replayEvents(runId)
        .filter((event) => event.type === "model.retry")
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ from: "gemini", to: "codex-openai", classification: "server_error" }),
      expect.objectContaining({ from: "codex-openai", to: "cursor-text", classification: "rate_limit" }),
    ]);
  });

  it("does not fall back on non-retryable errors or from local to cloud", async () => {
    const gemini = new ScriptedAdapter("gemini", "google", "gemini-safe", [
      [
        {
          ...eventBase("google", "gemini-safe"),
          type: "error",
          classification: "authentication",
          retryable: false,
        },
      ],
    ]);
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      [
        {
          ...eventBase("local", "qwen-local"),
          type: "error",
          classification: "unavailable",
          retryable: true,
        },
      ],
    ]);
    const cloud = new ScriptedAdapter("codex-openai", "openai", "codex-safe", [
      completed("openai", "codex-safe"),
    ]);
    const paidRun = createRun("gemini", "public");
    const localRun = createRun("local", "internal");
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { gemini, local, "codex-openai": cloud },
      toolGateway: immediateGateway(),
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 1,
    });

    await expect(
      orchestrator.execute({
        sessionId: "session-1",
        runId: paidRun,
        prompt: "Public",
        context: null,
        allowPaidProvider: true,
        maxCostUsd: 0.5,
      }),
    ).resolves.toEqual({ status: "failed", runId: paidRun, reason: "authentication" });
    await expect(
      orchestrator.execute({
        sessionId: "session-1",
        runId: localRun,
        prompt: "Local",
        context: null,
        allowPaidProvider: true,
        maxCostUsd: 0.5,
      }),
    ).resolves.toEqual({ status: "failed", runId: localRun, reason: "unavailable" });
    expect(cloud.calls).toBe(0);
  });

  it("skips the text-only Cursor adapter after a tool turn", async () => {
    const gemini = new ScriptedAdapter("gemini", "google", "gemini-safe", [
      [
        {
          ...eventBase("google", "gemini-safe"),
          type: "tool.call",
          callId: "context-call",
          toolId: "code.context",
          input: { paths: ["src"] },
        },
        { ...eventBase("google", "gemini-safe"), type: "completion", finishReason: "tool_calls" },
      ],
      [
        {
          ...eventBase("google", "gemini-safe"),
          type: "error",
          classification: "server_error",
          retryable: true,
        },
      ],
    ]);
    const cursor = new ScriptedAdapter(
      "cursor-text",
      "cursor",
      "cursor-safe",
      [completed("cursor", "cursor-safe")],
      { supportsTools: false },
    );
    const runId = createRun("gemini", "public");
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { gemini, "cursor-text": cursor },
      toolGateway: immediateGateway(),
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 1,
    });

    await expect(
      orchestrator.execute({
        sessionId: "session-1",
        runId,
        prompt: "Use context",
        context: null,
        allowPaidProvider: true,
        maxCostUsd: 0.5,
      }),
    ).resolves.toEqual({ status: "failed", runId, reason: "server_error" });
    expect(cursor.calls).toBe(0);
  });

  it("stops repeated tool calls and never invokes the repeated mutation", async () => {
    const toolCall = (callId: string): SafeModelEvent[] => [
      {
        ...eventBase("local", "qwen-local"),
        type: "tool.call",
        callId,
        toolId: "file.patch",
        input: { diff: "same", preimageHashes: {} },
      },
      { ...eventBase("local", "qwen-local"), type: "completion", finishReason: "tool_calls" },
    ];
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      toolCall("call-first"),
      toolCall("call-repeated"),
    ]);
    let invocations = 0;
    const gateway = immediateGateway();
    const invoke = gateway.invoke.bind(gateway);
    gateway.invoke = async (request) => {
      invocations += 1;
      return invoke(request);
    };
    const runId = createRun();
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { local },
      toolGateway: gateway,
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 0,
    });

    const result = await orchestrator.execute({
      sessionId: "session-1",
      runId,
      prompt: "Patch once",
      context: null,
    });

    expect(result).toEqual({ status: "failed", runId, reason: "repeated_tool_call" });
    expect(invocations).toBe(1);
  });

  it("enforces the eight-step ceiling across a run", async () => {
    let call = 0;
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      () => ({
        async *[Symbol.asyncIterator]() {
          const index = call++;
          yield {
            ...eventBase("local", "qwen-local"),
            type: "tool.call" as const,
            callId: `call-${index}`,
            toolId: "code.context",
            input: { paths: [`src/${index}`] },
          };
          yield {
            ...eventBase("local", "qwen-local"),
            type: "completion" as const,
            finishReason: "tool_calls" as const,
          };
        },
      }),
    ]);
    const runId = createRun();
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { local },
      toolGateway: immediateGateway(),
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 0,
    });

    const result = await orchestrator.execute({
      sessionId: "session-1",
      runId,
      prompt: "Loop",
      context: null,
    });

    expect(result).toEqual({ status: "failed", runId, reason: "step_limit" });
    expect(local.calls).toBe(8);
  });

  it("pauses one mutation for approval and resumes the same run", async () => {
    const toolInput = {
      diff: "token=secret",
      preimageHashes: {},
    };
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      [
        {
          ...eventBase("local", "qwen-local"),
          type: "tool.call",
          callId: "patch-call",
          toolId: "file.patch",
          input: toolInput,
        },
        {
          ...eventBase("local", "qwen-local"),
          type: "tool.call",
          callId: "context-after-mutation",
          toolId: "code.context",
          input: { paths: ["src"] },
        },
        { ...eventBase("local", "qwen-local"), type: "completion", finishReason: "tool_calls" },
      ],
      completed("local", "qwen-local", "resumed"),
    ]);
    let resumed = false;
    let approvalConsumable = false;
    const gateway: OrchestratorToolGateway = {
      async invoke(request) {
        return {
          status: "approval_required",
          invocationId: "invocation-1",
          approvalId: "approval-1",
          runId: request.runId,
          toolId: "file.patch",
          expiresAt: "2026-08-08T12:10:00.000Z",
          preview: { paths: ["src/a.ts"] },
        };
      },
      async resume(request) {
        if (!approvalConsumable) throw new Error("approval_not_consumable");
        expect(request.input).toEqual(toolInput);
        resumed = true;
        return {
          status: "completed",
          invocationId: request.invocationId,
          runId: request.runId,
          toolId: "file.patch",
          output: { applied: true },
        };
      },
    };
    const runId = createRun();
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { local },
      toolGateway: gateway,
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 0,
    });
    const input = {
      sessionId: "session-1",
      runId,
      prompt: "Apply approved patch",
      context: null,
    };

    await expect(orchestrator.execute(input)).resolves.toMatchObject({
      status: "approval_required",
      runId,
      invocationId: "invocation-1",
    });
    expect(store.getRun(runId)?.status).toBe("waiting_approval");

    await expect(
      orchestrator.resumeTool({ ...input, invocationId: "invocation-1", toolInput }),
    ).rejects.toThrow("approval_not_consumable");
    expect(store.getRun(runId)?.status).toBe("waiting_approval");

    approvalConsumable = true;
    await expect(
      orchestrator.resumeTool({ ...input, invocationId: "invocation-1", toolInput }),
    ).resolves.toEqual({ status: "completed", runId });
    expect(resumed).toBe(true);
    expect(store.getRun(runId)?.status).toBe("completed");
    expect(local.requests[1].messages).toContainEqual({
      role: "assistant_tool_call",
      callId: "patch-call",
      toolId: "file.patch",
      input: toolInput,
    });
    expect(local.requests[1].messages).not.toContainEqual(
      expect.objectContaining({ callId: "context-after-mutation" }),
    );
  });

  it("keeps exact approval continuation in process memory and out of persisted events", async () => {
    const toolInput = {
      diff: "plain exact patch body",
      preimageHashes: { "src/a.ts": "abc123" },
    };
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      [
        {
          ...eventBase("local", "qwen-local"),
          type: "tool.call",
          callId: "patch-call",
          toolId: "file.patch",
          input: toolInput,
        },
        { ...eventBase("local", "qwen-local"), type: "completion", finishReason: "tool_calls" },
      ],
      completed("local", "qwen-local", "continued"),
    ]);
    let approvalConsumable = false;
    const gateway: OrchestratorToolGateway = {
      async invoke(request) {
        return {
          status: "approval_required",
          invocationId: "invocation-memory",
          approvalId: "approval-memory",
          runId: request.runId,
          toolId: "file.patch",
          expiresAt: "2026-08-08T12:10:00.000Z",
          preview: { paths: ["src/a.ts"] },
        };
      },
      async resume(request) {
        if (!approvalConsumable) throw new Error("approval_not_consumable");
        expect(request.input).toEqual(toolInput);
        return {
          status: "completed",
          invocationId: request.invocationId,
          runId: request.runId,
          toolId: "file.patch",
          output: { applied: true },
        };
      },
    };
    const runId = createRun();
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { local },
      toolGateway: gateway,
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 0,
    });
    const binding = {
      sessionId: "session-1",
      runId,
      invocationId: "invocation-memory",
    };

    await expect(
      orchestrator.execute({
        sessionId: binding.sessionId,
        runId,
        prompt: "Do not persist this raw prompt",
        context: { exact: "context stays in memory" },
      }),
    ).resolves.toMatchObject({
      status: "approval_required",
      runId,
      invocationId: binding.invocationId,
    });

    expect(orchestrator.hasPendingContinuation(binding)).toBe(true);
    expect(
      orchestrator.hasPendingContinuation({ ...binding, sessionId: "session-other" }),
    ).toBe(false);
    const persisted = JSON.stringify(store.replayEvents(runId));
    expect(persisted).not.toContain("Do not persist this raw prompt");
    expect(persisted).not.toContain("context stays in memory");

    await expect(orchestrator.resumePendingTool(binding)).rejects.toThrow(
      "approval_not_consumable",
    );
    expect(orchestrator.hasPendingContinuation(binding)).toBe(true);

    approvalConsumable = true;
    await expect(orchestrator.resumePendingTool(binding)).resolves.toEqual({
      status: "completed",
      runId,
    });
    expect(orchestrator.hasPendingContinuation(binding)).toBe(false);
    await expect(orchestrator.resumePendingTool(binding)).rejects.toThrow(
      "continuation_unavailable",
    );
  });

  it("discards a waiting approval continuation when the run is cancelled", async () => {
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      [
        {
          ...eventBase("local", "qwen-local"),
          type: "tool.call",
          callId: "patch-call",
          toolId: "file.patch",
          input: { diff: "patch", preimageHashes: {} },
        },
        { ...eventBase("local", "qwen-local"), type: "completion", finishReason: "tool_calls" },
      ],
    ]);
    const gateway: OrchestratorToolGateway = {
      async invoke(request) {
        return {
          status: "approval_required",
          invocationId: "invocation-cancel",
          approvalId: "approval-cancel",
          runId: request.runId,
          toolId: "file.patch",
          expiresAt: "2026-08-08T12:10:00.000Z",
          preview: { paths: ["src/a.ts"] },
        };
      },
      async resume() {
        throw new Error("must_not_resume");
      },
    };
    const runId = createRun();
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { local },
      toolGateway: gateway,
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 0,
    });
    const binding = {
      sessionId: "session-1",
      runId,
      invocationId: "invocation-cancel",
    };

    await orchestrator.execute({
      sessionId: binding.sessionId,
      runId,
      prompt: "Cancel approval",
      context: null,
    });
    expect(orchestrator.hasPendingContinuation(binding)).toBe(true);
    expect(orchestrator.cancel({ sessionId: binding.sessionId, runId })).toBe(true);
    expect(orchestrator.hasPendingContinuation(binding)).toBe(false);
  });

  it("detects a repeated sensitive mutation after same-run resume", async () => {
    const toolInput = { diff: "token=secret", preimageHashes: {} };
    const toolTurn = (callId: string): SafeModelEvent[] => [
      {
        ...eventBase("local", "qwen-local"),
        type: "tool.call",
        callId,
        toolId: "file.patch",
        input: toolInput,
      },
      { ...eventBase("local", "qwen-local"), type: "completion", finishReason: "tool_calls" },
    ];
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      toolTurn("patch-first"),
      toolTurn("patch-repeated"),
    ]);
    let invocations = 0;
    const gateway: OrchestratorToolGateway = {
      async invoke(request) {
        invocations += 1;
        return {
          status: "approval_required",
          invocationId: `invocation-${invocations}`,
          approvalId: `approval-${invocations}`,
          runId: request.runId,
          toolId: "file.patch",
          expiresAt: "2026-08-08T12:10:00.000Z",
          preview: { paths: ["src/a.ts"] },
        };
      },
      async resume(request) {
        return {
          status: "completed",
          invocationId: request.invocationId,
          runId: request.runId,
          toolId: "file.patch",
          output: { applied: true },
        };
      },
    };
    const runId = createRun();
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { local },
      toolGateway: gateway,
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 0,
    });
    const input = {
      sessionId: "session-1",
      runId,
      prompt: "Apply once",
      context: null,
    };

    await expect(orchestrator.execute(input)).resolves.toMatchObject({
      status: "approval_required",
      invocationId: "invocation-1",
    });
    await expect(
      orchestrator.resumeTool({ ...input, invocationId: "invocation-1", toolInput }),
    ).resolves.toEqual({ status: "failed", runId, reason: "repeated_tool_call" });
    expect(invocations).toBe(1);
  });

  it("enforces the per-run paid budget under the server ceiling", async () => {
    const gemini = new ScriptedAdapter("gemini", "google", "gemini-safe", [
      [
        {
          ...eventBase("google", "gemini-safe"),
          type: "usage",
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          estimatedCostUsd: 0.6,
        },
        { ...eventBase("google", "gemini-safe"), type: "completion", finishReason: "stop" },
      ],
    ]);
    const runId = createRun("gemini", "public");
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { gemini },
      toolGateway: immediateGateway(),
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 1,
    });

    const result = await orchestrator.execute({
      sessionId: "session-1",
      runId,
      prompt: "Paid request",
      context: null,
      allowPaidProvider: true,
      maxCostUsd: 0.5,
    });

    expect(result).toEqual({ status: "failed", runId, reason: "budget_exceeded" });
  });

  it("rejects invalid or zero paid budgets before cloud egress", async () => {
    const gemini = new ScriptedAdapter("gemini", "google", "gemini-safe", [
      completed("google", "gemini-safe"),
    ]);
    const invalidRun = createRun("gemini", "public");
    const zeroRun = createRun("gemini", "public");
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { gemini },
      toolGateway: immediateGateway(),
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 1,
    });

    await expect(
      orchestrator.execute({
        sessionId: "session-1",
        runId: invalidRun,
        prompt: "Invalid budget",
        context: null,
        allowPaidProvider: true,
        maxCostUsd: -1,
      }),
    ).rejects.toThrow("invalid_run_budget");
    expect(store.getRun(invalidRun)?.status).toBe("pending");

    await expect(
      orchestrator.execute({
        sessionId: "session-1",
        runId: zeroRun,
        prompt: "Zero budget",
        context: null,
        allowPaidProvider: true,
        maxCostUsd: 0,
      }),
    ).resolves.toEqual({ status: "failed", runId: zeroRun, reason: "budget_exceeded" });
    expect(gemini.calls).toBe(0);
  });

  it("cancels an active adapter and records a terminal abort", async () => {
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      (_request, signal) => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          yield {
            ...eventBase("local", "qwen-local"),
            type: "abort" as const,
            reason: "cancelled" as const,
          };
        },
      }),
    ]);
    const runId = createRun();
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { local },
      toolGateway: immediateGateway(),
      serverMaxTimeoutMs: 500,
      serverMaxBudgetUsd: 0,
    });
    const running = orchestrator.execute({
      sessionId: "session-1",
      runId,
      prompt: "Wait",
      context: null,
    });

    await Promise.resolve();
    expect(orchestrator.cancel({ sessionId: "session-1", runId })).toBe(true);
    expect(store.getRun(runId)?.status).toBe("cancelled");

    await expect(running).resolves.toEqual({ status: "cancelled", runId });
    expect(store.getRun(runId)?.status).toBe("cancelled");
    expect(store.replayEvents(runId).at(-1)?.type).toBe("abort");
  });

  it("enforces the server timeout and persists a terminal abort", async () => {
    const local = new ScriptedAdapter("local", "local", "qwen-local", [
      (_request, signal) => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          yield {
            ...eventBase("local", "qwen-local"),
            type: "abort" as const,
            reason: signal?.reason === "timeout" ? ("timeout" as const) : ("cancelled" as const),
          };
        },
      }),
    ]);
    const runId = createRun();
    const orchestrator = new SafeModelOrchestrator({
      store,
      catalog,
      adapters: { local },
      toolGateway: immediateGateway(),
      serverMaxTimeoutMs: 10,
      serverMaxBudgetUsd: 0,
    });

    await expect(
      orchestrator.execute({
        sessionId: "session-1",
        runId,
        prompt: "Wait for the server deadline",
        context: null,
      }),
    ).resolves.toEqual({ status: "failed", runId, reason: "timeout" });
    expect(store.getRun(runId)?.status).toBe("failed");
    expect(store.replayEvents(runId).at(-1)).toMatchObject({
      type: "abort",
      payload: { reason: "timeout" },
    });
  });
});
