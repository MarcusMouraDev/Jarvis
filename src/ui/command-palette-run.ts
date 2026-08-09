type PaletteItem =
  | { group: "skills"; skill: { name: string } }
  | { group: "commands"; action: string }
  | { group: "runs"; run: { id: string } };

export function resolvePaletteAction(
  item: PaletteItem | undefined,
  shift: boolean,
): { action: string; meta?: { skill?: string; shift?: boolean } } | null {
  if (!item) return null;
  if (item.group === "skills") {
    return { action: "skill-use", meta: { skill: item.skill.name, shift } };
  }
  if (item.group === "commands") {
    return { action: item.action };
  }
  return { action: "show-run", meta: { skill: item.run.id } };
}
