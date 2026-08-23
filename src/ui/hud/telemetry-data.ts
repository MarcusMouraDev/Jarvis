import type { OmnirouteUsageReport } from "@/integrations/omniroute-mcp/usage-report";
import type { AgentState } from "@/core/types";

export const EMPTY_DISPLAY = "—";

/** Response characters that fill the stream gauge. */
const STREAM_CHARS_FULL = 2000;

export interface TelemetryGauge {
  id: "quota" | "stream";
  label: string;
  /** 0..1, or null when the datum is missing — render a ghost track. */
  value: number | null;
  display: string;
}

export interface TelemetryReadout {
  id: string;
  label: string;
  value: string;
}

export interface TelemetrySnapshot {
  online: boolean;
  gauges: TelemetryGauge[];
  readouts: TelemetryReadout[];
}

function compactChars(chars: number): string {
  if (chars < 1000) return `${chars} ch`;
  return `${(chars / 1000).toFixed(1)}k ch`;
}

export function buildTelemetry(input: {
  report: OmnirouteUsageReport | null;
  runStatus: string | null;
  presence: AgentState;
  model: { provider: string; model: string } | null;
  assistantChars: number;
}): TelemetrySnapshot {
  const online = Boolean(input.report?.omniUp);
  const percent = online ? (input.report?.criticalPercentRemaining ?? null) : null;
  const totals =
    online && input.report?.analyticsAuth === "ok"
      ? (input.report.totals ?? null)
      : null;

  const streamValue = Math.min(
    1,
    Math.max(0, input.assistantChars / STREAM_CHARS_FULL),
  );

  return {
    online,
    gauges: [
      {
        id: "quota",
        label: "quota",
        value: percent === null ? null : Math.min(1, Math.max(0, percent / 100)),
        display: percent === null ? EMPTY_DISPLAY : `${Math.round(percent)}%`,
      },
      {
        id: "stream",
        label: "stream",
        value: streamValue,
        display: compactChars(input.assistantChars),
      },
    ],
    readouts: [
      { id: "status", label: "run", value: input.runStatus ?? "idle" },
      { id: "state", label: "estado", value: input.presence },
      {
        id: "model",
        label: "modelo",
        value: input.model ? input.model.model : EMPTY_DISPLAY,
      },
      {
        id: "requests",
        label: "req 7d",
        value: totals ? String(totals.requests) : EMPTY_DISPLAY,
      },
      {
        id: "cost",
        label: "custo 7d",
        value: totals ? `US$ ${totals.costUsd.toFixed(4)}` : EMPTY_DISPLAY,
      },
    ],
  };
}
