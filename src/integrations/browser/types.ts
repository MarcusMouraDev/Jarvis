import { z } from "zod";

export const browserStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), url: z.string().url() }),
  z.object({
    action: z.literal("click"),
    selector: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal("fill"),
    selector: z.string().min(1).max(500),
    value: z.string().max(2000),
  }),
  z.object({ action: z.literal("screenshot") }),
  z.object({
    action: z.literal("extract"),
    selector: z.string().min(1).max(500).optional(),
  }),
]);

export const browserRunInputSchema = z.object({
  url: z.string().url(),
  steps: z.array(browserStepSchema).min(1).max(20),
  planAcknowledged: z.boolean().optional(),
  approvalId: z.string().optional(),
  screenshotBeforeApproval: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional(),
});

export const browserRunOutputSchema = z.object({
  plan: z.array(z.string()),
  results: z.array(
    z.object({
      step: z.number(),
      action: z.string(),
      ok: z.boolean(),
      detail: z.string().optional(),
      screenshotBase64: z.string().optional(),
    }),
  ),
  mock: z.boolean().optional(),
});

export type BrowserStep = z.infer<typeof browserStepSchema>;
export type BrowserRunInput = z.infer<typeof browserRunInputSchema>;
export type BrowserRunOutput = z.infer<typeof browserRunOutputSchema>;

export const MUTATING_ACTIONS = new Set(["click", "fill"]);

export const SENSITIVE_PATTERNS =
  /\b(login|signin|submit|purchase|buy|checkout|payment|cadastro|comprar|pagar)\b/i;
