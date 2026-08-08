import type { TextAdapter } from "./base";
import type { TextRequest, TextResponse } from "@/core/types";
import { geminiModelId, requireEnv } from "@/lib/env";

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function extractText(chunk: GeminiStreamChunk): string {
  return (
    chunk.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? ""
  );
}

export class GeminiTextAdapter implements TextAdapter {
  constructor(
    private readonly alias = "gemini",
    private readonly modelId = geminiModelId(),
  ) {}

  async *stream(
    request: TextRequest,
    options?: { systemInstruction?: string },
  ): AsyncGenerator<string, TextResponse> {
    const apiKey = requireEnv("GEMINI_API_KEY");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:streamGenerateContent?alt=sse`;

    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: request.prompt }],
        },
      ],
    };

    if (options?.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: options.systemInstruction }],
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("rate_limit");
      if (res.status === 503 || res.status === 500) throw new Error("unavailable");
      throw new Error(`gemini_error:${res.status}:${errText.slice(0, 200)}`);
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
          const json = JSON.parse(payload) as GeminiStreamChunk;
          const text = extractText(json);
          if (text) {
            full += text;
            yield text;
          }
          if (json.usageMetadata) {
            usage = {
              promptTokens: json.usageMetadata.promptTokenCount ?? usage.promptTokens,
              completionTokens:
                json.usageMetadata.candidatesTokenCount ?? usage.completionTokens,
              totalTokens: json.usageMetadata.totalTokenCount ?? usage.totalTokens,
            };
          }
        } catch {
          // ignore malformed SSE lines
        }
      }
    }

    return {
      provider: "google",
      model: this.alias,
      requestId: request.requestId,
      fallbackUsed: false,
      requestedAlias: request.model,
      usage: {
        ...usage,
        estimatedCostUsd: (usage.totalTokens || 0) * 0.00000035,
      },
      text: full,
    };
  }
}
