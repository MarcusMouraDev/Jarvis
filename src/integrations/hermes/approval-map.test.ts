import { describe, expect, it } from "vitest";
import {
  choiceFromDecision,
  decisionFromChoice,
  mapHermesApproval,
} from "./approval-map";

describe("hermes approval map", () => {
  it("builds a SafeApprovalView from a gateway request", () => {
    const view = mapHermesApproval({
      createdAt: "2026-08-23T20:00:00.000Z",
      timeoutMs: 60_000,
      payload: {
        request_id: "apr-9",
        command: "rm -rf tmp",
        pattern_key: "recursive_delete",
        description: "apaga árvore",
        allow_permanent: true,
        allow_session: true,
      },
    });
    expect(view).toMatchObject({
      approvalId: "apr-9",
      invocationId: "apr-9",
      toolId: "recursive_delete",
      status: "pending",
    });
    expect(view?.preview).toMatchObject({
      command: "rm -rf tmp",
      gate: "recursive delete",
    });
    expect(view?.expiresAt).toBe("2026-08-23T20:01:00.000Z");
  });

  it("maps UI choice onto store decision", () => {
    expect(choiceFromDecision("approved", "always")).toBe("always");
    expect(choiceFromDecision("denied")).toBe("deny");
    expect(decisionFromChoice("session")).toBe("approved");
    expect(decisionFromChoice("deny")).toBe("denied");
  });
});
