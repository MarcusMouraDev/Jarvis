import { describe, expect, it } from "vitest";
import { explainSafeFailure } from "./safe-failure-message";

describe("explainSafeFailure", () => {
  it("explica OmniRoute offline", () => {
    expect(explainSafeFailure("unavailable")).toMatch(/OmniRoute/i);
  });

  it("mantém motivo desconhecido legível", () => {
    expect(explainSafeFailure("weird_code")).toBe("Falha: weird_code");
  });
});
