"use client";

import { useCallback, useEffect, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string;
}

export interface RunSummary {
  id: string;
  kind: string;
  status: string;
  summary?: string;
  startedAt: string;
  latencyMs?: number;
  costUsd?: number;
  stepCount?: number;
}

interface RunDetail {
  run: RunSummary;
  steps: Array<{ seq: number; type: string; summary: string; at: string }>;
  approvals: Array<{
    id: string;
    action: string;
    scope: string;
    decision: string;
  }>;
}

interface HistoryPanelProps {
  open: boolean;
  messages: ChatMessage[];
  runs: RunSummary[];
  tab: "messages" | "runs";
  onTabChange: (tab: "messages" | "runs") => void;
  onClose: () => void;
}

export function HistoryPanel({
  open,
  messages,
  runs,
  tab,
  onTabChange,
  onClose,
}: HistoryPanelProps) {
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessage[] | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);

  const fetchHistory = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/history?q=${encodeURIComponent(q)}&limit=50`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { messages: ChatMessage[] };
      setSearchResults(data.messages ?? []);
    } catch {
      // ignore
    }
  }, []);

  const fetchRunDetail = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs?id=${encodeURIComponent(runId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as RunDetail;
      setRunDetail(data);
      setSelectedRunId(runId);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void fetchHistory(searchQ);
    }, 250);
    return () => clearTimeout(timer);
  }, [open, searchQ, fetchHistory]);

  const handleClose = () => {
    setSelectedRunId(null);
    setRunDetail(null);
    onClose();
  };

  if (!open) return null;

  const displayMessages = searchResults ?? messages;

  return (
    <aside
      className="absolute inset-x-0 bottom-0 top-12 z-40 flex flex-col bg-surface-0/96 shadow-[var(--shadow-panel)] backdrop-blur-md sm:top-14"
      role="dialog"
      aria-modal="true"
      aria-label="Histórico"
    >
      <div className="flex items-center justify-between border-b border-surface-2 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-ink-1">Histórico</h2>
          <div className="flex gap-1">
            <button
              type="button"
              className={`btn-press rounded-md px-2 py-1 text-xs whitespace-nowrap ${
                tab === "messages" ? "bg-surface-2 text-ink-0" : "text-ink-2"
              }`}
              onClick={() => onTabChange("messages")}
            >
              mensagens
            </button>
            <button
              type="button"
              className={`btn-press rounded-md px-2 py-1 text-xs whitespace-nowrap ${
                tab === "runs" ? "bg-surface-2 text-ink-0" : "text-ink-2"
              }`}
              onClick={() => onTabChange("runs")}
            >
              execuções
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="btn-press rounded-md px-2 py-1 text-xs whitespace-nowrap text-ink-2 hover:text-ink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-1"
        >
          fechar
        </button>
      </div>

      {tab === "messages" ? (
        <div className="border-b border-surface-2 px-4 py-2">
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Buscar mensagens…"
            className="w-full rounded-md border border-surface-2 bg-surface-1 px-3 py-1.5 text-sm text-ink-0 placeholder:text-ink-2 focus:outline-none focus:ring-1 focus:ring-ink-2"
          />
        </div>
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {tab === "messages" ? (
          displayMessages.length === 0 ? (
            <p className="text-ink-2">Nenhuma mensagem ainda.</p>
          ) : (
            displayMessages.map((m) => (
              <article
                key={m.id}
                className="spotlight-row elev-1 rounded-lg bg-surface-1 p-3"
                onPointerMove={(e) => {
                  const el = e.currentTarget;
                  const rect = el.getBoundingClientRect();
                  el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
                  el.style.setProperty("--my", `${e.clientY - rect.top}px`);
                }}
              >
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-2">
                  {m.role}
                </div>
                <p className="whitespace-pre-wrap text-ink-0">{m.text}</p>
                {m.meta ? (
                  <p className="mt-2 font-mono text-xs text-ink-2">{m.meta}</p>
                ) : null}
              </article>
            ))
          )
        ) : runs.length === 0 ? (
          <p className="text-ink-2">Nenhuma execução ainda.</p>
        ) : (
          runs.map((r) => (
            <article
              key={r.id}
              className="spotlight-row elev-1 rounded-lg bg-surface-1 p-3"
              onPointerMove={(e) => {
                const el = e.currentTarget;
                const rect = el.getBoundingClientRect();
                el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
                el.style.setProperty("--my", `${e.clientY - rect.top}px`);
              }}
            >
              <div className="mb-1 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-wide text-ink-2">
                <span className="whitespace-nowrap">{r.kind}</span>
                <span className="whitespace-nowrap">{r.status}</span>
                {r.latencyMs != null ? (
                  <span className="whitespace-nowrap">{r.latencyMs}ms</span>
                ) : null}
                {r.stepCount != null ? (
                  <span className="whitespace-nowrap">{r.stepCount} steps</span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-ink-0">
                {r.summary ?? r.id}
              </p>
              <p className="mt-2 font-mono text-xs text-ink-2">{r.startedAt}</p>
              <button
                type="button"
                className="btn-press mt-2 text-xs text-ink-2 underline-offset-2 hover:text-ink-0 hover:underline"
                onClick={() => void fetchRunDetail(r.id)}
              >
                {selectedRunId === r.id ? "detalhes abertos" : "ver detalhes"}
              </button>
              {selectedRunId === r.id && runDetail ? (
                <div className="mt-3 space-y-2 border-t border-surface-2 pt-3 text-xs">
                  <p className="font-mono text-ink-2">ID: {runDetail.run.id}</p>
                  {runDetail.steps.length > 0 ? (
                    <ul className="space-y-1">
                      {runDetail.steps.map((s) => (
                        <li key={s.seq} className="text-ink-1">
                          <span className="font-mono text-ink-2">
                            {s.seq}. {s.type}
                          </span>{" "}
                          — {s.summary}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-ink-2">Sem steps.</p>
                  )}
                  {runDetail.approvals.length > 0 ? (
                    <div>
                      <p className="mb-1 font-mono text-ink-2">Aprovações</p>
                      <ul className="space-y-1">
                        {runDetail.approvals.map((a) => (
                          <li key={a.id} className="text-ink-1">
                            {a.decision}: {a.action} ({a.scope})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
