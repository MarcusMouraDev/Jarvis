import type { JsonValue } from "@/core/core-store";
import type { SafeApprovalView } from "@/core/safe-api-contract";
import {
  asNonEmptyString as asString,
  asRecord,
} from "@/lib/value-guards";

export const hermesApprovalChoices = ["once", "session", "always", "deny"] as const;
export type HermesApprovalChoice = (typeof hermesApprovalChoices)[number];

export function isHermesApprovalChoice(value: unknown): value is HermesApprovalChoice {
  return (
    value === "once" ||
    value === "session" ||
    value === "always" ||
    value === "deny"
  );
}

export function choiceFromDecision(
  decision: "approved" | "denied",
  choice?: unknown,
): HermesApprovalChoice {
  if (isHermesApprovalChoice(choice)) return choice;
  return decision === "denied" ? "deny" : "once";
}

export function decisionFromChoice(
  choice: HermesApprovalChoice,
): "approved" | "denied" {
  return choice === "deny" ? "denied" : "approved";
}

function readableGate(patternKey: string): string {
  return patternKey.replace(/[_-]+/g, " ").trim() || patternKey;
}

export function mapHermesApproval(input: {
  payload: unknown;
  createdAt: string;
  timeoutMs?: number;
}): SafeApprovalView | null {
  const record = asRecord(input.payload);
  if (!record) return null;
  const approvalId =
    asString(record.request_id) ??
    asString(record.approvalId) ??
    asString(record.id);
  if (!approvalId) return null;
  const toolId =
    asString(record.pattern_key) ??
    asString(record.toolId) ??
    asString(record.tool) ??
    "terminal";
  const timeoutMs = input.timeoutMs ?? 300_000;
  const expiresAt =
    asString(record.expires_at) ??
    asString(record.expiresAt) ??
    new Date(Date.parse(input.createdAt) + timeoutMs).toISOString();
  const command = asString(record.command) ?? "";
  const description = asString(record.description) ?? readableGate(toolId);
  const preview: JsonValue = {
    command,
    description,
    choices: Array.isArray(record.choices)
      ? (record.choices as JsonValue)
      : [...hermesApprovalChoices],
    allowPermanent: record.allow_permanent !== false,
    allowSession: record.allow_session !== false,
    gate: readableGate(toolId),
    risk: asString(record.risk) ?? null,
  };
  return {
    approvalId,
    invocationId: approvalId,
    toolId,
    status: "pending",
    target: { toolId, command },
    effect: { command, description },
    preview,
    expiresAt,
    createdAt: input.createdAt,
  };
}
