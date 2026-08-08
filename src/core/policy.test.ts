import { describe, expect, it } from "vitest";
import {
  BudgetTracker,
  canSendToProvider,
  redactSecrets,
  requiresConfirmation,
} from "./policy";

describe("policy", () => {
  it("redige segredos", () => {
    expect(redactSecrets("token=abc123")).toContain("[REDACTADO]");
  });

  it("bloqueia secret para qualquer provedor", () => {
    expect(canSendToProvider("secret", "google")).toBe(false);
  });

  it("exige confirmação para risco", () => {
    expect(requiresConfirmation("rm -rf /tmp")).toBe(true);
    expect(requiresConfirmation("ola")).toBe(false);
  });

  it("orçamento estoura", () => {
    const b = new BudgetTracker(0.001);
    expect(() => b.charge(0.002)).toThrow("budget_exceeded");
  });
});
