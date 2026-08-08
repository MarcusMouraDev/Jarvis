"use client";

import type { MentionSuggestion } from "@/composer/mention-types";

export function MentionPopover({
  open,
  suggestions,
  activeIndex,
  listboxId,
  onSelect,
}: {
  open: boolean;
  suggestions: MentionSuggestion[];
  activeIndex: number;
  listboxId: string;
  onSelect: (s: MentionSuggestion) => void;
}) {
  if (!open || !suggestions.length) return null;

  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label="Sugestões de menção"
      className="mention-popover absolute bottom-[calc(100%+0.4rem)] left-0 z-30 max-h-56 w-full overflow-auto rounded-xl border border-[color:color-mix(in_oklch,var(--color-border)_80%,transparent)] bg-[color:color-mix(in_oklch,var(--color-surface)_92%,black)] p-1 shadow-lg backdrop-blur-md"
    >
      {suggestions.map((s, i) => {
        const active = i === activeIndex;
        return (
          <li
            key={s.id}
            id={`${listboxId}-opt-${i}`}
            role="option"
            aria-selected={active}
            className={`cursor-pointer rounded-lg px-2.5 py-2 ${
              active
                ? "bg-[color:color-mix(in_oklch,var(--color-accent)_18%,transparent)]"
                : "hover:bg-[color:color-mix(in_oklch,var(--color-fg)_6%,transparent)]"
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(s);
            }}
          >
            <div className="truncate text-[12px] text-[var(--color-text)]">
              {s.label}
            </div>
            <div className="truncate text-[10px] text-[var(--color-muted)]">
              {s.detail}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
