"use client";

import { useEffect, useId, useRef } from "react";
import type { ComposerChip, PathContextSummary } from "@/composer/mention-types";
import { filterModelSuggestions } from "@/composer/model-suggestions";
import { filterSkillSuggestions } from "@/composer/skill-suggestions";
import { useMentionAutocomplete } from "@/composer/use-mention-autocomplete";
import { MentionChip } from "./MentionChip";
import { MentionPopover } from "./MentionPopover";

interface SkillCatalogItem {
  name: string;
  description: string;
  source: string;
}

interface ComposerProps {
  value: string;
  disabled: boolean;
  chips?: ComposerChip[];
  onChange: (value: string) => void;
  onChipsChange?: (chips: ComposerChip[]) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  busy?: boolean;
  skillCatalog?: SkillCatalogItem[];
  modelAliases?: string[];
}

const EMPTY_CHIPS: ComposerChip[] = [];
const EMPTY_SKILL_CATALOG: SkillCatalogItem[] = [];
const EMPTY_MODEL_ALIASES: string[] = [];

const HINTS = [
  "/select model gemini",
  "/select model codex",
  "/select model deepseek-flash",
  "/skills list",
  "/skill use sdk",
  "/skill clear",
  "/run ls",
  "/profile conversa",
  "/voice on",
  "/voice off",
];

export function Composer({
  value,
  disabled,
  chips = EMPTY_CHIPS,
  onChange,
  onChipsChange,
  onSubmit,
  onCancel,
  busy = false,
  skillCatalog = EMPTY_SKILL_CATALOG,
  modelAliases = EMPTY_MODEL_ALIASES,
}: ComposerProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    setDraft,
    trigger,
    suggestions,
    setSuggestions,
    activeIndex,
    open,
    updateText,
    setCursor,
    removeChip,
    applySuggestion,
    move,
  } = useMentionAutocomplete({ text: value, chips, cursor: value.length });

  // Keep external controlled value/chips in sync.
  useEffect(() => {
    setDraft((d) => ({
      ...d,
      text: value,
      chips,
      cursor: Math.min(d.cursor, value.length),
    }));
  }, [value, chips, setDraft]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!trigger) {
        setSuggestions((current) => (current.length === 0 ? current : []));
        return;
      }

      if (trigger.kind === "model") {
        setSuggestions(filterModelSuggestions(trigger.query, modelAliases));
        return;
      }

      if (trigger.kind === "skill") {
        let catalog = skillCatalog;
        if (!catalog.length) {
          try {
            const res = await fetch("/api/skills");
            if (res.ok) {
              const data = (await res.json()) as {
                skills: SkillCatalogItem[];
              };
              catalog = data.skills ?? [];
            }
          } catch {
            catalog = [];
          }
        }
        if (cancelled) return;
        setSuggestions(
          filterSkillSuggestions(
            trigger.query,
            catalog,
            chips.filter((c) => c.kind === "skill").map((c) => c.name),
          ),
        );
        return;
      }

      // path
      try {
        const res = await fetch(
          `/api/context/paths?q=${encodeURIComponent(trigger.query)}`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          paths: Array<{ relPath: string; isDir: boolean }>;
        };
        setSuggestions(
          data.paths.map((p) => ({
            id: `path:${p.relPath}`,
            kind: "path" as const,
            label: p.relPath,
            detail: p.isDir ? "diretório" : "arquivo",
            value: p.relPath,
          })),
        );
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [trigger, modelAliases, skillCatalog, chips, setSuggestions]);

  const emitChips = (next: ComposerChip[]) => {
    onChipsChange?.(next);
  };

  const selectSuggestion = async (
    indexOrSuggestion: number | (typeof suggestions)[number] = activeIndex,
  ) => {
    const suggestion =
      typeof indexOrSuggestion === "number"
        ? suggestions[indexOrSuggestion]
        : indexOrSuggestion;
    if (!suggestion || !trigger) return;

    if (suggestion.kind === "path") {
      try {
        const res = await fetch("/api/context/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: suggestion.value }),
        });
        const data = (await res.json()) as
          | { summary: PathContextSummary }
          | { error: string };
        if (!res.ok || !("summary" in data)) return;

        applySuggestion(suggestion, trigger);
        const pathChip: ComposerChip = {
          id: crypto.randomUUID(),
          kind: "path",
          relPath: suggestion.value,
          label: suggestion.label,
          summary: data.summary,
        };
        const nextChips: ComposerChip[] = [
          ...chips.filter(
            (c) => !(c.kind === "path" && c.relPath === suggestion.value),
          ),
          pathChip,
        ].slice(0, 12);
        // Remove trigger text
        const before = value.slice(0, trigger.start);
        const after = value.slice(trigger.replaceEnd);
        const nextText = `${before}${after}`.replace(/\s{2,}/g, " ");
        onChange(nextText);
        emitChips(nextChips);
        return;
      } catch {
        return;
      }
    }

    applySuggestion(suggestion, trigger);
    const before = value.slice(0, trigger.start);
    const after = value.slice(trigger.replaceEnd);
    const nextText = `${before}${after}`.replace(/\s{2,}/g, " ");
    onChange(nextText);

    if (suggestion.kind === "model") {
      emitChips([
        ...chips.filter((c) => c.kind !== "model"),
        {
          id: crypto.randomUUID(),
          kind: "model",
          alias: suggestion.value,
          label: suggestion.label,
        },
      ]);
    } else if (suggestion.kind === "skill") {
      const [name, source = "extra"] = suggestion.value.includes("|")
        ? suggestion.value.split("|")
        : [suggestion.value, "extra"];
      if (chips.filter((c) => c.kind === "skill").length >= 4) return;
      if (chips.some((c) => c.kind === "skill" && c.name === name)) return;
      emitChips([
        ...chips,
        {
          id: crypto.randomUUID(),
          kind: "skill",
          name: name!,
          source,
          label: suggestion.label,
        },
      ]);
    }
  };

  return (
    <form
      className="composer-dock chrome-z shrink-0 border-t border-surface-2/80 bg-surface-1/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-dock)] backdrop-blur-md sm:px-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (open) {
          void selectSuggestion();
          return;
        }
        onSubmit();
      }}
    >
      <div className="relative mx-auto max-w-3xl">
        <MentionPopover
          open={open}
          suggestions={suggestions}
          activeIndex={activeIndex}
          listboxId={listboxId}
          onSelect={(s) => void selectSuggestion(s)}
        />

        {chips.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Contexto anexado">
            {chips.map((chip) => (
              <MentionChip
                key={chip.id}
                chip={chip}
                onRemove={(id) => {
                  const next = chips.filter((c) => c.id !== id);
                  emitChips(next);
                  removeChip(id);
                }}
              />
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="jarvis-composer"
            className="min-w-0 flex-1 rounded-lg border border-surface-2 bg-surface-0 px-3 py-2.5 text-sm text-ink-0 outline-none placeholder:text-ink-2/70 focus-visible:border-accent-listen focus-visible:ring-2 focus-visible:ring-accent-listen/35"
            value={value}
            disabled={disabled}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={
              open ? `${listboxId}-opt-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            onChange={(e) => {
              const next = e.target.value;
              onChange(next);
              updateText(next, e.target.selectionStart ?? next.length);
            }}
            onClick={(e) =>
              setCursor(e.currentTarget.selectionStart ?? value.length)
            }
            onKeyUp={(e) =>
              setCursor(e.currentTarget.selectionStart ?? value.length)
            }
            onKeyDown={(e) => {
              if (!open) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                void selectSuggestion();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setSuggestions([]);
              }
            }}
            placeholder="@modelo  /skill  #caminho  /run …"
            aria-label="Compositor"
            list="slash-hints"
            autoComplete="off"
          />
          {busy && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancelar resposta"
              className="btn-press min-h-11 min-w-11 shrink-0 rounded-lg border border-[var(--state-danger)] px-3 py-2.5 text-sm font-medium whitespace-nowrap text-[var(--state-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              Parar
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || !value.trim()}
              className="btn-press min-h-11 min-w-11 shrink-0 rounded-lg bg-accent-listen px-4 py-2.5 text-sm font-medium whitespace-nowrap text-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-listen disabled:opacity-40"
            >
              Enviar
            </button>
          )}
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-3xl font-mono text-[10px] tracking-wide text-ink-2/80 sm:text-[11px]">
        {busy ? "recebendo · Esc cancela" : "⌘K · hist ^H · voz ^V · @ / # · cancelar Esc"}
      </p>
      <datalist id="slash-hints">
        {HINTS.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
    </form>
  );
}
