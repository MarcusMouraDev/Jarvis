import { describe, expect, it } from "vitest";
import {
  CodexOpenAIAdapter,
  CursorTextSafeAdapter,
  GeminiSafeAdapter,
  LocalOllamaAdapter,
  LocalOpenAICompatibleAdapter,
  type CursorTextRuntime,
  type ModelTransport,
  type SafeModelEvent,
  type SafeModelRequest,
  type TransportRequest,
} from "./safe-model-adapters";

const request: SafeModelRequest = {
  requestId: "request-1",
  systemInstruction: "POLICY-ONLY",
  messages: [{ role: "user", content: "Inspect the project" }],
  tools: [
    {
      id: "code.context",
      name: "code__context",
      description: "Read bounded source context",
      inputSchema: {
        type: "object",
        properties: { paths: { type: "array", items: { type: "string" } } },
        required: ["paths"],
        additionalProperties: false,
      },
    },
  ],
};

async function collect(stream: AsyncIterable<SafeModelEvent>) {
  const events: SafeModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function transportWith(
  chunks: unknown[],
  capture: (request: TransportRequest) => void,
): ModelTransport {
  return {
    async *stream(transportRequest) {
      capture(transportRequest);
      for (const chunk of chunks) yield chunk;
    },
  };
}

describe("safe model adapters", () => {
  it("normalizes Gemini text, function calls, usage and completion", async () => {
    let sent: TransportRequest | undefined;
    const adapter = new GeminiSafeAdapter({
      transport: transportWith(
        [
          {
            candidates: [
              {
                content: {
                  parts: [
                    { text: "Checking" },
                    {
                      functionCall: {
                        name: "code__context",
                        args: { paths: ["src/core"] },
                      },
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 8,
              candidatesTokenCount: 4,
              totalTokenCount: 12,
            },
          },
        ],
        (value) => {
          sent = value;
        },
      ),
      readEnv: (name) => (name === "GEMINI_MODEL" ? "gemini-safe" : undefined),
    });

    const events = await collect(adapter.stream(request));

    expect(sent).toMatchObject({
      protocol: "sse",
      credential: { env: "GEMINI_API_KEY", header: "x-goog-api-key" },
      body: {
        systemInstruction: { parts: [{ text: "POLICY-ONLY" }] },
        tools: [
          {
            functionDeclarations: [
              expect.objectContaining({ name: "code__context" }),
            ],
          },
        ],
      },
    });
    expect(events).toEqual([
      {
        type: "text.delta",
        provider: "google",
        model: "gemini-safe",
        text: "Checking",
      },
      {
        type: "tool.call",
        provider: "google",
        model: "gemini-safe",
        callId: "request-1:0",
        toolId: "code.context",
        input: { paths: ["src/core"] },
      },
      {
        type: "usage",
        provider: "google",
        model: "gemini-safe",
        promptTokens: 8,
        completionTokens: 4,
        totalTokens: 12,
        estimatedCostUsd: 0,
      },
      {
        type: "completion",
        provider: "google",
        model: "gemini-safe",
        finishReason: "stop",
      },
    ]);
  });

  it("uses the Responses API model setting and normalizes OpenAI events", async () => {
    let sent: TransportRequest | undefined;
    const adapter = new CodexOpenAIAdapter({
      transport: transportWith(
        [
          { type: "response.output_text.delta", delta: "Patch ready" },
          {
            type: "response.function_call_arguments.done",
            item_id: "call-1",
            name: "code__context",
            arguments: '{"paths":["src"]}',
          },
          {
            type: "response.completed",
            response: {
              status: "completed",
              usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
            },
          },
        ],
        (value) => {
          sent = value;
        },
      ),
      readEnv: (name) =>
        name === "OPENAI_CODEX_MODEL" ? "gpt-codex-safe" : undefined,
    });

    const events = await collect(adapter.stream(request));

    expect(sent).toMatchObject({
      url: "https://api.openai.com/v1/responses",
      protocol: "sse",
      credential: {
        env: "OPENAI_API_KEY",
        header: "Authorization",
        prefix: "Bearer ",
      },
      body: {
        model: "gpt-codex-safe",
        instructions: "POLICY-ONLY",
        stream: true,
        tools: [expect.objectContaining({ type: "function", name: "code__context" })],
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      "text.delta",
      "tool.call",
      "usage",
      "completion",
    ]);
    expect(events[1]).toMatchObject({
      callId: "call-1",
      toolId: "code.context",
      input: { paths: ["src"] },
    });
  });

  it("routes local alias through OpenAI-compatible OmniRoute stream", async () => {
    let sent: TransportRequest | undefined;
    const adapter = new LocalOpenAICompatibleAdapter({
      transport: transportWith(
        [
          {
            choices: [
              {
                delta: { content: "Via OmniRoute" },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-omni",
                      function: {
                        name: "code__context",
                        arguments: '{"paths":["src"]}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 2,
              completion_tokens: 3,
              total_tokens: 5,
            },
          },
        ],
        (value) => {
          sent = value;
        },
      ),
      readEnv: (name) =>
        ({
          LOCAL_OPENAI_BASE_URL: "http://127.0.0.1:20128/",
          LOCAL_OPENAI_MODEL: "omni-local",
          LOCAL_OPENAI_API_KEY: "not-needed",
        })[name],
    });

    const events = await collect(adapter.stream(request));

    expect(sent).toMatchObject({
      url: "http://127.0.0.1:20128/v1/chat/completions",
      protocol: "sse",
      body: {
        model: "omni-local",
        stream: true,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system", content: "POLICY-ONLY" }),
        ]),
      },
    });
    expect(sent?.headers?.Authorization).toBeUndefined();
    expect(sent?.credential).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual([
      "text.delta",
      "tool.call",
      "usage",
      "completion",
    ]);
    expect(events[1]).toMatchObject({
      callId: "call-omni",
      toolId: "code.context",
      input: { paths: ["src"] },
    });
  });

  it("keeps Ollama on fixed loopback and classifies aborts", async () => {
    let sent: TransportRequest | undefined;
    const controller = new AbortController();
    const transport: ModelTransport = {
      async *stream(transportRequest) {
        sent = transportRequest;
        controller.abort("cancelled");
        throw new DOMException("aborted", "AbortError");
      },
    };
    const adapter = new LocalOllamaAdapter({
      transport,
      readEnv: (name) =>
        name === "JARVIS_LOCAL_MODEL" ? "qwen-local" : undefined,
    });

    const events = await collect(adapter.stream(request, controller.signal));

    expect(sent).toMatchObject({
      url: "http://127.0.0.1:11434/api/chat",
      protocol: "ndjson",
      body: {
        model: "qwen-local",
        stream: true,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system", content: "POLICY-ONLY" }),
        ]),
      },
    });
    expect(sent?.credential).toBeUndefined();
    expect(events).toEqual([
      {
        type: "abort",
        provider: "local",
        model: "qwen-local",
        reason: "cancelled",
      },
    ]);
  });

  it("classifies only retry-safe provider failures", async () => {
    const transport: ModelTransport = {
      async *stream() {
        throw Object.assign(new Error("provider unavailable"), { status: 503 });
      },
    };
    const adapter = new GeminiSafeAdapter({ transport });

    await expect(collect(adapter.stream(request))).resolves.toEqual([
      {
        type: "error",
        provider: "google",
        model: "gemini-2.5-flash",
        classification: "server_error",
        retryable: true,
      },
    ]);
  });

  it("keeps Cursor text-only with SDK tools disabled", async () => {
    let created:
      | { model: string; prompt: string; tools: []; signal?: AbortSignal }
      | undefined;
    const runtime: CursorTextRuntime = {
      async *stream(input) {
        created = input;
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "Text only" }] },
        };
        yield {
          type: "usage",
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        };
        yield { type: "status", status: "FINISHED" };
      },
    };
    const adapter = new CursorTextSafeAdapter({
      runtime,
      readEnv: (name) => (name === "CURSOR_MODEL" ? "cursor-safe" : undefined),
    });

    const events = await collect(adapter.stream(request));

    expect(created).toMatchObject({
      model: "cursor-safe",
      prompt: "POLICY-ONLY\n\n---\n\nInspect the project",
      tools: [],
    });
    expect(events.map((event) => event.type)).toEqual([
      "text.delta",
      "usage",
      "completion",
    ]);
    expect(events.some((event) => event.type === "tool.call")).toBe(false);
  });
});
