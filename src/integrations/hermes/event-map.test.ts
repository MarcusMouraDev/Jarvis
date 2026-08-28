import { describe, expect, it } from "vitest";
import { mapHermesEvent } from "./event-map";

describe("mapHermesEvent", () => {
  it("maps streaming text, reasoning and tool lifecycle", () => {
    expect(mapHermesEvent({ type: "message.delta", payload: { text: "oi" } })).toEqual({
      type: "text.delta",
      payload: { text: "oi" },
    });
    expect(mapHermesEvent({ type: "thinking.delta", payload: { text: "hmm" } })).toEqual({
      type: "reasoning.delta",
      payload: { text: "hmm" },
    });
    expect(
      mapHermesEvent({
        type: "tool.start",
        payload: { tool_id: "t1", name: "terminal", args: { cmd: "ls" } },
      }),
    ).toMatchObject({
      type: "tool.started",
      payload: { toolId: "t1", name: "terminal" },
    });
    expect(
      mapHermesEvent({ type: "tool.complete", payload: { name: "terminal", ok: true } }),
    ).toMatchObject({ type: "tool.completed" });
  });

  it("maps approval, clarify, usage and completion statuses", () => {
    expect(
      mapHermesEvent({
        type: "approval.request",
        payload: {
          request_id: "apr-1",
          command: "rm -rf /tmp/x",
          pattern_key: "recursive_delete",
          description: "recursive delete",
        },
      }),
    ).toMatchObject({
      type: "tool.approval_required",
      payload: {
        approvalId: "apr-1",
        toolId: "recursive_delete",
        command: "rm -rf /tmp/x",
      },
    });
    expect(
      mapHermesEvent({ type: "message.complete", payload: { status: "ok", text: "feito" } }),
    ).toEqual({ type: "run.completed", payload: { text: "feito" } });
    expect(
      mapHermesEvent({ type: "message.complete", payload: { status: "failed", error: "boom" } }),
    ).toEqual({ type: "run.failed", payload: { reason: "boom" } });
    expect(
      mapHermesEvent({ type: "message.complete", payload: { status: "cancelled" } }),
    ).toEqual({ type: "abort", payload: { reason: "cancelled" } });
    expect(mapHermesEvent({ type: "gateway.ready" })).toBeNull();
    expect(mapHermesEvent({ type: "error", payload: { message: "auth_failed" } })).toEqual({
      type: "run.failed",
      payload: { reason: "auth_failed" },
    });
    expect(
      mapHermesEvent({ type: "tool.progress", payload: { name: "shell", text: "..." } }),
    ).toMatchObject({ type: "tool.generating" });
    expect(
      mapHermesEvent({ type: "sudo.request", payload: { request_id: "s1", prompt: "sudo" } }),
    ).toMatchObject({ type: "clarify.required", payload: { kind: "sudo" } });
    expect(mapHermesEvent({ type: "secret.expire" })).toMatchObject({
      type: "status.update",
      payload: { kind: "expired" },
    });
  });
});
