import { getModelConfig, listModelAliases } from "@/core/config";
import type { MentionSuggestion } from "./mention-types";

export function filterModelSuggestions(
  query: string,
  aliases = listModelAliases(),
): MentionSuggestion[] {
  const q = query.trim().toLowerCase();
  return aliases
    .filter((a) => !q || a.toLowerCase().includes(q))
    .slice(0, 12)
    .map((alias) => {
      const cfg = getModelConfig(alias);
      return {
        id: `model:${alias}`,
        kind: "model" as const,
        label: alias,
        detail: cfg
          ? `${cfg.provider} · ${cfg.adapter}`
          : "modelo",
        value: alias,
      };
    });
}
