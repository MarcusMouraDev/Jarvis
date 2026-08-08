import { describe, expect, it } from "vitest";
import {
  BudgetTracker,
  canSendToProvider,
  redactSecrets,
  requiresConfirmation,
} from "./policy";

describe("policy", () => {
  it("redige segredos", () => {
    for (const input of [
      "api_key=abc123",
      "token: abc123",
      "password='abc123'",
      'secret="abc123"',
      "authorization=abc123",
      "Authorization: Bearer abc123",
      "Bearer abc123",
    ]) {
      const redacted = redactSecrets(input);
      expect(redacted).toContain("[REDACTADO]");
      expect(redacted).not.toContain("abc123");
    }

    const serialized = redactSecrets(
      JSON.stringify({ token: "abc123", auth: "Bearer abc123" }),
    );
    expect(serialized).not.toContain("abc123");
    expect(() => JSON.parse(serialized)).not.toThrow();
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
