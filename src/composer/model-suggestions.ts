import { getModelConfig, listModelAliases } from "@/core/config";
import {
  SAFE_MODEL_LABELS,
  SAFE_MODEL_PICKER_ALIASES,
} from "./safe-model-alias";
import type { MentionSuggestion } from "./mention-types";

export function filterModelSuggestions(
  query: string,
  aliases = listModelAliases(),
): MentionSuggestion[] {
  const q = query.trim().toLowerCase();
  return aliases
    .filter((a) => {
      if (!q) return true;
      const meta = SAFE_MODEL_LABELS[a];
      const hay = `${a} ${meta?.label ?? ""} ${meta?.detail ?? ""}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 12)
    .map((alias) => {
      const meta = SAFE_MODEL_LABELS[alias];
      if (meta) {
        return {
          id: `model:${alias}`,
          kind: "model" as const,
          label: meta.label,
          detail: meta.detail,
          value: alias,
        };
      }
      const cfg = getModelConfig(alias);
      return {
        id: `model:${alias}`,
        kind: "model" as const,
        label: alias === "local-openai" ? "omniroute" : alias,
        detail: cfg
          ? alias === "local-openai"
            ? "OmniRoute · localhost:20128"
            : `${cfg.provider} · ${cfg.adapter}`
          : "modelo",
        value: alias,
      };
    });
}

export function safeModelPickerAliases(): string[] {
  return [...SAFE_MODEL_PICKER_ALIASES];
}
