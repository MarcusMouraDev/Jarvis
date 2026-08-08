import type { TextAdapter } from "./base";
import type { MockFailure } from "./base";
import type { TextRequest, TextResponse } from "@/core/types";
import { getProviderForAlias } from "@/core/config";

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockTextAdapter implements TextAdapter {
  constructor(
    private readonly alias: string,
    private readonly failure: MockFailure = "none",
    private readonly useFallback = false,
    private readonly fallbackReason?: string,
  ) {}

  async *stream(request: TextRequest): AsyncGenerator<string, TextResponse> {
    if (this.failure === "timeout") {
      await delay(80);
      throw new Error("timeout");
    }
    if (this.failure === "rate_limit") {
      throw new Error("rate_limit");
    }
    if (this.failure === "unavailable") {
      throw new Error("unavailable");
    }

    const chunks = [
      "Analisando sua solicitação. ",
      "O fallback só é permitido para indisponibilidade, timeout ou rate limit. ",
      "Nunca mascaro a troca de modelo.",
    ];

    for (const chunk of chunks) {
      await delay(40);
      yield chunk;
    }

    return {
      provider: getProviderForAlias(this.alias),
      model: this.alias,
      requestId: request.requestId,
      fallbackUsed: this.useFallback,
      fallbackReason: this.useFallback
        ? (this.fallbackReason ?? "rate_limit")
        : undefined,
      requestedAlias: request.model,
      usage: {
        promptTokens: 120,
        completionTokens: 80,
        totalTokens: 200,
        estimatedCostUsd: 0.0021,
      },
      text: chunks.join(""),
    };
  }
}
