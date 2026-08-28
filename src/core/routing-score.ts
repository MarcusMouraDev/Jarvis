import type { PrivacyClass } from "./types";
import { assertNever } from "./assert-never";

export interface RoutingCandidate {
  alias: string;
  provider: string;
  available: boolean;
  privacyClass: PrivacyClass;
  profileId?: string;
  estimatedCostUsd?: number;
  avgLatencyMs?: number;
}

export interface RoutingScoreBreakdown {
  alias: string;
  total: number;
  privacy: number;
  profile: number;
  cost: number;
  latency: number;
  disqualified?: string;
}

const LOCAL_PROVIDERS = new Set(["local"]);

const PROFILE_ALLOWED: Record<string, string[]> = {
  conversa: ["local-openai", "gemini", "deepseek-flash", "deepseek-pro", "codex"],
  pesquisa: ["gemini", "deepseek-pro", "codex", "deepseek-flash"],
  briefing: ["gemini", "local-openai", "deepseek-flash"],
  monitor: ["deepseek-flash", "local-openai"],
};

export function isLocalProvider(provider: string): boolean {
  return LOCAL_PROVIDERS.has(provider);
}

export function profileAllowedModels(profileId?: string): string[] | null {
  if (!profileId) return null;
  return PROFILE_ALLOWED[profileId] ?? null;
}

function privacyScore(candidate: RoutingCandidate): number {
  const isLocal = isLocalProvider(candidate.provider);
  switch (candidate.privacyClass) {
    case "secret":
      return isLocal ? 100 : -1000;
    case "confidential":
      return isLocal ? 100 : 10;
    case "internal":
      return isLocal ? 80 : 60;
    case "public":
      return isLocal ? 50 : 70;
    default:
      return assertNever(candidate.privacyClass);
  }
}

function profileScore(candidate: RoutingCandidate): number {
  const allowed = profileAllowedModels(candidate.profileId);
  if (!allowed) return 50;
  const index = allowed.indexOf(candidate.alias);
  if (index === -1) return 0;
  return 100 - index * 8;
}

function costScore(candidate: RoutingCandidate): number {
  const cost = candidate.estimatedCostUsd ?? 0.002;
  return Math.max(0, 100 - cost * 10_000);
}

function latencyScore(candidate: RoutingCandidate): number {
  const latency = candidate.avgLatencyMs ?? 1200;
  return Math.max(0, 100 - latency / 50);
}

export function scoreCandidate(candidate: RoutingCandidate): RoutingScoreBreakdown {
  if (!candidate.available) {
    return {
      alias: candidate.alias,
      total: -1,
      privacy: 0,
      profile: 0,
      cost: 0,
      latency: 0,
      disqualified: "unavailable",
    };
  }

  if (
    candidate.privacyClass === "secret" &&
    !isLocalProvider(candidate.provider)
  ) {
    return {
      alias: candidate.alias,
      total: -1,
      privacy: -1000,
      profile: 0,
      cost: 0,
      latency: 0,
      disqualified: "privacy_blocked",
    };
  }

  const privacy = privacyScore(candidate);
  const profile = profileScore(candidate);
  const cost = costScore(candidate);
  const latency = latencyScore(candidate);

  const total = privacy * 0.45 + profile * 0.25 + cost * 0.15 + latency * 0.15;

  return {
    alias: candidate.alias,
    total,
    privacy,
    profile,
    cost,
    latency,
  };
}

export function rankCandidates(
  candidates: RoutingCandidate[],
): RoutingScoreBreakdown[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate))
    .sort((a, b) => b.total - a.total);
}
