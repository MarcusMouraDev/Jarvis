"use client";

import { useCallback, useRef } from "react";
import type { SafeApprovalView } from "@/core/safe-api-contract";
import type { HermesApprovalChoice } from "@/integrations/hermes/approval-map";
import {
  asNonEmptyString as asString,
  asRecord,
} from "@/lib/value-guards";
import { useDialogFocus } from "./use-dialog-focus";

interface SafeApprovalCardProps {
  approval: SafeApprovalView;
  busy: boolean;
  onDecision: (decision: "approved" | "denied", choice?: HermesApprovalChoice) => void;
}

export function SafeApprovalCard({
  approval,
  busy,
  onDecision,
}: SafeApprovalCardProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const preview = asRecord(approval.preview);
  const command =
    asString(preview?.command) ??
    asString(asRecord(approval.target)?.command) ??
    "";
  const gate = asString(preview?.gate) ?? approval.toolId.replace(/[_-]+/g, " ");
  const risk = asString(preview?.risk);

  const deny = useCallback(() => {
    if (!busy) onDecision("denied", "deny");
  }, [busy, onDecision]);

  useDialogFocus(true, dialogRef, deny);

  return (
    <div
      className="confirm-z fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) deny();
      }}
    >
      <div
        ref={dialogRef}
        className="safe-approval-card elev-3 w-full max-w-md rounded-xl border border-surface-2 bg-surface-1 p-5 text-left"
        role="dialog"
        aria-modal="true"
        aria-labelledby="safe-approval-title"
        data-testid="safe-approval-card"
      >
        <p id="safe-approval-title" className="text-sm font-medium text-accent-ask">
          Aprovação necessária
        </p>
        <p className="mt-1 font-mono text-[11px] text-ink-1">{gate}</p>
        {command ? (
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-0 p-2 font-mono text-[11px] text-ink-0">
            {command}
          </pre>
        ) : null}
        {risk ? (
          <p className="mt-2 text-[11px] text-accent-ask">risco: {risk}</p>
        ) : null}
        <p className="mt-2 font-mono text-[10px] text-ink-2">expira {approval.expiresAt}</p>
        <details className="mt-2 text-[11px] text-ink-2">
          <summary>preview / efeito</summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-ink-1">
            {JSON.stringify({ preview: approval.preview, effect: approval.effect }, null, 2)}
          </pre>
        </details>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-press min-h-11 rounded-md px-3 py-1.5 text-xs text-ink-2 hover:text-ink-0"
            disabled={busy}
            autoFocus
            onClick={deny}
          >
            negar
          </button>
          <button
            type="button"
            className="btn-press min-h-11 rounded-md px-3 py-1.5 text-xs text-ink-1"
            disabled={busy}
            onClick={() => onDecision("approved", "once")}
          >
            uma vez
          </button>
          <button
            type="button"
            className="btn-press min-h-11 rounded-md px-3 py-1.5 text-xs text-ink-1"
            disabled={busy}
            onClick={() => onDecision("approved", "session")}
          >
            nesta sessão
          </button>
          <button
            type="button"
            className="btn-press min-h-11 rounded-md bg-accent-ask px-3 py-1.5 text-xs font-medium text-surface-0"
            disabled={busy}
            onClick={() => onDecision("approved", "always")}
          >
            sempre
          </button>
        </div>
      </div>
    </div>
  );
}
