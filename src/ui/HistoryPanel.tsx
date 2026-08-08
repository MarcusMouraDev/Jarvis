export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string;
}

interface HistoryPanelProps {
  open: boolean;
  messages: ChatMessage[];
  onClose: () => void;
}

export function HistoryPanel({ open, messages, onClose }: HistoryPanelProps) {
  if (!open) return null;

  return (
    <aside className="absolute inset-x-0 bottom-0 top-14 z-20 flex flex-col bg-surface-0/95 backdrop-blur">
      <div className="flex items-center justify-between border-b border-surface-2 px-4 py-2">
        <h2 className="text-sm font-medium text-ink-1">Histórico</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-2 hover:text-ink-0"
        >
          fechar
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 ? (
          <p className="text-ink-2">Nenhuma mensagem ainda.</p>
        ) : (
          messages.map((m) => (
            <article key={m.id} className="rounded-md bg-surface-1 p-3">
              <div className="mb-1 font-mono text-xs uppercase text-ink-2">
                {m.role}
              </div>
              <p className="whitespace-pre-wrap text-ink-0">{m.text}</p>
              {m.meta ? (
                <p className="mt-2 font-mono text-xs text-ink-2">{m.meta}</p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
