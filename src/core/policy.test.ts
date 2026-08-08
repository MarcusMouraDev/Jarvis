import { describe, expect, it } from "vitest";
import {
  BudgetTracker,
  canSendToProvider,
  redactSecrets,
  redactStructured,
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

  it("redige valores estruturados e assignments quoted com escapes", () => {
    const secret = 'alpha"beta\\gamma';
    const assignment = `token=${JSON.stringify(secret)}`;

    const plainRedacted = redactSecrets(assignment);
    expect(plainRedacted).toContain("[REDACTADO]");
    expect(plainRedacted).not.toContain("alpha");
    expect(plainRedacted).not.toContain("beta");
    expect(plainRedacted).not.toContain("gamma");

    const structured = redactStructured({
      nested: { token: secret },
      note: assignment,
    });
    const serialized = JSON.stringify(structured);
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(serialized).not.toContain("alpha");
    expect(serialized).not.toContain("beta");
    expect(serialized).not.toContain("gamma");
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
