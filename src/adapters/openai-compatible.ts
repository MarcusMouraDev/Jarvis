import type { TextAdapter } from "./base";
import type { TextRequest, TextResponse } from "@/core/types";
import {
  hasLocalOpenAi,
  localOpenAiApiKey,
  localOpenAiBaseUrl,
  localOpenAiModel,
} from "@/lib/env";
import { normalizeBaseUrl } from "@/lib/normalize-base-url";

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenAICompatibleHealth {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  modelCount?: number;
}

export function isOpenAICompatibleConfigured(): boolean {
  return hasLocalOpenAi();
}

export async function checkOpenAICompatibleHealth(
  baseUrl = localOpenAiBaseUrl(),
  apiKey = localOpenAiApiKey(),
  timeoutMs = 4000,
): Promise<OpenAICompatibleHealth> {
  if (!baseUrl.trim()) {
    return { ok: false, error: "missing_base_url" };
  }

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey && apiKey !== "not-needed") {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/v1/models`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        latencyMs,
        error: `http_${res.status}:${errText.slice(0, 120)}`,
      };
    }

    const json = (await res.json()) as { data?: unknown[] };
    return {
      ok: true,
      latencyMs,
      modelCount: Array.isArray(json.data) ? json.data.length : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "health_check_failed";
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export class OpenAICompatibleTextAdapter implements TextAdapter {
  constructor(private readonly alias = "local-openai") {}

  async *stream(
    request: TextRequest,
    options?: { systemInstruction?: string },
  ): AsyncGenerator<string, TextResponse> {
    const baseUrl = localOpenAiBaseUrl();
    if (!baseUrl) throw new Error("unavailable");

    const apiKey = localOpenAiApiKey();
    const modelId = localOpenAiModel();
    const url = `${normalizeBaseUrl(baseUrl)}/v1/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (options?.systemInstruction) {
      messages.push({ role: "system", content: options.systemInstruction });
    }
    messages.push({ role: "user", content: request.prompt });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (apiKey && apiKey !== "not-needed") {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("rate_limit");
      if (res.status === 503 || res.status === 500) throw new Error("unavailable");
      throw new Error(`openai_compatible_error:${res.status}:${errText.slice(0, 200)}`);
    }

    if (!res.body) throw new Error("unavailable");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as OpenAIStreamChunk;
          const text = json.choices?.[0]?.delta?.content ?? "";
          if (text) {
            full += text;
            yield text;
          }
          if (json.usage) {
            usage = {
              promptTokens: json.usage.prompt_tokens ?? usage.promptTokens,
              completionTokens:
                json.usage.completion_tokens ?? usage.completionTokens,
              totalTokens: json.usage.total_tokens ?? usage.totalTokens,
            };
          }
        } catch {
          // ignore malformed SSE lines
        }
      }
    }

    if (!usage.totalTokens) {
      usage = {
        promptTokens: Math.ceil(request.prompt.length / 4),
        completionTokens: Math.ceil(full.length / 4),
        totalTokens: Math.ceil((request.prompt.length + full.length) / 4),
      };
    }

    return {
      provider: "local",
      model: this.alias,
      requestId: request.requestId,
      fallbackUsed: false,
      requestedAlias: request.model,
      usage: {
        ...usage,
        estimatedCostUsd: 0,
      },
      text: full,
    };
  }
}
