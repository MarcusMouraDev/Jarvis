import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface SoulCase {
  id: string;
  case: string;
  required_facts: string;
  response: string;
}

describe("Jarvis soul evaluation contract", () => {
  it("versions every required response scenario", () => {
    const cases = JSON.parse(
      readFileSync(path.join(process.cwd(), "evaluation/jarvis-soul-cases.json"), "utf8"),
    ) as SoulCase[];

    expect(cases.map((item) => item.id)).toEqual([
      "normal",
      "active-task",
      "risky",
      "failure",
      "ambiguous",
      "casual",
    ]);
    for (const item of cases) {
      expect(item.case.length).toBeGreaterThan(10);
      expect(item.required_facts.length).toBeGreaterThan(10);
      expect(item.response.length).toBeGreaterThan(10);
    }
  });

  it("uses typed Outlines generation and Pydantic validation", () => {
    const evaluator = readFileSync(path.join(process.cwd(), "scripts/evaluate-jarvis-soul.py"), "utf8");
    expect(evaluator).toContain("outlines.from_openai");
    expect(evaluator).toContain("JarvisSoulRubric.model_validate_json");
    expect(evaluator).not.toMatch(/re\.(?:match|search|findall)/);
  });
});
