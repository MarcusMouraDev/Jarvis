import { z } from "zod";
import type { PathContextSummary } from "@/composer/mention-types";
import { summarizePath } from "@/context/path-summary";

export const CODE_CONTEXT_MAX_PATHS = 6;
export const CODE_CONTEXT_MAX_EXCERPT = 2000;

export const codeContextInputSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(CODE_CONTEXT_MAX_PATHS),
});

export const codeContextSummarySchema = z.object({
  relPath: z.string(),
  hash: z.string(),
  byteSize: z.number(),
  lineCount: z.number(),
  language: z.string(),
  exports: z.array(z.string()),
  imports: z.array(z.string()),
  symbols: z.array(z.string()),
  excerpt: z.string().max(CODE_CONTEXT_MAX_EXCERPT),
});

export const codeContextOutputSchema = z.object({
  summaries: z.array(
    z.object({
      path: z.string(),
      error: z.string().optional(),
      summary: codeContextSummarySchema.optional(),
    }),
  ),
});

export type CodeContextInput = z.infer<typeof codeContextInputSchema>;
export type CodeContextOutput = z.infer<typeof codeContextOutputSchema>;

function stripAbsPath(summary: PathContextSummary) {
  const { absPath: _abs, excerpt, ...rest } = summary;
  void _abs;
  return {
    ...rest,
    excerpt: excerpt.slice(0, CODE_CONTEXT_MAX_EXCERPT),
  };
}

export function runCodeContext(input: CodeContextInput): CodeContextOutput {
  const parsed = codeContextInputSchema.parse(input);
  const summaries = parsed.paths.slice(0, CODE_CONTEXT_MAX_PATHS).map((p) => {
    const result = summarizePath(p);
    if ("error" in result) {
      return { path: p, error: result.error };
    }
    return { path: p, summary: stripAbsPath(result) };
  });
  return { summaries };
}
