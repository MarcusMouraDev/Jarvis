"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface MemoryItem {
  id: string;
  kind: string;
  content: string;
  summary: string;
  metadata: Record<string, unknown>;
  confidence: number;
  consent: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemoryPanelProps {
  open: boolean;
  onClose: () => void;
}

const EMPTY_FORM = {
  kind: "note",
  content: "",
  summary: "",
  consent: false,
};

export function MemoryPanel({ open, onClose }: MemoryPanelProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [nowMs, setNowMs] = useState(0);
  const wasOpen = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/memory?limit=80");
      if (res.status === 404) {
        setEnabled(false);
        setMemories([]);
        return;
      }
      if (!res.ok) throw new Error(`http_${res.status}`);
      const data = (await res.json()) as { memories: MemoryItem[] };
      setEnabled(true);
      setMemories(data.memories ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      setNowMs(Date.now());
      queueMicrotask(() => {
        void refresh();
      });
    }
    if (!open) wasOpen.current = false;
  }, [open, refresh]);

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const save = async () => {
    if (!form.content.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        kind: form.kind.trim() || "note",
        content: form.content.trim(),
        summary: form.summary.trim() || undefined,
        consent: form.consent,
      };
      const res = await fetch("/api/memory", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingId ? { id: editingId, ...payload } : payload,
        ),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    } finally {
      setLoading(false);
    }
  };

  const toggleConsent = async (item: MemoryItem) => {
    setLoading(true);
    try {
      await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, consent: !item.consent }),
      });
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const expire = async (id: string) => {
    setLoading(true);
    try {
      await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "expire" }),
      });
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    setLoading(true);
    try {
      await fetch(`/api/memory?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (editingId === id) resetForm();
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (item: MemoryItem) => {
    setEditingId(item.id);
    setForm({
      kind: item.kind,
      content: item.content,
      summary: item.summary,
      consent: item.consent,
    });
  };

  if (!open) return null;

  return (
    <aside
      className="panel-z absolute inset-x-0 bottom-0 top-[var(--instrument-height,3.5rem)] z-40 flex flex-col bg-surface-0/96 shadow-[var(--shadow-panel)] backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Memória"
    >
      <div className="flex items-center justify-between border-b border-surface-2 px-4 py-2.5">
        <h2 className="text-sm font-medium text-ink-1">Memória consentida</h2>
        <button
          type="button"
          onClick={onClose}
          className="btn-press rounded-md px-2 py-1 text-xs whitespace-nowrap text-ink-2 hover:text-ink-0"
        >
          fechar
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {enabled === null ? (
          <p className="text-ink-2" role="status">
            {loading ? "Carregando memória…" : "Preparando memória…"}
          </p>
        ) : null}

        {error ? (
          <p className="text-[var(--state-danger)]" role="alert">
            Falha ao carregar memória: {error}
          </p>
        ) : null}

        {enabled === false ? (
          <p className="text-ink-2">
            Memória desativada. Defina <code className="font-mono">JARVIS_MEMORY=1</code>{" "}
            para habilitar.
          </p>
        ) : null}

        {enabled ? (
          <>
            <p className="text-xs text-ink-2">
              Escrita manual apenas — nada é salvo automaticamente pelo chat.
            </p>

            <div className="space-y-2 rounded-lg border border-surface-2 bg-surface-1 p-3">
              <div className="flex flex-wrap gap-2">
                <input
                  className="min-w-[6rem] flex-1 rounded-md border border-surface-2 bg-surface-0 px-2 py-1 text-xs"
                  placeholder="tipo (note, fact…)"
                  value={form.kind}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, kind: e.target.value }))
                  }
                />
                <label className="flex items-center gap-1 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={form.consent}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, consent: e.target.checked }))
                    }
                  />
                  consentimento
                </label>
              </div>
              <textarea
                className="w-full rounded-md border border-surface-2 bg-surface-0 px-2 py-1 text-xs"
                rows={3}
                placeholder="conteúdo"
                value={form.content}
                onChange={(e) =>
                  setForm((f) => ({ ...f, content: e.target.value }))
                }
              />
              <input
                className="w-full rounded-md border border-surface-2 bg-surface-0 px-2 py-1 text-xs"
                placeholder="resumo (opcional)"
                value={form.summary}
                onChange={(e) =>
                  setForm((f) => ({ ...f, summary: e.target.value }))
                }
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={loading || !form.content.trim()}
                  className="btn-press rounded-md bg-surface-2 px-3 py-1 text-xs text-ink-0 disabled:opacity-50"
                  onClick={() => void save()}
                >
                  {editingId ? "salvar" : "criar"}
                </button>
                {editingId ? (
                  <button
                    type="button"
                    className="btn-press rounded-md px-3 py-1 text-xs text-ink-2"
                    onClick={resetForm}
                  >
                    cancelar
                  </button>
                ) : null}
              </div>
            </div>

            {error ? <p className="text-xs text-accent-ask">{error}</p> : null}

            {loading && memories.length === 0 ? (
              <p className="text-ink-2">Carregando…</p>
            ) : memories.length === 0 ? (
              <p className="text-ink-2">Nenhuma memória ainda.</p>
            ) : (
              <ul className="space-y-3">
                {memories.map((m) => {
                  const expired =
                    m.expiresAt &&
                    nowMs > 0 &&
                    new Date(m.expiresAt).getTime() <= nowMs;
                  return (
                    <li
                      key={m.id}
                      className="rounded-lg border border-surface-2 bg-surface-1 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                        <span className="font-medium text-ink-1">{m.kind}</span>
                        <span>
                          {m.consent ? "consentida" : "sem consentimento"}
                        </span>
                        {expired ? <span>expirada</span> : null}
                      </div>
                      <p className="mt-1 text-ink-0">{m.summary || m.content}</p>
                      <p className="mt-1 line-clamp-3 font-mono text-[11px] text-ink-2">
                        {m.content}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-press text-xs text-ink-2 underline-offset-2 hover:underline"
                          onClick={() => startEdit(m)}
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          className="btn-press text-xs text-ink-2 underline-offset-2 hover:underline"
                          onClick={() => void toggleConsent(m)}
                        >
                          {m.consent ? "revogar" : "consentir"}
                        </button>
                        {!expired ? (
                          <button
                            type="button"
                            className="btn-press text-xs text-ink-2 underline-offset-2 hover:underline"
                            onClick={() => void expire(m.id)}
                          >
                            expirar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-press text-xs text-accent-ask underline-offset-2 hover:underline"
                          onClick={() => void remove(m.id)}
                        >
                          apagar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </aside>
  );
}
