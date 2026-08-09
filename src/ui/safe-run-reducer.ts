import type { SafeApprovalView, SafeEventEnvelope } from "@/core/safe-api-contract";
import type { AgentState } from "@/core/types";
import type { JsonValue } from "@/core/core-store";

export interface SafeRunUiState {
  lastEventId: string | null;
  lastSeq: number;
  seenEventIds: ReadonlySet<string>;
  presence: AgentState;
  assistantText: string;
  effectiveModel: { provider: string; model: string } | null;
  pendingApproval: SafeApprovalView | null;
  fallback: { from: string; to: string; reason: string } | null;
  protocolError: string | null;
  runStatus: string | null;
}

function asRecord(value: JsonValue): Record<string, JsonValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, JsonValue>;
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function approvalFromPayload(
  payload: JsonValue,
  createdAt: string,
): SafeApprovalView | null {
  const record = asRecord(payload);
  if (!record) return null;
  const approvalId = asString(record.approvalId);
  const invocationId = asString(record.invocationId);
  const toolId = asString(record.toolId);
  const expiresAt = asString(record.expiresAt);
  if (!approvalId || !invocationId || !toolId || !expiresAt) return null;
  return {
    approvalId,
    invocationId,
    toolId,
    status: "pending",
    target: record.target ?? { toolId },
    effect: record.effect ?? record.preview ?? {},
    preview: record.preview ?? {},
    expiresAt,
    createdAt,
  };
}

export function initialSafeRunState(): SafeRunUiState {
  return {
    lastEventId: null,
    lastSeq: 0,
    seenEventIds: new Set(),
    presence: "idle",
    assistantText: "",
    effectiveModel: null,
    pendingApproval: null,
    fallback: null,
    protocolError: null,
    runStatus: null,
  };
}

export function applySafeEvent(
  state: SafeRunUiState,
  event: SafeEventEnvelope,
): SafeRunUiState {
  if (state.seenEventIds.has(event.eventId)) return state;
  if (state.lastSeq > 0 && event.seq !== state.lastSeq + 1) {
    return {
      ...state,
      presence: "failure",
      protocolError: "sequence_gap",
      seenEventIds: new Set(state.seenEventIds),
    };
  }

  const seenEventIds = new Set(state.seenEventIds);
  seenEventIds.add(event.eventId);
  const next: SafeRunUiState = {
    ...state,
    lastEventId: event.eventId,
    lastSeq: event.seq,
    seenEventIds,
    protocolError: state.protocolError,
  };

  const payload = event.payload;
  const record = asRecord(payload);

  switch (event.type) {
    case "run.created":
      return { ...next, presence: "thinking", runStatus: "running" };
    case "model.selected": {
      const provider = asString(record?.provider) ?? "unknown";
      const model = asString(record?.model) ?? "unknown";
      return {
        ...next,
        presence: "thinking",
        effectiveModel: { provider, model },
      };
    }
    case "text.delta": {
      const text = asString(record?.text) ?? "";
      return {
        ...next,
        presence: "speaking",
        assistantText: `${next.assistantText}${text}`,
      };
    }
    case "model.retry": {
      const from = asString(record?.from) ?? "unknown";
      const to = asString(record?.to) ?? "unknown";
      const reason =
        asString(record?.classification) ?? asString(record?.reason) ?? "retry";
      return {
        ...next,
        presence: "thinking",
        fallback: { from, to, reason },
      };
    }
    case "tool.approval_required":
      return {
        ...next,
        presence: "asking",
        runStatus: "waiting_approval",
        pendingApproval: approvalFromPayload(payload, event.ts),
      };
    case "tool.completed":
      return {
        ...next,
        presence: "thinking",
        pendingApproval: null,
        runStatus: "running",
      };
    case "run.completed":
      return {
        ...next,
        presence: "idle",
        pendingApproval: null,
        runStatus: "completed",
      };
    case "run.failed":
      return {
        ...next,
        presence: "failure",
        pendingApproval: null,
        runStatus: "failed",
      };
    case "abort":
      return {
        ...next,
        presence: "idle",
        pendingApproval: null,
        runStatus: "cancelled",
      };
    case "protocol.error":
      return {
        ...next,
        presence: "failure",
        protocolError: asString(record?.code) ?? "protocol_error",
      };
    default:
      return next;
  }
}

export function reduceSafeRun(events: readonly SafeEventEnvelope[]): SafeRunUiState {
  return events.reduce(applySafeEvent, initialSafeRunState());
}
