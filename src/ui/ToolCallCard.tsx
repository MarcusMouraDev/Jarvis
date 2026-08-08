"use client";

import type { ReactNode } from "react";

export type ToolCallStatus =
  | "pending"
  | "running"
  | "needs_approval"
  | "ok"
  | "error"
  | "cancelled";

export interface ToolCallSource {
  label: string;
  url?: string;
  date?: string;
}

export interface ToolCallCardProps {
  toolId: string;
  intention: string;
  status: ToolCallStatus;
  progress?: string;
  result?: string;
  sources?: ToolCallSource[];
  rollbackAvailable?: boolean;
  onCancel?: () => void;
  onRollback?: () => void;
  /** Optional approval surface — wraps risk variant */
  approvalSlot?: ReactNode;
}

export function ToolCallCard({
  toolId,
  intention,
  status,
  progress,
  result,
  sources,
  rollbackAvailable,
  onCancel,
  onRollback,
  approvalSlot,
}: ToolCallCardProps) {
  const statusLabel: Record<ToolCallStatus, string> = {
    pending: "aguardando",
    running: "executando",
    needs_approval: "aprovação",
    ok: "concluído",
    error: "erro",
    cancelled: "cancelado",
  };

  return (
    <div
      className="elev-2 mt-2 rounded-lg bg-surface-1/95 p-3 text-left"
      role="group"
      aria-label={`Tool call ${toolId}`}
      data-testid="tool-call-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] text-ink-2">{toolId}</p>
          <p className="mt-0.5 text-xs font-medium text-ink-0">{intention}</p>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap ${
            status === "ok"
              ? "bg-accent-speak/20 text-accent-speak"
              : status === "error" || status === "cancelled"
                ? "bg-accent-ask/20 text-accent-ask"
                : status === "needs_approval"
                  ? "bg-accent-ask/20 text-accent-ask"
                  : "bg-accent-think/20 text-accent-think"
          }`}
        >
          {statusLabel[status]}
        </span>
      </div>

      {progress ? (
        <p className="mt-2 font-mono text-[11px] text-accent-think">{progress}</p>
      ) : null}

      {approvalSlot}

      {result ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-surface-0 p-2 font-mono text-[11px] text-ink-0 whitespace-pre-wrap">
          {result}
        </pre>
      ) : null}

      {sources && sources.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[11px] text-ink-2">
          {sources.map((s) => (
            <li key={`${s.label}-${s.date ?? ""}`}>
              {s.url ? (
                <a
                  href={s.url}
                  className="text-accent-listen hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.label}
                </a>
              ) : (
                s.label
              )}
              {s.date ? ` · ${s.date}` : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {rollbackAvailable && onRollback ? (
          <button
            type="button"
            className="btn-press rounded-md px-3 py-1.5 text-xs whitespace-nowrap text-ink-2 hover:text-ink-0"
            onClick={onRollback}
          >
            Reverter
          </button>
        ) : null}
        {(status === "pending" || status === "running") && onCancel ? (
          <button
            type="button"
            className="btn-press rounded-md px-3 py-1.5 text-xs whitespace-nowrap text-accent-ask"
            onClick={onCancel}
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </div>
  );
}
