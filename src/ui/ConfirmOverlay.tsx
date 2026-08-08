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
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-surface-0/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="w-full max-w-md rounded-lg border border-surface-2 bg-surface-1 p-5 shadow-xl">
        <h3 id="confirm-title" className="text-lg font-medium text-ink-0">
          {title}
        </h3>
        <p className="mt-2 text-sm text-ink-1">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-sm text-ink-2 hover:text-ink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-1"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-accent-ask px-3 py-2 text-sm font-medium text-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ask"
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
