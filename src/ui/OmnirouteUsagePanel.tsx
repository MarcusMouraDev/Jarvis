"use client";

/* Chip/panel refresh is an explicit user-or-open fetch, not a render-time store. */
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import { omniChipLabel } from "@/integrations/omniroute-mcp/usage-report";
import type { OmnirouteUsageReport } from "@/integrations/omniroute-mcp/usage-report";
import { safeCoreFetch } from "@/lib/safe-core-client";

const POLL_MS = 60_000;

export async function loadOmnirouteUsage(): Promise<OmnirouteUsageReport | null> {
  let response: Response;
  try {
    response = await safeCoreFetch("/api/omniroute/usage");
  } catch {
    response = await fetch("/api/omniroute/usage", { credentials: "same-origin" });
  }
  if (!response.ok && response.status !== 502) return null;
  return (await response.json()) as OmnirouteUsageReport;
}

export function useOmnirouteUsage(options: { open: boolean }) {
  const [report, setReport] = useState<OmnirouteUsageReport | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await loadOmnirouteUsage());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // One-shot health chip + refresh when the panel opens. No 5s dashboard poll.
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!options.open) return;
    void refresh();
    const tick = () => {
      if (document.hidden) return;
      void refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [options.open, refresh]);

  return { report, loading, refresh };
}

export function OmnirouteStatusChip({
  report,
  onOpen,
}: {
  report: OmnirouteUsageReport | null;
  onOpen: () => void;
}) {
  const label = omniChipLabel({
    omniUp: report?.omniUp ?? false,
    criticalPercentRemaining: report?.criticalPercentRemaining ?? null,
  });
  const down = !report || !report.omniUp;
  return (
    <button
      type="button"
      className={`whitespace-nowrap rounded-md px-1.5 py-0.5 hover:text-ink-0 ${
        down ? "text-[color:var(--state-danger)]" : "text-ink-1"
      }`}
      onClick={onOpen}
      aria-label="Abrir uso OmniRoute"
    >
      {label}
    </button>
  );
}

export function OmnirouteUsagePanel({
  open,
  report,
  loading,
  onClose,
  onRefresh,
}: {
  open: boolean;
  report: OmnirouteUsageReport | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  if (!open) return null;
  const totals = report?.totals;
  return (
    <aside
      className="chrome-z mx-auto mb-2 w-full max-w-3xl rounded-lg border border-surface-2 bg-surface-1/95 p-3 text-xs text-ink-1 shadow-[var(--elev-2)]"
      aria-label="Uso OmniRoute"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-wide text-ink-0">
          Uso OmniRoute · 7d
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-press rounded-md px-2 py-1 text-ink-1 hover:text-ink-0"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "lendo…" : "atualizar"}
          </button>
          {typeof window !== "undefined" && window.jarvisDesktop ? (
            <button
              type="button"
              className="btn-press rounded-md px-2 py-1 text-ink-1 hover:text-ink-0"
              onClick={() => window.jarvisDesktop?.openOmniDashboard()}
            >
              dashboard
            </button>
          ) : null}
          <button
            type="button"
            className="btn-press rounded-md px-2 py-1 text-ink-1 hover:text-ink-0"
            onClick={onClose}
          >
            fechar
          </button>
        </div>
      </div>
      {!report || !report.omniUp ? (
        <p className="mt-2 text-ink-2">OmniRoute indisponível em :20128.</p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <p>
            {totals
              ? `${totals.requests} req · ${totals.tokensIn}/${totals.tokensOut} tok · US$ ${totals.costUsd.toFixed(4)}`
              : report.analyticsAuth === "required"
                ? "Quota ok. Analytics pede auth — abra o dashboard OmniRoute."
                : "Sem totais de analytics."}
          </p>
          <ul className="space-y-1">
            {report.providers.length === 0 ? (
              <li>Sem provedores de quota.</li>
            ) : (
              report.providers.map((row) => (
                <li key={`${row.provider}:${row.name}`}>
                  {row.name}: {Math.round(row.percentRemaining)}% restante
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </aside>
  );
}
