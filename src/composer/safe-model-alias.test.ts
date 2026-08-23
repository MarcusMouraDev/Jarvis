import { describe, expect, it } from "vitest";
import {
  extractLeadingModelMention,
  isPaidSafeModel,
  resolveSafeModelAlias,
} from "./safe-model-alias";

describe("safe-model-alias", () => {
  it("mapeia aliases legados para o catálogo Safe", () => {
    expect(resolveSafeModelAlias("codex")).toBe("codex-openai");
    expect(resolveSafeModelAlias("local-openai")).toBe("local");
    expect(resolveSafeModelAlias("omniroute")).toBe("local");
    expect(resolveSafeModelAlias("omni")).toBe("local");
    expect(resolveSafeModelAlias("cursor")).toBe("cursor-text");
    expect(resolveSafeModelAlias("gemini")).toBe("gemini");
  });

  it("rejeita alias desconhecido", () => {
    expect(resolveSafeModelAlias("deepseek-flash")).toBeNull();
  });

  it("extrai @modelo do início do prompt", () => {
    expect(extractLeadingModelMention("@gemini olá mundo")).toEqual({
      alias: "gemini",
      rest: "olá mundo",
    });
    expect(extractLeadingModelMention("sem menção")).toBeNull();
  });

  it("marca provedores pagos", () => {
    expect(isPaidSafeModel("gemini")).toBe(true);
    expect(isPaidSafeModel("cursor-text")).toBe(false);
  });
});
