import type { JsonValue } from "./core-store";
import { normalizeBaseUrl } from "@/lib/normalize-base-url";

export type SafeModelProvider = "google" | "openai" | "cursor" | "local";
export type RetryClassification =
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "unavailable"
  | "authentication"
  | "invalid_request"
  | "unknown";

interface ModelEventBase {
  provider: SafeModelProvider;
  model: string;
}

export type SafeModelEvent =
  | (ModelEventBase & { type: "text.delta"; text: string })
  | (ModelEventBase & {
      type: "tool.call";
      callId: string;
      toolId: string;
      input: JsonValue;
    })
  | (ModelEventBase & {
      type: "usage";
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    })
  | (ModelEventBase & {
      type: "completion";
      finishReason: "stop" | "tool_calls" | "max_tokens" | "other";
    })
  | (ModelEventBase & {
      type: "error";
      classification: RetryClassification;
      retryable: boolean;
    })
  | (ModelEventBase & {
      type: "abort";
      reason: "cancelled" | "timeout";
    });

export interface SafeModelToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: JsonValue;
}

export type SafeModelMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant_tool_call";
      callId: string;
      toolId: string;
      input: JsonValue;
    }
  | { role: "tool"; callId: string; toolId: string; output: JsonValue };

export interface SafeModelRequest {
  requestId: string;
  messages: SafeModelMessage[];
  tools: SafeModelToolDefinition[];
  /** Provider-native system policy. Never fold into user messages or tool payloads. */
  systemInstruction?: string;
}

export interface TransportRequest {
  provider: Exclude<SafeModelProvider, "cursor">;
  url: string;
  protocol: "sse" | "ndjson";
  credential?: {
    env: string;
    header: string;
    prefix?: string;
  };
  /** Extra headers (e.g. optional Bearer for local OpenAI-compatible gateways). */
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ModelTransport {
  stream(request: TransportRequest): AsyncIterable<unknown>;
}

export interface SafeModelAdapter {
  readonly alias: "gemini" | "codex-openai" | "cursor-text" | "local";
  readonly provider: SafeModelProvider;
  readonly model: string;
  readonly supportsTools: boolean;
  stream(request: SafeModelRequest, signal?: AbortSignal): AsyncIterable<SafeModelEvent>;
}

type ReadEnv = (name: string) => string | undefined;

interface HttpAdapterOptions {
  transport?: ModelTransport;
  readEnv?: ReadEnv;
}

interface CursorRuntimeInput {
  model: string;
  prompt: string;
  tools: [];
  signal?: AbortSignal;
}

export interface CursorTextRuntime {
  stream(input: CursorRuntimeInput): AsyncIterable<unknown>;
}

function processEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function requiredEnv(readEnv: ReadEnv, name: string): string {
  const value = readEnv(name)?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
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
  throw new TypeError("model_event_not_json");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toolIdFor(name: unknown, tools: SafeModelToolDefinition[]): string | null {
  if (typeof name !== "string") return null;
  return tools.find((tool) => tool.name === name)?.id ?? null;
}

function finishReason(value: unknown): "stop" | "tool_calls" | "max_tokens" | "other" {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "stop" || normalized === "completed" || normalized === "finished") {
    return "stop";
  }
  if (normalized.includes("tool") || normalized === "function_call") return "tool_calls";
  if (normalized.includes("max") || normalized === "length") return "max_tokens";
  return "other";
}

function abortReason(signal?: AbortSignal): "cancelled" | "timeout" {
  return signal?.reason === "timeout" ? "timeout" : "cancelled";
}

function classifyFailure(error: unknown): {
  classification: RetryClassification;
  retryable: boolean;
} {
  const status = (error as { status?: unknown }).status;
  const code = (error as NodeJS.ErrnoException).code;
  if (status === 408) return { classification: "timeout", retryable: true };
  if (status === 429) return { classification: "rate_limit", retryable: true };
  if (typeof status === "number" && status >= 500 && status <= 599) {
    return { classification: "server_error", retryable: true };
  }
  if (status === 401 || status === 403) {
    return { classification: "authentication", retryable: false };
  }
  if (typeof status === "number" && status >= 400 && status <= 499) {
    return { classification: "invalid_request", retryable: false };
  }
  if (
    error instanceof TypeError ||
    ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(code ?? "")
  ) {
    return { classification: "unavailable", retryable: true };
  }
  return { classification: "unknown", retryable: false };
}

async function* parseBody(response: Response, protocol: "sse" | "ndjson") {
  if (!response.body) throw Object.assign(new Error("provider_unavailable"), { status: 503 });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      const trimmed = line.trim();
      const payload = protocol === "sse" ? trimmed.replace(/^data:\s*/, "") : trimmed;
      if (!payload || payload === "[DONE]" || (protocol === "sse" && !trimmed.startsWith("data:"))) {
        continue;
      }
      try {
        yield JSON.parse(payload) as unknown;
      } catch {
        // Provider noise and malformed lines are ignored, never persisted.
      }
    }
    if (done) break;
  }
}

export class FetchModelTransport implements ModelTransport {
  async *stream(request: TransportRequest): AsyncIterable<unknown> {
    const headers: Record<string, string> = {
      Accept: request.protocol === "sse" ? "text/event-stream" : "application/x-ndjson",
      "Content-Type": "application/json",
      ...(request.headers ?? {}),
    };
    if (request.credential) {
      headers[request.credential.header] = `${request.credential.prefix ?? ""}${requiredEnv(
        processEnv,
        request.credential.env,
      )}`;
    }
    const response = await fetch(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(request.body),
      signal: request.signal,
    });
    if (!response.ok) throw Object.assign(new Error("provider_request_failed"), { status: response.status });
    yield* parseBody(response, request.protocol);
  }
}

abstract class HttpSafeAdapter implements SafeModelAdapter {
  abstract readonly alias: SafeModelAdapter["alias"];
  abstract readonly provider: Exclude<SafeModelProvider, "cursor">;
  abstract readonly supportsTools: boolean;
  abstract readonly model: string;
  protected readonly transport: ModelTransport;

  constructor(transport?: ModelTransport) {
    this.transport = transport ?? new FetchModelTransport();
  }

  protected abstract request(input: SafeModelRequest, signal?: AbortSignal): TransportRequest;
  protected abstract normalize(input: SafeModelRequest, chunk: unknown): SafeModelEvent[];

  async *stream(input: SafeModelRequest, signal?: AbortSignal): AsyncIterable<SafeModelEvent> {
    try {
      for await (const chunk of this.transport.stream(this.request(input, signal))) {
        for (const event of this.normalize(input, chunk)) yield event;
      }
    } catch (error) {
      if (signal?.aborted || (error as Error).name === "AbortError") {
        yield { type: "abort", provider: this.provider, model: this.model, reason: abortReason(signal) };
        return;
      }
      yield { type: "error", provider: this.provider, model: this.model, ...classifyFailure(error) };
    }
  }
}

function geminiContents(messages: SafeModelMessage[], tools: SafeModelToolDefinition[]) {
  return messages.map((message) => {
    if (message.role === "user") return { role: "user", parts: [{ text: message.content }] };
    const tool = tools.find((candidate) => candidate.id === message.toolId);
    if (message.role === "assistant_tool_call") {
      return {
        role: "model",
        parts: [{ functionCall: { name: tool?.name ?? message.toolId, args: message.input } }],
      };
    }
    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: tool?.name ?? message.toolId,
            response: { output: message.output },
          },
        },
      ],
    };
  });
}

export class GeminiSafeAdapter extends HttpSafeAdapter {
  readonly alias = "gemini" as const;
  readonly provider = "google" as const;
  readonly supportsTools = true;
  readonly model: string;
  private callIndex = 0;

  constructor(options: HttpAdapterOptions = {}) {
    super(options.transport);
    this.model = options.readEnv?.("GEMINI_MODEL")?.trim() || "gemini-2.5-flash";
  }

  protected request(input: SafeModelRequest, signal?: AbortSignal): TransportRequest {
    return {
      provider: this.provider,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`,
      protocol: "sse",
      credential: { env: "GEMINI_API_KEY", header: "x-goog-api-key" },
      body: {
        contents: geminiContents(input.messages, input.tools),
        ...(input.systemInstruction
          ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
          : {}),
        ...(input.tools.length
          ? {
              tools: [
                {
                  functionDeclarations: input.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  })),
                },
              ],
            }
          : {}),
      },
      signal,
    };
  }

  protected normalize(input: SafeModelRequest, chunk: unknown): SafeModelEvent[] {
    const root = record(chunk);
    if (!root) return [];
    const candidate = Array.isArray(root.candidates) ? record(root.candidates[0]) : null;
    const content = record(candidate?.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const events: SafeModelEvent[] = [];
    for (const rawPart of parts) {
      const part = record(rawPart);
      if (typeof part?.text === "string" && part.text) {
        events.push({ type: "text.delta", provider: this.provider, model: this.model, text: part.text });
      }
      const call = record(part?.functionCall);
      const toolId = toolIdFor(call?.name, input.tools);
      if (call && toolId) {
        events.push({
          type: "tool.call",
          provider: this.provider,
          model: this.model,
          callId: `${input.requestId}:${this.callIndex++}`,
          toolId,
          input: asJsonValue(call.args ?? {}),
        });
      }
    }
    const usage = record(root.usageMetadata);
    if (usage) {
      events.push({
        type: "usage",
        provider: this.provider,
        model: this.model,
        promptTokens: number(usage.promptTokenCount),
        completionTokens: number(usage.candidatesTokenCount),
        totalTokens: number(usage.totalTokenCount),
        estimatedCostUsd: 0,
      });
    }
    if (candidate?.finishReason) {
      events.push({
        type: "completion",
        provider: this.provider,
        model: this.model,
        finishReason: finishReason(candidate.finishReason),
      });
    }
    return events;
  }
}

function openAiInput(messages: SafeModelMessage[], tools: SafeModelToolDefinition[]) {
  return messages.map((message) => {
    if (message.role === "user") return { role: "user", content: message.content };
    const tool = tools.find((candidate) => candidate.id === message.toolId);
    if (message.role === "assistant_tool_call") {
      return {
        type: "function_call",
        call_id: message.callId,
        name: tool?.name ?? message.toolId,
        arguments: JSON.stringify(message.input),
      };
    }
    return {
      type: "function_call_output",
      call_id: message.callId,
      output: JSON.stringify(message.output),
    };
  });
}

export class CodexOpenAIAdapter extends HttpSafeAdapter {
  readonly alias = "codex-openai" as const;
  readonly provider = "openai" as const;
  readonly supportsTools = true;
  readonly model: string;

  constructor(options: HttpAdapterOptions = {}) {
    super(options.transport);
    this.model = requiredEnv(options.readEnv ?? processEnv, "OPENAI_CODEX_MODEL");
  }

  protected request(input: SafeModelRequest, signal?: AbortSignal): TransportRequest {
    return {
      provider: this.provider,
      url: "https://api.openai.com/v1/responses",
      protocol: "sse",
      credential: { env: "OPENAI_API_KEY", header: "Authorization", prefix: "Bearer " },
      body: {
        model: this.model,
        ...(input.systemInstruction ? { instructions: input.systemInstruction } : {}),
        input: openAiInput(input.messages, input.tools),
        stream: true,
        tools: input.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: true,
        })),
      },
      signal,
    };
  }

  protected normalize(input: SafeModelRequest, chunk: unknown): SafeModelEvent[] {
    const root = record(chunk);
    if (!root || typeof root.type !== "string") return [];
    if (root.type === "response.output_text.delta" && typeof root.delta === "string") {
      return [{ type: "text.delta", provider: this.provider, model: this.model, text: root.delta }];
    }
    if (root.type === "response.function_call_arguments.done") {
      const toolId = toolIdFor(root.name, input.tools);
      if (!toolId || typeof root.arguments !== "string") return [];
      try {
        return [
          {
            type: "tool.call",
            provider: this.provider,
            model: this.model,
            callId: typeof root.item_id === "string" ? root.item_id : input.requestId,
            toolId,
            input: asJsonValue(JSON.parse(root.arguments)),
          },
        ];
      } catch {
        return [];
      }
    }
    if (root.type === "response.completed") {
      const response = record(root.response);
      const usage = record(response?.usage);
      const events: SafeModelEvent[] = [];
      if (usage) {
        events.push({
          type: "usage",
          provider: this.provider,
          model: this.model,
          promptTokens: number(usage.input_tokens),
          completionTokens: number(usage.output_tokens),
          totalTokens: number(usage.total_tokens),
          estimatedCostUsd: 0,
        });
      }
      events.push({
        type: "completion",
        provider: this.provider,
        model: this.model,
        finishReason: finishReason(response?.status),
      });
      return events;
    }
    return [];
  }
}

function ollamaMessages(messages: SafeModelMessage[], tools: SafeModelToolDefinition[]) {
  return messages.map((message) => {
    if (message.role === "user") return { role: "user", content: message.content };
    const tool = tools.find((candidate) => candidate.id === message.toolId);
    if (message.role === "assistant_tool_call") {
      return {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: { name: tool?.name ?? message.toolId, arguments: message.input },
          },
        ],
      };
    }
    return { role: "tool", content: JSON.stringify(message.output) };
  });
}

function openAiChatMessages(messages: SafeModelMessage[], tools: SafeModelToolDefinition[]) {
  return messages.map((message) => {
    if (message.role === "user") return { role: "user", content: message.content };
    const tool = tools.find((candidate) => candidate.id === message.toolId);
    if (message.role === "assistant_tool_call") {
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: message.callId,
            type: "function",
            function: {
              name: tool?.name ?? message.toolId,
              arguments: JSON.stringify(message.input),
            },
          },
        ],
      };
    }
    return {
      role: "tool",
      tool_call_id: message.callId,
      content: JSON.stringify(message.output),
    };
  });
}

/**
 * OmniRoute / local OpenAI-compatible gateway — Safe Core alias `local`.
 * Prefers LOCAL_OPENAI_* over Ollama when configured.
 */
export class LocalOpenAICompatibleAdapter extends HttpSafeAdapter {
  readonly alias = "local" as const;
  readonly provider = "local" as const;
  readonly supportsTools = true;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly pendingTools = new Map<
    number,
    { id: string; name: string; args: string }
  >();

  constructor(options: HttpAdapterOptions = {}) {
    super(options.transport);
    const readEnv = options.readEnv ?? processEnv;
    const base = readEnv("LOCAL_OPENAI_BASE_URL")?.trim();
    if (!base) throw new Error("missing_env:LOCAL_OPENAI_BASE_URL");
    this.baseUrl = normalizeBaseUrl(base);
    this.model = readEnv("LOCAL_OPENAI_MODEL")?.trim() || "auto";
    this.apiKey = readEnv("LOCAL_OPENAI_API_KEY")?.trim() || "not-needed";
  }

  protected request(input: SafeModelRequest, signal?: AbortSignal): TransportRequest {
    const headers: Record<string, string> = {};
    if (this.apiKey && this.apiKey !== "not-needed") {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return {
      provider: this.provider,
      url: `${this.baseUrl}/v1/chat/completions`,
      protocol: "sse",
      headers,
      body: {
        model: this.model,
        messages: [
          ...(input.systemInstruction
            ? [{ role: "system", content: input.systemInstruction }]
            : []),
          ...openAiChatMessages(input.messages, input.tools),
        ],
        stream: true,
        stream_options: { include_usage: true },
        ...(input.tools.length
          ? {
              tools: input.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }
          : {}),
      },
      signal,
    };
  }

  protected normalize(input: SafeModelRequest, chunk: unknown): SafeModelEvent[] {
    const root = record(chunk);
    if (!root) return [];
    const events: SafeModelEvent[] = [];
    const choice = Array.isArray(root.choices) ? record(root.choices[0]) : null;
    const delta = record(choice?.delta);

    if (typeof delta?.content === "string" && delta.content) {
      events.push({
        type: "text.delta",
        provider: this.provider,
        model: this.model,
        text: delta.content,
      });
    }

    const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
    for (const rawCall of toolCalls) {
      const call = record(rawCall);
      if (!call) continue;
      const index = typeof call.index === "number" ? call.index : 0;
      const fn = record(call.function);
      const existing = this.pendingTools.get(index) ?? {
        id: typeof call.id === "string" ? call.id : `${input.requestId}:${index}`,
        name: "",
        args: "",
      };
      if (typeof call.id === "string" && call.id) existing.id = call.id;
      if (typeof fn?.name === "string" && fn.name) existing.name = fn.name;
      if (typeof fn?.arguments === "string") existing.args += fn.arguments;
      this.pendingTools.set(index, existing);
    }

    const usage = record(root.usage);
    const finish = choice?.finish_reason;
    if (typeof finish === "string" && finish) {
      if (finish === "tool_calls" || this.pendingTools.size > 0) {
        for (const pending of this.pendingTools.values()) {
          const toolId = toolIdFor(pending.name, input.tools);
          if (!toolId) continue;
          try {
            events.push({
              type: "tool.call",
              provider: this.provider,
              model: this.model,
              callId: pending.id,
              toolId,
              input: asJsonValue(JSON.parse(pending.args || "{}")),
            });
          } catch {
            // Malformed tool args are dropped; provider will retry or fail later.
          }
        }
        this.pendingTools.clear();
      }
      if (usage) {
        events.push({
          type: "usage",
          provider: this.provider,
          model: this.model,
          promptTokens: number(usage.prompt_tokens),
          completionTokens: number(usage.completion_tokens),
          totalTokens: number(usage.total_tokens),
          estimatedCostUsd: 0,
        });
      }
      events.push({
        type: "completion",
        provider: this.provider,
        model: this.model,
        finishReason: finishReason(finish),
      });
    } else if (usage) {
      events.push({
        type: "usage",
        provider: this.provider,
        model: this.model,
        promptTokens: number(usage.prompt_tokens),
        completionTokens: number(usage.completion_tokens),
        totalTokens: number(usage.total_tokens),
        estimatedCostUsd: 0,
      });
    }

    return events;
  }
}

export class LocalOllamaAdapter extends HttpSafeAdapter {
  readonly alias = "local" as const;
  readonly provider = "local" as const;
  readonly supportsTools = true;
  readonly model: string;
  private callIndex = 0;

  constructor(options: HttpAdapterOptions = {}) {
    super(options.transport);
    this.model = requiredEnv(options.readEnv ?? processEnv, "JARVIS_LOCAL_MODEL");
  }

  protected request(input: SafeModelRequest, signal?: AbortSignal): TransportRequest {
    return {
      provider: this.provider,
      url: "http://127.0.0.1:11434/api/chat",
      protocol: "ndjson",
      body: {
        model: this.model,
        messages: [
          ...(input.systemInstruction
            ? [{ role: "system", content: input.systemInstruction }]
            : []),
          ...ollamaMessages(input.messages, input.tools),
        ],
        stream: true,
        ...(input.tools.length
          ? {
              tools: input.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }
          : {}),
      },
      signal,
    };
  }

  protected normalize(input: SafeModelRequest, chunk: unknown): SafeModelEvent[] {
    const root = record(chunk);
    if (!root) return [];
    const message = record(root.message);
    const events: SafeModelEvent[] = [];
    if (typeof message?.content === "string" && message.content) {
      events.push({ type: "text.delta", provider: this.provider, model: this.model, text: message.content });
    }
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    for (const rawCall of calls) {
      const fn = record(record(rawCall)?.function);
      const toolId = toolIdFor(fn?.name, input.tools);
      if (!toolId) continue;
      events.push({
        type: "tool.call",
        provider: this.provider,
        model: this.model,
        callId: `${input.requestId}:${this.callIndex++}`,
        toolId,
        input: asJsonValue(fn?.arguments ?? {}),
      });
    }
    if (root.done) {
      const promptTokens = number(root.prompt_eval_count);
      const completionTokens = number(root.eval_count);
      events.push({
        type: "usage",
        provider: this.provider,
        model: this.model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd: 0,
      });
      events.push({
        type: "completion",
        provider: this.provider,
        model: this.model,
        finishReason: finishReason(root.done_reason),
      });
    }
    return events;
  }
}

function cursorPrompt(messages: SafeModelMessage[], systemInstruction?: string): string {
  const system = systemInstruction ? `${systemInstruction}\n\n---\n\n` : "";
  return messages
    .map((message) => {
      if (message.role === "user") return message.content;
      if (message.role === "assistant_tool_call") {
        return `Tool request ${message.toolId}: ${JSON.stringify(message.input)}`;
      }
      return `Tool result ${message.toolId}: ${JSON.stringify(message.output)}`;
    })
    .join("\n\n")
    .replace(/^/, system);
}

const defaultCursorRuntime: CursorTextRuntime = {
  async *stream(input) {
    // Intentional runtime import: Cursor SDK is optional and contains platform-native assets.
    const { Agent } = await import("@cursor/sdk");
    const agent = await Agent.create({
      apiKey: requiredEnv(processEnv, "CURSOR_API_KEY"),
      model: { id: input.model },
      tools: [],
      local: { cwd: process.cwd(), enableAgentRetries: false },
    });
    try {
      const run = await agent.send(input.prompt);
      const cancel = () => void run.cancel();
      input.signal?.addEventListener("abort", cancel, { once: true });
      try {
        for await (const event of run.stream()) yield event;
        const result = await run.wait();
        if (result.status === "error") throw new Error("cursor_run_failed");
      } finally {
        input.signal?.removeEventListener("abort", cancel);
      }
    } finally {
      agent.close();
    }
  },
};

export class CursorTextSafeAdapter implements SafeModelAdapter {
  readonly alias = "cursor-text" as const;
  readonly provider = "cursor" as const;
  readonly supportsTools = false;
  readonly model: string;
  private readonly runtime: CursorTextRuntime;

  constructor(options: { runtime?: CursorTextRuntime; readEnv?: ReadEnv } = {}) {
    this.runtime = options.runtime ?? defaultCursorRuntime;
    this.model = options.readEnv?.("CURSOR_MODEL")?.trim() || processEnv("CURSOR_MODEL") || "composer-2.5";
  }

  async *stream(input: SafeModelRequest, signal?: AbortSignal): AsyncIterable<SafeModelEvent> {
    try {
      for await (const raw of this.runtime.stream({
        model: this.model,
        prompt: cursorPrompt(input.messages, input.systemInstruction),
        tools: [],
        signal,
      })) {
        const event = record(raw);
        if (event?.type === "assistant") {
          const message = record(event.message);
          const blocks = Array.isArray(message?.content) ? message.content : [];
          for (const rawBlock of blocks) {
            const block = record(rawBlock);
            if (block?.type === "text" && typeof block.text === "string" && block.text) {
              yield { type: "text.delta", provider: this.provider, model: this.model, text: block.text };
            }
          }
        } else if (event?.type === "usage") {
          const usage = record(event.usage);
          yield {
            type: "usage",
            provider: this.provider,
            model: this.model,
            promptTokens: number(usage?.inputTokens),
            completionTokens: number(usage?.outputTokens),
            totalTokens: number(usage?.totalTokens),
            estimatedCostUsd: 0,
          };
        } else if (event?.type === "status" && event.status === "FINISHED") {
          yield { type: "completion", provider: this.provider, model: this.model, finishReason: "stop" };
        }
      }
    } catch (error) {
      if (signal?.aborted || (error as Error).name === "AbortError") {
        yield { type: "abort", provider: this.provider, model: this.model, reason: abortReason(signal) };
        return;
      }
      yield { type: "error", provider: this.provider, model: this.model, ...classifyFailure(error) };
    }
  }
}
