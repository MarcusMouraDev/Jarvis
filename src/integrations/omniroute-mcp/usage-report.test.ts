import { describe, expect, it } from "vitest";
import { OmnirouteMcpClient } from "./client";
import { fetchOmnirouteUsageReport, mapOmnirouteUsageReport } from "./usage-report";

describe("mapOmnirouteUsageReport", () => {
  it("maps quota, 7d analytics totals, and compression from OmniRoute payloads", () => {
    const report = mapOmnirouteUsageReport({
      quota: {
        providers: [
          {
            name: "codex",
            provider: "codex",
            quotaUsed: 20,
            quotaTotal: 100,
            percentRemaining: 80,
            resetAt: "2026-08-21T00:00:00.000Z",
          },
        ],
      },
      analytics: {
        summary: {
          totalRequests: 12,
          promptTokens: 1000,
          completionTokens: 250,
          totalCost: 0.42,
        },
      },
      analyticsStatus: 200,
      compression: { enabled: true },
    });

    expect(report.omniUp).toBe(true);
    expect(report.range).toBe("7d");
    expect(report.analyticsAuth).toBe("ok");
    expect(report.totals).toEqual({
      requests: 12,
      tokensIn: 1000,
      tokensOut: 250,
      costUsd: 0.42,
    });
    expect(report.providers[0]).toMatchObject({
      name: "codex",
      percentRemaining: 80,
    });
    expect(report.criticalPercentRemaining).toBe(80);
    expect(report.compression).toEqual({ enabled: true });
  });

  it("keeps quota when analytics requires dashboard auth", () => {
    const report = mapOmnirouteUsageReport({
      quota: { providers: [] },
      analytics: null,
      analyticsStatus: 401,
      compression: null,
    });
    expect(report.omniUp).toBe(true);
    expect(report.analyticsAuth).toBe("required");
    expect(report.totals).toBeNull();
  });
});

describe("fetchOmnirouteUsageReport", () => {
  it("reads analytics, quota, and compression through the loopback client", async () => {
    const seen: string[] = [];
    const client = new OmnirouteMcpClient({
      baseUrl: "http://127.0.0.1:20128",
      fetchImpl: (async (input) => {
        const url = String(input);
        seen.push(url);
        if (url.includes("/api/usage/quota")) {
          return new Response(JSON.stringify({ providers: [] }), { status: 200 });
        }
        if (url.includes("/api/usage/analytics")) {
          return new Response(
            JSON.stringify({
              summary: {
                totalRequests: 3,
                promptTokens: 10,
                completionTokens: 4,
                totalCost: 0.01,
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/compression/status")) {
          return new Response(JSON.stringify({ enabled: false }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });

    const report = await fetchOmnirouteUsageReport(client);
    expect(seen.some((url) => url.includes("/api/usage/analytics?range=7d"))).toBe(
      true,
    );
    expect(report.totals?.requests).toBe(3);
    expect(report.omniUp).toBe(true);
  });
});

describe("omniChipLabel", () => {
  it("shows down, ok, or the tightest remaining quota", async () => {
    const { omniChipLabel } = await import("./usage-report");
    expect(omniChipLabel({ omniUp: false, criticalPercentRemaining: 80 })).toBe(
      "omni · down",
    );
    expect(omniChipLabel({ omniUp: true, criticalPercentRemaining: null })).toBe(
      "omni · ok",
    );
    expect(omniChipLabel({ omniUp: true, criticalPercentRemaining: 80.4 })).toBe(
      "omni · 80%",
    );
  });
});
