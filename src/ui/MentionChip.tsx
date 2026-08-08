"use client";

import type { ComposerChip } from "@/composer/mention-types";

const KIND_LABEL: Record<ComposerChip["kind"], string> = {
  model: "@",
  skill: "/",
  path: "#",
};

export function MentionChip({
  chip,
  onRemove,
}: {
  chip: ComposerChip;
  onRemove: (id: string) => void;
}) {
  return (
    <span className="mention-chip inline-flex max-w-full items-center gap-1 rounded-full border border-[color:color-mix(in_oklch,var(--color-accent)_35%,transparent)] bg-[color:color-mix(in_oklch,var(--color-accent)_12%,transparent)] px-2 py-0.5 text-[11px] text-[var(--color-text)]">
      <span className="opacity-70">{KIND_LABEL[chip.kind]}</span>
      <span className="truncate">{chip.label}</span>
      <button
        type="button"
        className="ml-0.5 rounded-full px-1 opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        aria-label={`Remover ${chip.label}`}
        onClick={() => onRemove(chip.id)}
      >
        ×
      </button>
    </span>
  );
}
