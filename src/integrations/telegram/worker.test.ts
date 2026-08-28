import { describe, expect, it } from "vitest";
import { approvalRunId, responseText } from "./worker";

describe("Telegram worker response mapping", () => {
  it("extracts text without exposing transport wrappers", () => {
    expect(responseText({ output: [{ type: "output_text", text: "Pronto." }] })).toBe("Pronto.");
  });

  it("finds a bounded approval run for inline callbacks", () => {
    expect(
      approvalRunId({ output: [{ type: "approval_required", run_id: "run_123" }] }),
    ).toBe("run_123");
    expect(approvalRunId({ type: "approval_required", run_id: "x".repeat(49) })).toBeNull();
    expect(approvalRunId({ type: "message", run_id: "run_123" })).toBeNull();
  });
});
