import { jarvisConfig, getModelConfig } from "./config";
import type { PrivacyClass, TextRequest, TextResponse } from "./types";
import type { MockFailure, TextAdapter } from "@/adapters/base";
import { MockTextAdapter } from "@/adapters/mock-text";

export interface RouteResult {
  adapter: TextAdapter;
  effectiveAlias: string;
  requestedAlias: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

export async function routeTextRequest(
  requestedAlias: string,
  prompt: string,
  options?: {
    failure?: MockFailure;
    forceFallback?: boolean;
    privacyClass?: PrivacyClass;
    maxCostUsd?: number;
  },
): Promise<{ request: TextRequest; route: RouteResult }> {
  const config = getModelConfig(requestedAlias);
  if (!config) {
    throw new Error(`Modelo desconhecido: ${requestedAlias}`);
  }

  const maxAttempts = jarvisConfig.policies.maxFallbackAttempts;
  let effectiveAlias = requestedAlias;
  let fallbackUsed = false;
  let fallbackReason: string | undefined;
  let failure = options?.failure ?? "none";

  const shouldFallback =
    options?.forceFallback ||
    failure === "rate_limit" ||
    failure === "unavailable" ||
    failure === "timeout";

  if (shouldFallback && config.fallback.length > 0 && maxAttempts >= 1) {
    effectiveAlias = config.fallback[0];
    fallbackUsed = true;
    fallbackReason =
      failure === "none" ? "rate_limit" : failure;
    failure = "none";
  } else if (shouldFallback && config.fallback.length === 0) {
    // Codex and others with empty fallback surface the failure.
  }

  const effective = getModelConfig(effectiveAlias) ?? config;

  const request: TextRequest = {
    provider: effective.provider,
    model: requestedAlias,
    requestId: crypto.randomUUID(),
    purpose: "chat",
    privacyClass: options?.privacyClass ?? "internal",
    maxCostUsd: options?.maxCostUsd ?? 2,
    prompt,
  };

  const adapter = new MockTextAdapter(
    effectiveAlias,
    failure,
    fallbackUsed,
    fallbackReason,
  );

  return {
    request,
    route: {
      adapter,
      effectiveAlias,
      requestedAlias,
      fallbackUsed,
      fallbackReason,
    },
  };
}

export function codexHasNoFallback(): boolean {
  return jarvisConfig.models.codex.fallback.length === 0;
}

export async function collectStream(
  gen: AsyncGenerator<string, TextResponse>,
): Promise<{ chunks: string[]; response: TextResponse }> {
  const chunks: string[] = [];
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      if (!value) throw new Error("Stream vazio");
      return { chunks, response: value };
    }
    chunks.push(value);
  }
}
