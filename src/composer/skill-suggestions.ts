import type { MentionSuggestion } from "./mention-types";

export function filterSkillSuggestions(
  query: string,
  catalog: Array<{ name: string; description: string; source: string }>,
  selectedNames: string[] = [],
): MentionSuggestion[] {
  const q = query.trim().toLowerCase();
  const selected = new Set(selectedNames);
  return catalog
    .filter((s) => !selected.has(s.name))
    .filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    )
    .slice(0, 20)
    .map((s) => ({
      id: `skill:${s.name}`,
      kind: "skill" as const,
      label: s.name,
      detail: `${s.source} · ${s.description || "sem descrição"}`,
      value: `${s.name}|${s.source}`,
    }));
}
