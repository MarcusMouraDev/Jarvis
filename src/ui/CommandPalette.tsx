"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteSkill {
  name: string;
  description: string;
  source: string;
}

export interface PaletteRun {
  id: string;
  kind: string;
  status: string;
  summary?: string;
  startedAt: string;
}

type PaletteItem =
  | { id: string; group: "skills"; label: string; detail: string; skill: PaletteSkill }
  | { id: string; group: "commands"; label: string; detail: string; action: string }
  | { id: string; group: "runs"; label: string; detail: string; run: PaletteRun };

interface CommandPaletteProps {
  skills: PaletteSkill[];
  runs: PaletteRun[];
  onClose: () => void;
  onAction: (action: string, meta?: { skill?: string; shift?: boolean }) => void;
}

const COMMANDS: Array<{ action: string; label: string; detail: string }> = [
  { action: "history", label: "Histórico", detail: "Abrir histórico ^H" },
  { action: "terminal", label: "Terminal", detail: "Abrir painel de terminal" },
  { action: "runs", label: "Execuções", detail: "Listar runs recentes" },
  { action: "voice-toggle", label: "Alternar voz", detail: "^V" },
  { action: "listen-toggle", label: "Alternar ouvir", detail: "^L" },
  { action: "model-gemini", label: "Modelo gemini", detail: "/select model gemini" },
  { action: "model-codex", label: "Modelo codex", detail: "/select model codex" },
  { action: "skills-list", label: "Listar skills", detail: "/skills list" },
];

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-accent-listen/30 text-ink-0">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Mount only when open — remount resets query/active without effect setState. */
export function CommandPalette({
  skills,
  runs,
  onClose,
  onAction,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);

    const skillItems: PaletteItem[] = skills
      .filter((s) => match(`${s.name} ${s.description}`))
      .slice(0, 12)
      .map((s) => ({
        id: `skill:${s.name}`,
        group: "skills" as const,
        label: s.name,
        detail: `${s.source} · ${s.description}`,
        skill: s,
      }));

    const commandItems: PaletteItem[] = COMMANDS.filter((c) =>
      match(`${c.label} ${c.detail}`),
    ).map((c) => ({
      id: `cmd:${c.action}`,
      group: "commands" as const,
      label: c.label,
      detail: c.detail,
      action: c.action,
    }));

    const runItems: PaletteItem[] = runs
      .filter((r) => match(`${r.kind} ${r.status} ${r.summary ?? ""}`))
      .slice(0, 8)
      .map((r) => ({
        id: `run:${r.id}`,
        group: "runs" as const,
        label: `${r.kind} · ${r.status}`,
        detail: r.summary ?? r.startedAt,
        run: r,
      }));

    return [...skillItems, ...commandItems, ...runItems];
  }, [query, skills, runs]);

  const safeActive = items.length === 0 ? 0 : Math.min(active, items.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runActive = (shift: boolean) => {
    const item = items[safeActive];
    if (!item) return;
    if (item.group === "skills") {
      onAction("skill-use", { skill: item.skill.name, shift });
    } else if (item.group === "commands") {
      onAction(item.action);
    } else {
      onAction("show-run", { skill: item.run.id });
    }
  };

  const onRowPointer = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  const groups = ["skills", "commands", "runs"] as const;
  const groupLabel = {
    skills: "Skills",
    commands: "Comandos",
    runs: "Execuções",
  };

  return (
    <div
      className="confirm-z absolute inset-0 flex items-start justify-center bg-surface-0/70 p-3 pt-[12vh] backdrop-blur-sm sm:p-6 sm:pt-[14vh]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="elev-3 flex w-full max-w-xl flex-col overflow-hidden rounded-xl bg-surface-1"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        data-testid="command-palette"
      >
        <input
          ref={inputRef}
          className="border-b border-surface-2 bg-transparent px-4 py-3 text-sm text-ink-0 outline-none placeholder:text-ink-2"
          placeholder="Buscar skills, comandos, execuções…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              runActive(e.shiftKey);
            }
          }}
          aria-controls="palette-list"
          aria-activedescendant={items[safeActive]?.id}
        />
        <div
          id="palette-list"
          role="listbox"
          className="max-h-[min(52vh,420px)] overflow-y-auto p-2"
        >
          {items.length === 0 ? (
            <p className="px-2 py-4 text-sm text-ink-2">Nenhum resultado.</p>
          ) : (
            groups.map((g) => {
              const groupItems = items.filter((i) => i.group === g);
              if (!groupItems.length) return null;
              return (
                <div key={g} className="mb-2">
                  <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-2">
                    {groupLabel[g]}
                  </p>
                  {groupItems.map((item) => {
                    const index = items.indexOf(item);
                    const selected = index === safeActive;
                    return (
                      <button
                        key={item.id}
                        id={item.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`spotlight-row flex w-full flex-col rounded-lg px-3 py-2 text-left ${
                          selected ? "bg-surface-2/80" : ""
                        }`}
                        onMouseEnter={() => setActive(index)}
                        onPointerMove={onRowPointer}
                        onClick={(e) => {
                          setActive(index);
                          runActive(e.shiftKey);
                        }}
                      >
                        <span className="text-sm text-ink-0">
                          {highlight(item.label, query)}
                        </span>
                        <span className="line-clamp-1 text-[11px] text-ink-2">
                          {item.detail}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <p className="border-t border-surface-2 px-3 py-2 font-mono text-[10px] text-ink-2">
          ↑↓ navegar · Enter usar · Shift+Enter mostrar skill · Esc fechar
        </p>
      </div>
    </div>
  );
}
