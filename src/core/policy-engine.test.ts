import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "./policy-engine";

describe("policy-engine", () => {
  it("bloqueia modelo fora do perfil", () => {
    const decision = evaluatePolicy({
      profileId: "briefing",
      privacyClass: "internal",
      modelAlias: "codex",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("model_not_allowed");
  });

  it("permite shell com aprovação no perfil conversa", () => {
    const decision = evaluatePolicy({
      profileId: "conversa",
      privacyClass: "internal",
      toolId: "shell.run",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.needsApproval).toBe(true);
  });

  it("bloqueia ferramentas no perfil briefing", () => {
    const decision = evaluatePolicy({
      profileId: "briefing",
      privacyClass: "internal",
      toolId: "shell.run",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("tool_not_allowed");
  });

  it("bloqueia secret", () => {
    const decision = evaluatePolicy({
      profileId: "conversa",
      privacyClass: "secret",
      provider: "google",
      modelAlias: "gemini",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("privacy_blocked");
  });
});
