import { jarvisConfig, getModelConfig } from "./config";
import type { PrivacyClass, TextRequest, TextResponse } from "./types";
import type { MockFailure, TextAdapter } from "@/adapters/base";
import { createTextAdapter } from "@/adapters/factory";

export interface RouteResult {
  adapter: TextAdapter;
  effectiveAlias: string;
  requestedAlias: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  mode: "live" | "mock";
}

export async function routeTextRequest(
  requestedAlias: string,
  prompt: string,
  options?: {
    failure?: MockFailure;
    forceFallback?: boolean;
    privacyClass?: PrivacyClass;
    maxCostUsd?: number;
    forceMock?: boolean;
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
    fallbackReason = failure === "none" ? "rate_limit" : failure;
    failure = "none";
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

  const { adapter, mode } = createTextAdapter(effectiveAlias, {
    failure,
    fallbackUsed,
    fallbackReason,
    forceMock: options?.forceMock,
  });

  return {
    request,
    route: {
      adapter,
      effectiveAlias,
      requestedAlias,
      fallbackUsed,
      fallbackReason,
      mode,
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
