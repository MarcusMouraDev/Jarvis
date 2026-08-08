import { describe, expect, it } from "vitest";
import {
  commitMention,
  findActiveTrigger,
  serializeUserPrompt,
} from "./token-parser";

describe("findActiveTrigger", () => {
  it("detecta @modelo", () => {
    const t = findActiveTrigger("use @gem", 8);
    expect(t).toMatchObject({ kind: "model", query: "gem", trigger: "@" });
  });

  it("detecta #caminho", () => {
    const t = findActiveTrigger("#src/co", 7);
    expect(t).toMatchObject({ kind: "path", query: "src/co" });
  });

  it("não trata /run no início como skill", () => {
    expect(findActiveTrigger("/run ls", 4)).toBeNull();
  });

  it("trata /skill mid-line como menção", () => {
    const t = findActiveTrigger("abra /sdk", 9);
    expect(t).toMatchObject({ kind: "skill", query: "sdk" });
  });
});

describe("serializeUserPrompt", () => {
  it("limita skills a 4 e usa modelo do chip", () => {
    const payload = serializeUserPrompt(
      {
        text: "olámundo",
        cursor: 0,
        chips: [
          { id: "1", kind: "model", alias: "codex", label: "codex" },
          { id: "2", kind: "skill", name: "a", source: "extra", label: "a" },
          { id: "3", kind: "skill", name: "b", source: "extra", label: "b" },
          { id: "4", kind: "skill", name: "c", source: "extra", label: "c" },
          { id: "5", kind: "skill", name: "d", source: "extra", label: "d" },
          { id: "6", kind: "skill", name: "e", source: "extra", label: "e" },
        ],
      },
      "gemini",
    );
    expect(payload.alias).toBe("codex");
    expect(payload.skills).toEqual(["a", "b", "c", "d"]);
    expect(payload.autoSelectSkills).toBe(false);
  });
});

describe("commitMention", () => {
  it("substitui o gatilho e adiciona chip", () => {
    const draft = commitMention(
      { text: "hi @ge", chips: [], cursor: 6 },
      {
        kind: "model",
        trigger: "@",
        start: 3,
        query: "ge",
        replaceEnd: 6,
      },
      {
        id: "model:gemini",
        kind: "model",
        label: "gemini",
        detail: "google",
        value: "gemini",
      },
    );
    expect(draft.text.trim()).toBe("hi");
    expect(draft.chips[0]).toMatchObject({ kind: "model", alias: "gemini" });
  });
});
