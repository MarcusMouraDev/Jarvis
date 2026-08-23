"use client";

import type { SafeApprovalView } from "@/core/safe-api-contract";

interface SafeApprovalCardProps {
  approval: SafeApprovalView;
  busy: boolean;
  onDecision: (decision: "approved" | "denied") => void;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function SafeApprovalCard({
  approval,
  busy,
  onDecision,
}: SafeApprovalCardProps) {
  return (
    <div
      className="safe-approval-card elev-2 mt-2 w-full max-w-[65ch] rounded-lg bg-surface-1/95 p-3 text-left"
      role="group"
      aria-label="Aprovação de ferramenta"
      data-testid="safe-approval-card"
    >
      <p className="text-xs font-medium text-accent-ask">Aprovação necessária</p>
      <p className="mt-1 font-mono text-[11px] text-ink-1">{approval.toolId}</p>
      <dl className="mt-2 grid gap-1 text-[11px] text-ink-2">
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0">alvo</dt>
          <dd className="min-w-0 truncate font-mono text-ink-1">
            {formatJson(approval.target)}
          </dd>
        </div>
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0">efeito</dt>
          <dd className="min-w-0 truncate font-mono text-ink-1">
            {formatJson(approval.effect)}
          </dd>
        </div>
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0">expira</dt>
          <dd className="font-mono text-ink-1">{approval.expiresAt}</dd>
        </div>
      </dl>
      <details className="safe-approval-disclosure mt-2">
        <summary className="cursor-pointer text-[11px] text-ink-1">
          preview / diff
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-surface-0 p-2 font-mono text-[11px] text-ink-0 whitespace-pre-wrap">
          {formatJson(approval.preview)}
        </pre>
      </details>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn-press min-h-11 min-w-11 rounded-md px-3 py-1.5 text-xs text-ink-2 hover:text-ink-0"
          disabled={busy}
          onClick={() => onDecision("denied")}
          autoFocus
        >
          Recusar
        </button>
        <button
          type="button"
          className="btn-press min-h-11 min-w-11 rounded-md bg-accent-ask px-3 py-1.5 text-xs font-medium text-surface-0"
          disabled={busy}
          onClick={() => onDecision("approved")}
        >
          Aprovar
        </button>
      </div>
    </div>
  );
}
