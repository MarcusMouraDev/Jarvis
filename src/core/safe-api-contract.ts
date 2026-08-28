import { z } from "zod";
import type { JsonValue } from "./core-store";
import type { AgentMemoryPolicy, AgentMutationMode, AgentWorkspaceMode } from "./agent-catalog";
import type { PrivacyClass } from "./types";

export const safeAgentIds = ["Hermes"] as const;
export const agentIdSchema = z.enum(safeAgentIds);
export const privacyClassSchema = z.enum([
  "public",
  "internal",
  "confidential",
  "secret",
]);

const workspaceNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

export const publicWorkspaceRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("existing"), name: workspaceNameSchema }).strict(),
  z.object({ kind: z.literal("new"), name: workspaceNameSchema }).strict(),
]);

const attachmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().trim().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal("image"), path: z.string().trim().min(1).max(4096) }).strict(),
  z
    .object({
      kind: z.literal("image-bytes"),
      contentBase64: z.string().min(1).max(8_000_000),
      filename: z.string().trim().max(255).optional(),
    })
    .strict(),
]);

export const createRunRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(32_000),
    agentId: agentIdSchema.optional(),
    modelAlias: z.string().trim().min(1).max(64).optional(),
    privacyClass: privacyClassSchema.default("internal"),
    workspace: publicWorkspaceRequestSchema.default({ kind: "none" }),
    allowPaidProvider: z.boolean().default(false),
    maxCostUsd: z.number().finite().nonnegative().optional(),
    timeoutMs: z.number().int().positive().optional(),
    attachments: z.array(attachmentSchema).max(8).optional(),
  })
  .strict();

export const resumeHermesSessionSchema = z
  .object({ sessionId: z.string().trim().min(1).max(200) })
  .strict();

export const updateSessionRequestSchema = z
  .object({ defaultAgentId: agentIdSchema })
  .strict();

export const hermesApprovalChoiceSchema = z.enum([
  "once",
  "session",
  "always",
  "deny",
]);

export const approvalDecisionRequestSchema = z
  .object({
    decision: z.enum(["approved", "denied"]).optional(),
    choice: hermesApprovalChoiceSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.decision || value.choice), {
    message: "decision_or_choice_required",
  })
  .transform((value) => {
    const choice =
      value.choice ?? (value.decision === "denied" ? "deny" : "once");
    return {
      decision:
        value.decision ?? (choice === "deny" ? "denied" : "approved"),
      choice,
    } as const;
  });

export const eventEnvelopeSchema = z
  .object({
    v: z.literal(1),
    eventId: z.string().min(1),
    runId: z.string().min(1),
    seq: z.number().int().positive(),
    ts: z.iso.datetime(),
    type: z.string().min(1),
    payload: z.json(),
  })
  .strict();

export type SafeAgentId = z.infer<typeof agentIdSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type PublicWorkspaceRequest = z.infer<typeof publicWorkspaceRequestSchema>;

export interface SafeEventEnvelope {
  v: 1;
  eventId: string;
  runId: string;
  seq: number;
  ts: string;
  type: string;
  payload: JsonValue;
}

export type SafeWorkspaceView =
  | { kind: "none"; label: string }
  | { kind: "existing" | "new"; name: string; label: string };

export interface SafeWorkspaceChoice {
  kind: "none" | "existing";
  name?: string;
  label: string;
}

export interface SafeAgentSummary {
  id: SafeAgentId;
  modelAlias: string;
  provider: string;
  workspaceMode: AgentWorkspaceMode;
  mutationMode: AgentMutationMode;
  memoryPolicy: AgentMemoryPolicy;
  budgetUsd: number;
  timeoutMs: number;
}

export interface SafeRunSummary {
  runId: string;
  agentId: string;
  privacyClass: PrivacyClass;
  requestedModel: string;
  workspace: SafeWorkspaceView;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SafeMessageView {
  messageId: string;
  role: string;
  content: JsonValue;
  createdAt: string;
}

export interface SafeApprovalView {
  approvalId: string;
  invocationId: string;
  toolId: string;
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
  target: JsonValue;
  effect: JsonValue;
  preview: JsonValue;
  expiresAt: string;
  createdAt: string;
}

export interface SafeRunSnapshot {
  run: SafeRunSummary;
  messages: SafeMessageView[];
  events: SafeEventEnvelope[];
  approvals: SafeApprovalView[];
}
