import { z } from "zod";

export const OMNIROUTE_MCP_TOOL_IDS = [
  "omniroute.list_models",
  "omniroute.check_quota",
  "omniroute.compression_status",
  "omniroute.usage_report",
] as const;

export type OmnirouteMcpToolId = (typeof OMNIROUTE_MCP_TOOL_IDS)[number];

export const omnirouteEmptyInputSchema = z.object({}).strict();

export const omnirouteListModelsOutputSchema = z
  .object({
    models: z.array(
      z
        .object({
          id: z.string(),
          ownedBy: z.string().optional(),
        })
        .strict(),
    ),
    source: z.string(),
  })
  .strict();

export const omnirouteCheckQuotaOutputSchema = z
  .object({
    quota: z.unknown(),
    source: z.string(),
  })
  .strict();

export const omnirouteCompressionStatusOutputSchema = z
  .object({
    status: z.unknown(),
    source: z.string(),
  })
  .strict();

export type OmnirouteListModelsOutput = z.infer<typeof omnirouteListModelsOutputSchema>;
export type OmnirouteCheckQuotaOutput = z.infer<typeof omnirouteCheckQuotaOutputSchema>;
export const omnirouteUsageReportOutputSchema = z
  .object({
    report: z.unknown(),
    source: z.string(),
  })
  .strict();

export type OmnirouteCompressionStatusOutput = z.infer<
  typeof omnirouteCompressionStatusOutputSchema
>;
export type OmnirouteUsageReportOutput = z.infer<
  typeof omnirouteUsageReportOutputSchema
>;
