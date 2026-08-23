import {
  OmnirouteMcpClient,
  OmnirouteMcpClientError,
} from "./client";
import { sanitizeOmnirouteJson } from "./allowlist";

export const OMNIROUTE_USAGE_RANGE = "7d" as const;

export type OmnirouteAnalyticsAuth = "ok" | "required" | "unavailable";

export interface OmnirouteUsageProvider {
  name: string;
  provider: string;
  quotaUsed: number;
  quotaTotal: number | null;
  percentRemaining: number;
  resetAt: string | null;
}

export interface OmnirouteUsageTotals {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface OmnirouteUsageReport {
  omniUp: boolean;
  range: typeof OMNIROUTE_USAGE_RANGE;
  analyticsAuth: OmnirouteAnalyticsAuth;
  totals: OmnirouteUsageTotals | null;
  providers: OmnirouteUsageProvider[];
  criticalPercentRemaining: number | null;
  compression: unknown;
  source: {
    quota: string;
    analytics: string;
    compression: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapProviders(quota: unknown): OmnirouteUsageProvider[] {
  const root = asRecord(quota);
  const rows = Array.isArray(root.providers) ? root.providers : [];
  return rows.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const provider =
      typeof row.provider === "string" && row.provider.trim()
        ? row.provider
        : "unknown";
    const name =
      typeof row.name === "string" && row.name.trim() ? row.name : provider;
    const percentRemaining = asNumber(row.percentRemaining, 100);
    return [
      {
        name,
        provider,
        quotaUsed: asNumber(row.quotaUsed),
        quotaTotal:
          typeof row.quotaTotal === "number" && Number.isFinite(row.quotaTotal)
            ? row.quotaTotal
            : null,
        percentRemaining,
        resetAt: typeof row.resetAt === "string" ? row.resetAt : null,
      },
    ];
  });
}

function mapTotals(analytics: unknown): OmnirouteUsageTotals | null {
  const summary = asRecord(asRecord(analytics).summary);
  if (Object.keys(summary).length === 0) return null;
  return {
    requests: asNumber(summary.totalRequests),
    tokensIn: asNumber(summary.promptTokens),
    tokensOut: asNumber(summary.completionTokens),
    costUsd: asNumber(summary.totalCost),
  };
}

function analyticsAuthFromStatus(status: number): OmnirouteAnalyticsAuth {
  if (status === 200) return "ok";
  if (status === 401 || status === 403) return "required";
  return "unavailable";
}

export function mapOmnirouteUsageReport(input: {
  quota: unknown;
  analytics: unknown;
  analyticsStatus: number;
  compression: unknown;
}): OmnirouteUsageReport {
  const providers = mapProviders(input.quota);
  const percents = providers.map((row) => row.percentRemaining);
  const analyticsAuth = analyticsAuthFromStatus(input.analyticsStatus);
  return {
    omniUp: true,
    range: OMNIROUTE_USAGE_RANGE,
    analyticsAuth,
    totals: analyticsAuth === "ok" ? mapTotals(input.analytics) : null,
    providers,
    criticalPercentRemaining: percents.length > 0 ? Math.min(...percents) : null,
    compression: sanitizeOmnirouteJson(input.compression),
    source: {
      quota: "omniroute:/api/usage/quota",
      analytics: "omniroute:/api/usage/analytics?range=7d",
      compression: "omniroute:/api/compression/status",
    },
  };
}

function statusFromHttpError(error: OmnirouteMcpClientError): number {
  const match = /^omniroute_http_(\d+)$/.exec(error.message);
  return match ? Number(match[1]) : 500;
}

async function readJson(
  client: OmnirouteMcpClient,
  path: string,
): Promise<{ status: number; body: unknown }> {
  try {
    return { status: 200, body: await client.getJson(path) };
  } catch (error) {
    if (error instanceof OmnirouteMcpClientError && error.code === "http_error") {
      return { status: statusFromHttpError(error), body: null };
    }
    throw error;
  }
}

export async function fetchOmnirouteUsageReport(
  client: OmnirouteMcpClient,
): Promise<OmnirouteUsageReport> {
  try {
    const [quota, analytics, compression] = await Promise.all([
      readJson(client, "/api/usage/quota"),
      readJson(client, "/api/usage/analytics?range=7d"),
      readJson(client, "/api/compression/status"),
    ]);
    if (quota.status >= 500 || quota.status === 0) {
      return downReport();
    }
    if (quota.status >= 400 && quota.status !== 401 && quota.status !== 403) {
      return downReport();
    }
    return mapOmnirouteUsageReport({
      quota: quota.body,
      analytics: analytics.body,
      analyticsStatus: analytics.status,
      compression: compression.status === 200 ? compression.body : null,
    });
  } catch (error) {
    if (
      error instanceof OmnirouteMcpClientError &&
      (error.code === "network" || error.code === "timeout")
    ) {
      return downReport();
    }
    throw error;
  }
}

export function omniChipLabel(input: {
  omniUp: boolean;
  criticalPercentRemaining: number | null;
}): string {
  if (!input.omniUp) return "omni · down";
  if (input.criticalPercentRemaining == null) return "omni · ok";
  return `omni · ${Math.round(input.criticalPercentRemaining)}%`;
}

function downReport(): OmnirouteUsageReport {
  return {
    omniUp: false,
    range: OMNIROUTE_USAGE_RANGE,
    analyticsAuth: "unavailable",
    totals: null,
    providers: [],
    criticalPercentRemaining: null,
    compression: null,
    source: {
      quota: "omniroute:/api/usage/quota",
      analytics: "omniroute:/api/usage/analytics?range=7d",
      compression: "omniroute:/api/compression/status",
    },
  };
}
