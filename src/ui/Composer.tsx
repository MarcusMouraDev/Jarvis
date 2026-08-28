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

  const addImageFiles = (files: FileList | File[]) => {
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0 || !onChipsChange) return;
    for (const file of images.slice(0, 4)) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        const contentBase64 = dataUrl.includes(",")
          ? dataUrl.slice(dataUrl.indexOf(",") + 1)
          : "";
        if (!contentBase64) return;
        onChipsChange([
          ...chips,
          {
            id: `image:${file.name}:${file.size}:${file.lastModified}`,
            kind: "image",
            label: file.name,
            contentBase64,
            filename: file.name,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <form
      className="composer-dock"
      onSubmit={(e) => {
        e.preventDefault();
        if (open) {
          void selectSuggestion();
          return;
        }
        onSubmit();
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        addImageFiles(event.dataTransfer.files);
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

        <div className="composer-console">
          <input
            ref={inputRef}
            id="jarvis-composer"
            className="composer-field"
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
              if (e.key === "Escape" && !open && busy && onCancel) {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
                return;
              }
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
                e.stopPropagation();
                setSuggestions([]);
              }
            }}
            onPaste={(event) => {
              const files = event.clipboardData?.files;
              if (files && files.length > 0) {
                event.preventDefault();
                addImageFiles(files);
              }
            }}
            placeholder="@omniroute  @gemini  @cursor-text  /skill  #Documents/… #Projetos/…"
            aria-label="Compositor"
            autoComplete="off"
          />
          {busy && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancelar resposta"
              className="composer-send composer-send--stop"
            >
              Parar
            </button>
          ) : (
            <button
              type="submit"
              disabled={
                disabled ||
                (!value.trim() &&
                  !chips.some((chip) => chip.kind === "image" || chip.kind === "path"))
              }
              className="composer-send"
            >
              Enviar
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
