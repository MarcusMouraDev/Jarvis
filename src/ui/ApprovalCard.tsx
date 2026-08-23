"use client";

import type { ClassifiedPayload } from "@/lib/shell-client";

interface ApprovalCardProps {
  command: string;
  classified: ClassifiedPayload;
  cwd: string;
  timeoutMs: number;
  onApprove: () => void;
  onDeny: () => void;
}

export function ApprovalCard({
  command,
  classified,
  cwd,
  timeoutMs,
  onApprove,
  onDeny,
}: ApprovalCardProps) {
  return (
    <div
      className="elev-2 mt-2 rounded-lg bg-surface-1/95 p-3 text-left"
      role="group"
      aria-label="Aprovação de comando"
      data-testid="approval-card"
    >
      <p className="text-xs font-medium text-accent-ask">Aprovação necessária</p>
      <pre className="mt-2 overflow-x-auto rounded-md bg-surface-0 p-2 font-mono text-[11px] text-ink-0 whitespace-pre-wrap">
        {command}
      </pre>
      <dl className="mt-2 grid gap-1 text-[11px] text-ink-2">
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0 whitespace-nowrap">argv</dt>
          <dd className="min-w-0 truncate font-mono text-ink-1">
            {classified.argv.join(" ") || "—"}
          </dd>
        </div>
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0 whitespace-nowrap">motivos</dt>
          <dd className="min-w-0 text-ink-1">
            {classified.reasons.join(" · ") || "—"}
          </dd>
        </div>
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0 whitespace-nowrap">cwd</dt>
          <dd className="min-w-0 truncate font-mono text-ink-1">{cwd}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 whitespace-nowrap">timeout</dt>
          <dd className="font-mono text-ink-1">{timeoutMs}ms</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn-press min-h-11 min-w-11 rounded-md px-3 py-1.5 text-xs whitespace-nowrap text-ink-2 hover:text-ink-0"
          onClick={onDeny}
          autoFocus
        >
          Recusar
        </button>
        <button
          type="button"
          className="btn-press min-h-11 min-w-11 rounded-md bg-accent-ask px-3 py-1.5 text-xs font-medium whitespace-nowrap text-surface-0"
          onClick={onApprove}
        >
          Executar
        </button>
      </div>
    </div>
  );
}
