import { describe, expect, it } from "vitest";
import type { OmnirouteUsageReport } from "@/integrations/omniroute-mcp/usage-report";
import { buildTelemetry, EMPTY_DISPLAY } from "./telemetry-data";

function report(over: Partial<OmnirouteUsageReport> = {}): OmnirouteUsageReport {
  return {
    omniUp: true,
    range: "7d",
    analyticsAuth: "ok",
    totals: { requests: 42, tokensIn: 1000, tokensOut: 2000, costUsd: 0.1234 },
    providers: [],
    criticalPercentRemaining: 62.4,
    compression: null,
    source: { quota: "q", analytics: "a", compression: "c" },
    ...over,
  };
}

const base = {
  runStatus: "running" as string | null,
  presence: "thinking" as const,
  model: { provider: "omniroute", model: "kimi-k2" },
  assistantChars: 0,
};

function gauge(snapshot: ReturnType<typeof buildTelemetry>, id: string) {
  const found = snapshot.gauges.find((g) => g.id === id);
  if (!found) throw new Error(`gauge ${id} ausente`);
  return found;
}

function readout(snapshot: ReturnType<typeof buildTelemetry>, id: string) {
  const found = snapshot.readouts.find((r) => r.id === id);
  if (!found) throw new Error(`readout ${id} ausente`);
  return found;
}

describe("buildTelemetry", () => {
  it("marca offline e nao inventa numero sem relatorio", () => {
    const snap = buildTelemetry({ ...base, report: null });
    expect(snap.online).toBe(false);
    expect(gauge(snap, "quota").value).toBeNull();
    expect(gauge(snap, "quota").display).toBe(EMPTY_DISPLAY);
    expect(readout(snap, "requests").value).toBe(EMPTY_DISPLAY);
    expect(readout(snap, "cost").value).toBe(EMPTY_DISPLAY);
  });

  it("trata omniUp falso como offline", () => {
    const snap = buildTelemetry({
      ...base,
      report: report({
        omniUp: false,
        totals: null,
        criticalPercentRemaining: null,
      }),
    });
    expect(snap.online).toBe(false);
    expect(gauge(snap, "quota").value).toBeNull();
  });

  it("converte percentual de quota para fracao e rotulo inteiro", () => {
    const snap = buildTelemetry({ ...base, report: report() });
    expect(gauge(snap, "quota").value).toBeCloseTo(0.624, 3);
    expect(gauge(snap, "quota").display).toBe("62%");
  });

  it("mostra requests e custo quando analytics autorizou", () => {
    const snap = buildTelemetry({ ...base, report: report() });
    expect(readout(snap, "requests").value).toBe("42");
    expect(readout(snap, "cost").value).toBe("US$ 0.1234");
  });

  it("nao mostra zero quando analytics pede auth", () => {
    const snap = buildTelemetry({
      ...base,
      report: report({ analyticsAuth: "required", totals: null }),
    });
    expect(readout(snap, "requests").value).toBe(EMPTY_DISPLAY);
    expect(readout(snap, "cost").value).toBe(EMPTY_DISPLAY);
  });

  it("normaliza o gauge de stream e comprime a contagem", () => {
    const snap = buildTelemetry({
      ...base,
      report: report(),
      assistantChars: 1200,
    });
    expect(gauge(snap, "stream").value).toBeCloseTo(0.6, 3);
    expect(gauge(snap, "stream").display).toBe("1.2k ch");
  });

  it("limita o gauge de stream em 1", () => {
    const snap = buildTelemetry({
      ...base,
      report: report(),
      assistantChars: 99999,
    });
    expect(gauge(snap, "stream").value).toBe(1);
  });

  it("cai para idle quando nao ha status de run", () => {
    const snap = buildTelemetry({ ...base, report: report(), runStatus: null });
    expect(readout(snap, "status").value).toBe("idle");
  });

  it("usa o marcador vazio quando nao ha modelo", () => {
    const snap = buildTelemetry({ ...base, report: report(), model: null });
    expect(readout(snap, "model").value).toBe(EMPTY_DISPLAY);
  });
});
