import { z } from "zod";

/** Read-only MCP Brasil tool category. */
export const MCP_BRASIL_CATEGORY = "read-only" as const;

export const mcpBrasilQueryInputSchema = z.object({
  tool: z.enum(["bcb.selic", "ibge.population"]),
  params: z
    .object({
      year: z.number().int().min(2000).max(2100).optional(),
      uf: z.string().length(2).optional(),
    })
    .default({}),
});

export const mcpBrasilQueryOutputSchema = z.object({
  data: z.unknown(),
  source: z.string(),
  date: z.string(),
  disclaimer: z.string(),
});

export type McpBrasilQueryInput = z.infer<typeof mcpBrasilQueryInputSchema>;
export type McpBrasilQueryOutput = z.infer<typeof mcpBrasilQueryOutputSchema>;
