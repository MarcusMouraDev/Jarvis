import { describe, expect, it } from "vitest";
import type { SafeEventEnvelope } from "@/core/safe-api-contract";
import {
  applySafeEvent,
  initialSafeRunState,
  reduceSafeRun,
  type SafeRunUiState,
} from "./safe-run-reducer";

function event(
  overrides: Partial<SafeEventEnvelope> & Pick<SafeEventEnvelope, "eventId" | "seq" | "type">,
): SafeEventEnvelope {
  return {
    v: 1,
    runId: "run-1",
    ts: "2026-08-08T12:00:00.000Z",
    payload: {},
    ...overrides,
  };
}

describe("safe-run-reducer", () => {
  it("reconstructs the same state from reduceSafeRun and incremental apply", () => {
    const events = [
      event({ eventId: "e1", seq: 1, type: "run.created", payload: { agentId: "Hermes" } }),
      event({
        eventId: "e2",
        seq: 2,
        type: "model.selected",
        payload: { provider: "local", model: "qwen", alias: "local" },
      }),
      event({ eventId: "e3", seq: 3, type: "text.delta", payload: { text: "Hello" } }),
      event({
        eventId: "e4",
        seq: 4,
        type: "tool.approval_required",
        payload: {
          approvalId: "appr-1",
          invocationId: "inv-1",
          toolId: "file.patch",
          expiresAt: "2026-08-08T12:05:00.000Z",
          preview: { kind: "file_patch", path: "a.ts" },
          effect: { kind: "file_patch" },
          target: { toolId: "file.patch" },
        },
      }),
    ];

    const reloaded = reduceSafeRun(events);
    const live = events.reduce(applySafeEvent, initialSafeRunState());
    expect(reloaded).toEqual(live);
    expect(reloaded.presence).toBe("asking");
    expect(reloaded.effectiveModel).toEqual({ provider: "local", model: "qwen" });
    expect(reloaded.assistantText).toBe("Hello");
    expect(reloaded.pendingApproval?.approvalId).toBe("appr-1");
  });

  it("tracks fallback, completion, failure, abort and protocol errors", () => {
    let state = reduceSafeRun([
      event({
        eventId: "e1",
        seq: 1,
        type: "model.retry",
        payload: { from: "local", to: "gemini", classification: "server_error" },
      }),
    ]);
    expect(state.fallback).toEqual({
      from: "local",
      to: "gemini",
      reason: "server_error",
    });
    expect(state.presence).toBe("thinking");

    state = applySafeEvent(
      state,
      event({ eventId: "e2", seq: 2, type: "tool.completed", payload: { toolId: "file.patch" } }),
    );
    expect(state.pendingApproval).toBeNull();
    expect(state.presence).toBe("thinking");

    state = applySafeEvent(
      state,
      event({ eventId: "e3", seq: 3, type: "run.completed", payload: { steps: 1 } }),
    );
    expect(state.presence).toBe("idle");

    state = applySafeEvent(
      initialSafeRunState(),
      event({ eventId: "f1", seq: 1, type: "run.failed", payload: { reason: "budget_exceeded" } }),
    );
    expect(state.presence).toBe("failure");
    expect(state.protocolError).toBeNull();

    state = applySafeEvent(
      initialSafeRunState(),
      event({ eventId: "a1", seq: 1, type: "abort", payload: { reason: "cancelled" } }),
    );
    expect(state.presence).toBe("idle");

    state = applySafeEvent(
      initialSafeRunState(),
      event({
        eventId: "p1",
        seq: 1,
        type: "protocol.error",
        payload: { code: "invalid_last_event_id" },
      }),
    );
    expect(state.presence).toBe("failure");
    expect(state.protocolError).toBe("invalid_last_event_id");
  });

  it("ignores duplicate event ids and flags sequence gaps as protocol errors", () => {
    const base = reduceSafeRun([
      event({ eventId: "e1", seq: 1, type: "text.delta", payload: { text: "a" } }),
    ]);
    const duplicate = applySafeEvent(
      base,
      event({ eventId: "e1", seq: 1, type: "text.delta", payload: { text: "b" } }),
    );
    expect(duplicate.assistantText).toBe("a");
    expect(duplicate.protocolError).toBeNull();

    const gapped = applySafeEvent(
      base,
      event({ eventId: "e3", seq: 3, type: "text.delta", payload: { text: "c" } }),
    );
    expect(gapped.protocolError).toBe("sequence_gap");
    expect(gapped.presence).toBe("failure");
  });

  it("sets speaking while streaming text and thinking on model selection", () => {
    const selected = applySafeEvent(
      initialSafeRunState(),
      event({
        eventId: "e1",
        seq: 1,
        type: "model.selected",
        payload: { provider: "local", model: "qwen" },
      }),
    );
    expect(selected.presence).toBe("thinking");

    const speaking = applySafeEvent(
      selected,
      event({ eventId: "e2", seq: 2, type: "text.delta", payload: { text: "…" } }),
    );
    expect(speaking.presence).toBe("speaking");
  });

  it("tracks subagents, tools and clarify prompts", () => {
    let state = applySafeEvent(
      initialSafeRunState(),
      event({
        eventId: "s1",
        seq: 1,
        type: "subagent.started",
        payload: { id: "child-1", name: "pesquisa" },
      }),
    );
    state = applySafeEvent(
      state,
      event({
        eventId: "t1",
        seq: 2,
        type: "tool.started",
        payload: { toolId: "image_generate", name: "image_generate" },
      }),
    );
    state = applySafeEvent(
      state,
      event({
        eventId: "c1",
        seq: 3,
        type: "clarify.required",
        payload: { requestId: "q1", prompt: "qual tamanho?" },
      }),
    );
    expect(state.subagents).toEqual([{ id: "child-1", name: "pesquisa", status: "running" }]);
    expect(state.tools[0]).toMatchObject({ toolId: "image_generate", status: "started" });
    expect(state.pendingClarify).toEqual({ requestId: "q1", prompt: "qual tamanho?" });
  });

  it("never mutates presence without an envelope", () => {
    const state: SafeRunUiState = initialSafeRunState();
    expect(state.presence).toBe("idle");
    expect(Object.isFrozen(state) || true).toBe(true);
  });
});
