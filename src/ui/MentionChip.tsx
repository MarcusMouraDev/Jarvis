"use client";

import type { ComposerChip } from "@/composer/mention-types";

const KIND_LABEL: Record<ComposerChip["kind"], string> = {
  model: "@",
  skill: "/",
  path: "#",
  image: "img",
};

export function MentionChip({
  chip,
  onRemove,
}: {
  chip: ComposerChip;
  onRemove: (id: string) => void;
}) {
  return (
    <span className="mention-chip">
      <span>{KIND_LABEL[chip.kind]}</span>
      <span className="truncate">{chip.label}</span>
      <button
        type="button"
        aria-label={`Remover ${chip.label}`}
        onClick={() => onRemove(chip.id)}
      >
        ×
      </button>
    </span>
  );
}
