import type { JsonValue } from "@/core/core-store";
import {
  asNonEmptyString as asString,
  asRecord,
} from "@/lib/value-guards";

export interface HermesGatewayEvent {
  type?: unknown;
  payload?: unknown;
  params?: unknown;
  session_id?: unknown;
}

export interface MappedSafeEvent {
  type: string;
  payload: JsonValue;
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, jsonValue(child)]),
    );
  }
  return null;
}

function payloadOf(event: HermesGatewayEvent): Record<string, unknown> {
  return asRecord(event.payload) ?? asRecord(event.params) ?? asRecord(event) ?? {};
}

function eventType(event: HermesGatewayEvent): string {
  return asString(event.type) ?? asString(asRecord(event.params)?.type) ?? "";
}

function completeStatus(payload: Record<string, unknown>): string {
  return (asString(payload.status) ?? asString(payload.state) ?? "ok").toLowerCase();
}

export function mapHermesEvent(event: HermesGatewayEvent): MappedSafeEvent | null {
  const type = eventType(event);
  const payload = payloadOf(event);
  const text =
    asString(payload.text) ?? asString(payload.delta) ?? asString(payload.content) ?? "";

  switch (type) {
    case "message.delta":
    case "text.delta":
      return { type: "text.delta", payload: { text } };
    case "reasoning.delta":
    case "thinking.delta":
      return { type: "reasoning.delta", payload: { text } };
    case "status.update":
      return {
        type: "status.update",
        payload: {
          kind: asString(payload.kind) ?? asString(payload.status) ?? "update",
          text: asString(payload.text) ?? asString(payload.message) ?? "",
        },
      };
    case "tool.generating":
      return {
        type: "tool.generating",
        payload: { name: asString(payload.name) ?? asString(payload.tool) ?? "tool" },
      };
    case "tool.progress":
      return {
        type: "tool.generating",
        payload: {
          name: asString(payload.name) ?? asString(payload.tool) ?? "tool",
          text: asString(payload.text) ?? asString(payload.message) ?? "",
        },
      };
    case "sudo.request":
    case "secret.request":
      return {
        type: "clarify.required",
        payload: {
          requestId: asString(payload.request_id) ?? asString(payload.id) ?? type,
          prompt: asString(payload.prompt) ?? asString(payload.text) ?? type,
          kind: type.startsWith("sudo") ? "sudo" : "secret",
        },
      };
    case "sudo.expire":
    case "secret.expire":
      return {
        type: "status.update",
        payload: { kind: "expired", text: type },
      };
    case "tool.start":
      return {
        type: "tool.started",
        payload: {
          toolId:
            asString(payload.tool_id) ??
            asString(payload.id) ??
            asString(payload.name) ??
            "tool",
          name: asString(payload.name) ?? asString(payload.tool) ?? "tool",
          args: jsonValue(payload.args ?? payload.arguments ?? {}),
        },
      };
    case "tool.complete":
      return {
        type: "tool.completed",
        payload: {
          toolId:
            asString(payload.tool_id) ??
            asString(payload.id) ??
            asString(payload.name) ??
            "tool",
          name: asString(payload.name) ?? asString(payload.tool) ?? "tool",
          ok: payload.ok !== false && completeStatus(payload) !== "error",
        },
      };
    case "tool.output_risk":
      return {
        type: "tool.risk",
        payload: {
          risk: asString(payload.risk) ?? asString(payload.level) ?? "unknown",
          findings: jsonValue(payload.findings ?? []),
          redacted: Boolean(payload.redacted),
        },
      };
    case "approval.request":
      return {
        type: "tool.approval_required",
        payload: jsonValue({
          approvalId: asString(payload.request_id) ?? asString(payload.id),
          invocationId: asString(payload.request_id) ?? asString(payload.id),
          toolId: asString(payload.pattern_key) ?? asString(payload.tool) ?? "terminal",
          command: asString(payload.command) ?? "",
          description: asString(payload.description) ?? "",
          choices: payload.choices ?? ["once", "session", "always", "deny"],
          allowPermanent: payload.allow_permanent !== false,
          allowSession: payload.allow_session !== false,
          expiresAt:
            asString(payload.expires_at) ??
            asString(payload.expiresAt) ??
            new Date(Date.now() + 300_000).toISOString(),
        }),
      };
    case "clarify.request":
      return {
        type: "clarify.required",
        payload: {
          requestId: asString(payload.request_id) ?? asString(payload.id) ?? "clarify",
          prompt: asString(payload.prompt) ?? asString(payload.text) ?? "",
        },
      };
    case "session.usage":
      return { type: "usage", payload: jsonValue(payload) };
    case "session.info":
      return {
        type: "model.selected",
        payload: {
          provider: asString(payload.provider) ?? "hermes",
          model: asString(payload.model) ?? asString(payload.default) ?? "auto",
        },
      };
    case "message.complete": {
      const status = completeStatus(payload);
      if (status === "error" || status === "failed") {
        return {
          type: "run.failed",
          payload: { reason: asString(payload.error) ?? asString(payload.reason) ?? "failed" },
        };
      }
      if (status === "cancelled" || status === "aborted" || status === "interrupt") {
        return { type: "abort", payload: { reason: status } };
      }
      return { type: "run.completed", payload: { text: asString(payload.text) ?? "" } };
    }
    case "subagent.start":
      return {
        type: "subagent.started",
        payload: {
          name: asString(payload.name) ?? "subagent",
          id: asString(payload.id) ?? asString(payload.subagent_id) ?? "subagent",
        },
      };
    case "subagent.tool":
      return { type: "subagent.tool", payload: jsonValue(payload) };
    case "subagent.complete":
      return { type: "subagent.completed", payload: jsonValue(payload) };
    case "error":
      return {
        type: "run.failed",
        payload: {
          reason:
            asString(payload.error) ??
            asString(payload.message) ??
            asString(payload.reason) ??
            "error",
        },
      };
    case "wake.detected":
      return { type: "voice.wake", payload: jsonValue(payload) };
    case "voice.transcript":
      return {
        type: "voice.transcript",
        payload: { text: asString(payload.text) ?? asString(payload.transcript) ?? "" },
      };
    default:
      return null;
  }
}
