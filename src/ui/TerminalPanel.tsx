"use client";

import { ApprovalCard } from "./ApprovalCard";
import { ToolCallCard } from "./ToolCallCard";
import type { ClassifiedPayload } from "@/lib/shell-client";

export interface TerminalLine {
  id: string;
  kind: "stdout" | "stderr" | "meta" | "cmd";
  text: string;
}

export interface PendingShellApproval {
  approvalId: string;
  runId: string;
  command: string;
  classified: ClassifiedPayload;
  cwd: string;
  timeoutMs: number;
}

interface TerminalPanelProps {
  open: boolean;
  lines: TerminalLine[];
  exitCode: number | null;
  running: boolean;
  pending: PendingShellApproval | null;
  onClose: () => void;
  onCancel: () => void;
  onApprove: () => void;
  onDeny: () => void;
}

export function TerminalPanel({
  open,
  lines,
  exitCode,
  running,
  pending,
  onClose,
  onCancel,
  onApprove,
  onDeny,
}: TerminalPanelProps) {
  if (!open) return null;

  return (
    <aside
      className="sheet-panel panel-z elev-3 flex flex-col overflow-hidden bg-surface-0/96 backdrop-blur-md"
      role="dialog"
      aria-modal="false"
      aria-label="Terminal"
      data-testid="terminal-panel"
    >
      <div className="chrome-z flex items-center justify-between border-b border-surface-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-sm font-medium whitespace-nowrap text-ink-1">
            Terminal
          </h2>
          {exitCode !== null ? (
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap ${
                exitCode === 0
                  ? "bg-accent-speak/20 text-accent-speak"
                  : "bg-accent-ask/20 text-accent-ask"
              }`}
            >
              exit {exitCode}
            </span>
          ) : null}
          {running ? (
            <span className="font-mono text-[10px] text-accent-think whitespace-nowrap">
              rodando…
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          {running ? (
            <button
              type="button"
              className="btn-press rounded-md px-2 py-1 text-xs whitespace-nowrap text-accent-ask"
              onClick={onCancel}
            >
              cancelar
            </button>
          ) : null}
          <button
            type="button"
            className="btn-press rounded-md px-2 py-1 text-xs whitespace-nowrap text-ink-2 hover:text-ink-0"
            onClick={onClose}
          >
            fechar
          </button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed"
        aria-live="polite"
      >
        {lines.length === 0 && !pending ? (
          <p className="text-ink-2">
            Use <span className="text-ink-1">/run &lt;cmd&gt;</span> ou{" "}
            <span className="text-ink-1">!cmd</span>.
          </p>
        ) : null}
        {lines.map((line) => (
          <pre
            key={line.id}
            className={`whitespace-pre-wrap break-words ${
              line.kind === "stderr"
                ? "text-accent-ask"
                : line.kind === "cmd"
                  ? "text-accent-listen"
                  : line.kind === "meta"
                    ? "text-ink-2"
                    : "text-ink-0"
            }`}
          >
            {line.text}
          </pre>
        ))}
        {pending ? (
          <ToolCallCard
            toolId="shell.run"
            intention="Executar comando no terminal"
            status="needs_approval"
            progress={pending.command}
            approvalSlot={
              <ApprovalCard
                command={pending.command}
                classified={pending.classified}
                cwd={pending.cwd}
                timeoutMs={pending.timeoutMs}
                onApprove={onApprove}
                onDeny={onDeny}
              />
            }
          />
        ) : null}
      </div>
    </aside>
  );
}
