import { describe, expect, it } from "vitest";
import {
  approvalDecisionRequestSchema,
  createRunRequestSchema,
  eventEnvelopeSchema,
  updateSessionRequestSchema,
} from "./safe-api-contract";

describe("safe API contracts", () => {
  it("accepts a minimal Hermes run and applies safe defaults", () => {
    expect(
      createRunRequestSchema.parse({
        prompt: "analise o projeto",
        agentId: "Hermes",
        workspace: { kind: "none" },
      }),
    ).toEqual({
      prompt: "analise o projeto",
      agentId: "Hermes",
      privacyClass: "internal",
      workspace: { kind: "none" },
      allowPaidProvider: false,
    });
  });

  it("accepts an optional modelAlias override", () => {
    expect(
      createRunRequestSchema.parse({
        prompt: "oi",
        modelAlias: "gemini",
        allowPaidProvider: true,
        workspace: { kind: "none" },
      }),
    ).toMatchObject({
      prompt: "oi",
      modelAlias: "gemini",
      allowPaidProvider: true,
    });
  });

  it("rejects unknown fields, traversal, invalid budgets and empty prompts", () => {
    expect(() =>
      createRunRequestSchema.parse({
        prompt: "",
        workspace: { kind: "existing", name: "../outside" },
      }),
    ).toThrow();
    expect(() =>
      createRunRequestSchema.parse({
        prompt: "hello",
        workspace: { kind: "none" },
        maxCostUsd: -1,
      }),
    ).toThrow();
    expect(() =>
      createRunRequestSchema.parse({
        prompt: "hello",
        workspace: { kind: "none" },
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      createRunRequestSchema.parse({
        prompt: "hello",
        workspace: { kind: "none" },
        approvedCloudEgressDigest: "a".repeat(64),
      }),
    ).toThrow();
  });

  it("validates session updates and approval decisions strictly", () => {
    expect(updateSessionRequestSchema.parse({ defaultAgentId: "Planner" })).toEqual({
      defaultAgentId: "Planner",
    });
    expect(approvalDecisionRequestSchema.parse({ decision: "approved" })).toEqual({
      decision: "approved",
    });
    expect(() => updateSessionRequestSchema.parse({ defaultAgentId: "Unknown" })).toThrow();
    expect(() => approvalDecisionRequestSchema.parse({ decision: "allow" })).toThrow();
  });

  it("requires a complete version-one event envelope", () => {
    const envelope = {
      v: 1,
      eventId: "event-1",
      runId: "run-1",
      seq: 1,
      ts: "2026-08-08T10:00:00.000Z",
      type: "run.created",
      payload: { agentId: "Hermes" },
    };
    expect(eventEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(() => eventEnvelopeSchema.parse({ ...envelope, v: 2 })).toThrow();
    expect(() => eventEnvelopeSchema.parse({ ...envelope, seq: 0 })).toThrow();
  });
});
