import { describe, expect, it } from "vitest";
import { resolvePaletteAction } from "./command-palette-run";

describe("resolvePaletteAction", () => {
  it("executa o item passado, não um índice stale", () => {
    const second = { group: "commands" as const, action: "terminal" };
    expect(resolvePaletteAction(second, false)).toEqual({
      action: "terminal",
    });
  });

  it("ignora undefined", () => {
    expect(resolvePaletteAction(undefined, false)).toBeNull();
  });

  it("passa skill + shift", () => {
    expect(
      resolvePaletteAction(
        { group: "skills", skill: { name: "sdk" } },
        true,
      ),
    ).toEqual({ action: "skill-use", meta: { skill: "sdk", shift: true } });
  });
});
