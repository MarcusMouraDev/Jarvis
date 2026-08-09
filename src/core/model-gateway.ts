import { createHash, timingSafeEqual } from "node:crypto";
import { listModelAliases, getModelConfig } from "./config";
import { isModelAliasAvailable } from "@/adapters/factory";
import type { PrivacyClass } from "./types";
import {
  isLocalProvider,
  profileAllowedModels,
  rankCandidates,
  type RoutingCandidate,
  type RoutingScoreBreakdown,
} from "./routing-score";
import { getTelemetryEvents } from "./telemetry";
import type { AgentCatalog } from "./agent-catalog";
import type { JsonValue } from "./core-store";

export interface SafeModelSelection {
  alias: string;
  provider: string;
  model: string;
  costsExtra: boolean;
  reason: "requested" | "local_default" | "fallback";
  cloudEgressDigest?: string;
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

export function createCloudEgressDigest(input: {
  content: string;
  context: JsonValue;
  provider: string;
  model: string;
}): string {
  return createHash("sha256")
    .update(
      stableJson({
        content: input.content,
        context: input.context,
        provider: input.provider,
        model: input.model,
      }),
    )
    .digest("hex");
}

function digestMatches(actual: string, approved: string | undefined): boolean {
  if (!/^[a-f\d]{64}$/i.test(approved ?? "")) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(approved!, "hex"));
}

const retryableFallbacks = new Set([
  "timeout",
  "rate_limit",
  "server_error",
  "unavailable",
]);

export function buildSafeFallbackAliases(options: {
  catalog: AgentCatalog;
  requestedAlias: string;
  classification: string;
  maxFallbacks?: number;
}): string[] {
  const requested = options.catalog.models[options.requestedAlias];
  if (
    !requested ||
    requested.provider === "local" ||
    !retryableFallbacks.has(options.classification)
  ) {
    return [];
  }
  const aliases: string[] = [];
  const seen = new Set([options.requestedAlias]);
  let current = requested;
  const limit = Math.min(Math.max(options.maxFallbacks ?? 2, 0), 2);
  while (aliases.length < limit) {
    const next = current.fallback.find((alias) => !seen.has(alias));
    if (!next) break;
    seen.add(next);
    aliases.push(next);
    const definition = options.catalog.models[next];
    if (!definition) break;
    current = definition;
  }
  return aliases;
}

export function selectSafeModelAlias(options: {
  catalog: AgentCatalog;
  requestedAlias?: string;
  privacyClass: PrivacyClass;
  availableAliases: readonly string[];
  allowPaidProvider?: boolean;
  modelIds?: Readonly<Record<string, string>>;
  content?: string;
  context?: JsonValue;
  approvedCloudEgressDigest?: string;
}): SafeModelSelection {
  const requestedAlias = options.requestedAlias ?? options.catalog.defaultModel;
  const requested = options.catalog.models[requestedAlias];
  if (!requested) throw new Error("unknown_safe_model");
  const available = new Set(options.availableAliases);

  if (requested.provider === "local" && !available.has(requestedAlias)) {
    throw new Error("local_model_unavailable");
  }

  const candidates = [requestedAlias];

  let deniedForCost = false;
  let deniedForEgress = false;
  for (const alias of candidates) {
    const model = options.catalog.models[alias];
    if (!model || !available.has(alias)) continue;
    if (model.costsExtra && !options.allowPaidProvider) {
      deniedForCost = true;
      continue;
    }
    const effectiveModel = options.modelIds?.[alias] ?? alias;
    let cloudEgressDigest: string | undefined;
    if (
      (options.privacyClass === "confidential" || options.privacyClass === "secret") &&
      model.provider !== "local"
    ) {
      if (typeof options.content !== "string" || !options.modelIds?.[alias]) {
        deniedForEgress = true;
        continue;
      }
      cloudEgressDigest = createCloudEgressDigest({
        content: options.content,
        context: options.context ?? null,
        provider: model.provider,
        model: effectiveModel,
      });
      if (!digestMatches(cloudEgressDigest, options.approvedCloudEgressDigest)) {
        deniedForEgress = true;
        continue;
      }
    }
    return {
      alias,
      provider: model.provider,
      model: effectiveModel,
      costsExtra: model.costsExtra,
      ...(cloudEgressDigest ? { cloudEgressDigest } : {}),
      reason:
        alias !== requestedAlias
          ? "fallback"
          : options.requestedAlias
            ? "requested"
            : "local_default",
    };
  }

  if (deniedForEgress) throw new Error("cloud_egress_approval_required");
  if (deniedForCost) throw new Error("paid_provider_disabled");
  throw new Error("safe_model_unavailable");
}

export function isSmartRoutingEnabled(): boolean {
  return process.env.JARVIS_SMART_ROUTING === "1";
}

const DEFAULT_COST_BY_ALIAS: Record<string, number> = {
  "local-openai": 0,
  gemini: 0.002,
  "deepseek-flash": 0.001,
  "deepseek-pro": 0.004,
  codex: 0,
};

function avgLatencyForAlias(alias: string): number | undefined {
  const events = getTelemetryEvents().filter((e) => e.alias === alias);
  if (!events.length) return undefined;
  const sum = events.reduce((acc, e) => acc + e.latencyMs, 0);
  return sum / events.length;
}

export function buildRoutingCandidates(options: {
  privacyClass: PrivacyClass;
  profileId?: string;
}): RoutingCandidate[] {
  return listModelAliases().map((alias) => {
    const config = getModelConfig(alias);
    return {
      alias,
      provider: config?.provider ?? "unknown",
      available: isModelAliasAvailable(alias),
      privacyClass: options.privacyClass,
      profileId: options.profileId,
      estimatedCostUsd: DEFAULT_COST_BY_ALIAS[alias] ?? 0.002,
      avgLatencyMs: avgLatencyForAlias(alias),
    };
  });
}

export interface ModelSelection {
  alias: string;
  reason: string;
  smartRouting: boolean;
  scores: RoutingScoreBreakdown[];
}

export function selectModelAlias(options: {
  requestedAlias: string;
  privacyClass: PrivacyClass;
  profileId?: string;
}): ModelSelection {
  if (!isSmartRoutingEnabled()) {
    return {
      alias: options.requestedAlias,
      reason: "smart_routing_disabled",
      smartRouting: false,
      scores: [],
    };
  }

  const candidates = buildRoutingCandidates({
    privacyClass: options.privacyClass,
    profileId: options.profileId,
  });
  const scores = rankCandidates(candidates);
  const winner = scores.find((s) => !s.disqualified) ?? scores[0];

  if (!winner || winner.disqualified) {
    return {
      alias: options.requestedAlias,
      reason: "no_eligible_candidate",
      smartRouting: true,
      scores,
    };
  }

  if (winner.alias === options.requestedAlias) {
    return {
      alias: options.requestedAlias,
      reason: "requested_best_fit",
      smartRouting: true,
      scores,
    };
  }

  return {
    alias: winner.alias,
    reason: `smart_route:${winner.alias}`,
    smartRouting: true,
    scores,
  };
}

export function wouldRouteConfidentialToCloud(options: {
  requestedAlias: string;
  effectiveAlias: string;
  privacyClass: PrivacyClass;
}): boolean {
  if (options.privacyClass !== "confidential") return false;

  const requested = getModelConfig(options.requestedAlias);
  const effective = getModelConfig(options.effectiveAlias);
  if (!requested || !effective) return false;

  const requestedLocal = isLocalProvider(requested.provider);
  const effectiveLocal = isLocalProvider(effective.provider);

  return requestedLocal && !effectiveLocal;
}

export function isAliasAllowedForProfile(
  alias: string,
  profileId?: string,
): boolean {
  const allowed = profileAllowedModels(profileId);
  if (!allowed) return true;
  return allowed.includes(alias);
}
