"use client";

import { useRef } from "react";
import { useDialogFocus } from "./use-dialog-focus";

interface OverlayProps {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmOverlay({
  title,
  body,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: OverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef, onCancel);

  return (
    <div
      className="confirm-z absolute inset-0 flex items-center justify-center bg-surface-0/80 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="elev-3 w-full max-w-md rounded-xl border border-surface-2 bg-surface-1 p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h3 id="confirm-title" className="text-lg font-medium text-ink-0">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-1">{body}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="btn-press min-h-11 min-w-11 rounded-md px-3 py-2 text-sm whitespace-nowrap text-ink-2 hover:text-ink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-press min-h-11 min-w-11 rounded-md bg-accent-ask px-3 py-2 text-sm font-medium whitespace-nowrap text-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ask"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
