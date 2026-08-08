import { jarvisConfig, getModelConfig } from "./config";
import {
  selectModelAlias,
  wouldRouteConfidentialToCloud,
} from "./model-gateway";
import type { PrivacyClass, TextRequest, TextResponse } from "./types";
import type { MockFailure, TextAdapter } from "@/adapters/base";
import { createTextAdapter } from "@/adapters/factory";

export interface RouteResult {
  adapter?: TextAdapter;
  effectiveAlias: string;
  requestedAlias: string;
  routedAlias: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  smartRouteReason?: string;
  cloudFallbackConsentRequired?: boolean;
  mode: "live" | "mock";
}

export interface CloudFallbackConsent {
  required: boolean;
  reason: string;
  requestedAlias: string;
  effectiveAlias: string;
  toProvider: string;
}

export function evaluateCloudFallbackConsent(options: {
  requestedAlias: string;
  effectiveAlias: string;
  privacyClass: PrivacyClass;
  fallbackUsed: boolean;
}): CloudFallbackConsent | null {
  if (!options.fallbackUsed) return null;
  if (
    !wouldRouteConfidentialToCloud({
      requestedAlias: options.requestedAlias,
      effectiveAlias: options.effectiveAlias,
      privacyClass: options.privacyClass,
    })
  ) {
    return null;
  }

  const effective = getModelConfig(options.effectiveAlias);
  return {
    required: true,
    reason: "confidential_cloud_fallback",
    requestedAlias: options.requestedAlias,
    effectiveAlias: options.effectiveAlias,
    toProvider: effective?.provider ?? "unknown",
  };
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
    profileId?: string;
    confirmedCloudFallback?: boolean;
  },
): Promise<{ request: TextRequest; route: RouteResult }> {
  const config = getModelConfig(requestedAlias);
  if (!config) {
    throw new Error(`Modelo desconhecido: ${requestedAlias}`);
  }

  const privacyClass = options?.privacyClass ?? "internal";
  const selection = selectModelAlias({
    requestedAlias,
    privacyClass,
    profileId: options?.profileId,
  });
  const routedAlias = selection.alias;

  const maxAttempts = jarvisConfig.policies.maxFallbackAttempts;
  let effectiveAlias = routedAlias;
  let fallbackUsed = false;
  let fallbackReason: string | undefined;
  let failure = options?.failure ?? "none";

  const shouldFallback =
    options?.forceFallback ||
    failure === "rate_limit" ||
    failure === "unavailable" ||
    failure === "timeout";

  const routedConfig = getModelConfig(routedAlias) ?? config;

  if (shouldFallback && routedConfig.fallback.length > 0 && maxAttempts >= 1) {
    effectiveAlias = routedConfig.fallback[0];
    fallbackUsed = true;
    fallbackReason = failure === "none" ? "rate_limit" : failure;
    failure = "none";
  }

  const consent = evaluateCloudFallbackConsent({
    requestedAlias,
    effectiveAlias,
    privacyClass,
    fallbackUsed,
  });

  if (consent?.required && !options?.confirmedCloudFallback) {
    return {
      request: {
        provider: routedConfig.provider,
        model: requestedAlias,
        requestId: crypto.randomUUID(),
        purpose: "chat",
        privacyClass,
        maxCostUsd: options?.maxCostUsd ?? 2,
        prompt,
      },
      route: {
        effectiveAlias,
        requestedAlias,
        routedAlias,
        fallbackUsed,
        fallbackReason,
        smartRouteReason: selection.reason,
        cloudFallbackConsentRequired: true,
        mode: "mock",
      },
    };
  }

  const effective = getModelConfig(effectiveAlias) ?? routedConfig;

  const request: TextRequest = {
    provider: effective.provider,
    model: requestedAlias,
    requestId: crypto.randomUUID(),
    purpose: "chat",
    privacyClass,
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
      routedAlias,
      fallbackUsed,
      fallbackReason,
      smartRouteReason: selection.smartRouting ? selection.reason : undefined,
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
