import { describe, expect, it } from "vitest";
import { listSkills, selectSkillsForPrompt } from "./catalog";

describe("skills catalog", () => {
  it("lista skills do Cursor disponíveis no host", () => {
    const skills = listSkills();
    expect(skills.length).toBeGreaterThan(20);
    expect(skills.some((s) => s.name === "sdk" || s.name === "create-skill")).toBe(
      true,
    );
    expect(skills.some((s) => s.source === "codex")).toBe(true);
  });

  it("seleciona skills por palavras do prompt", () => {
    const selected = selectSkillsForPrompt(
      "quero integrar o Cursor SDK no backend",
      { limit: 3 },
    );
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.some((s) => s.name.includes("sdk") || s.body.length > 0)).toBe(
      true,
    );
  });
});
