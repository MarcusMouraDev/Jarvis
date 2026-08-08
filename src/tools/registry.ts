import { z } from "zod";
import {
  mcpBrasilQueryInputSchema,
  mcpBrasilQueryOutputSchema,
} from "@/integrations/mcp-brasil/manifest";
import {
  browserRunInputSchema,
  browserRunOutputSchema,
} from "@/integrations/browser/types";
import {
  codeContextInputSchema,
  codeContextOutputSchema,
} from "./code-context";

export type ToolRisk = "read" | "write" | "network" | "destructive";

export interface ToolPolicy {
  /** auto = may run without confirmation when tier matches; confirm = always ask */
  defaultTier: "auto" | "confirm";
  requiresCwdLock: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ToolManifest {
  id: string;
  version: string;
  risk: ToolRisk;
  description: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  policy: ToolPolicy;
}

const shellInput = z.object({
  command: z.string().min(1).max(4000),
  approvalId: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

const shellOutput = z.object({
  exitCode: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  cwd: z.string(),
});

export const TOOL_REGISTRY: Record<string, ToolManifest> = {
  "code.context": {
    id: "code.context",
    version: "1.0.0",
    risk: "read",
    description:
      "Resume caminhos do repositório (símbolos, imports, trecho) com política de leitura.",
    inputSchema: codeContextInputSchema,
    outputSchema: codeContextOutputSchema,
    policy: {
      defaultTier: "auto",
      requiresCwdLock: false,
      timeoutMs: 10_000,
      maxOutputBytes: 100_000,
    },
  },
  "shell.run": {
    id: "shell.run",
    version: "1.0.0",
    risk: "write",
    description:
      "Executa comando no terminal com cwd travado, timeout e política de aprovação.",
    inputSchema: shellInput,
    outputSchema: shellOutput,
    policy: {
      defaultTier: "confirm",
      requiresCwdLock: true,
      timeoutMs: 30_000,
      maxOutputBytes: 200_000,
    },
  },
  "mcp_brasil.query": {
    id: "mcp_brasil.query",
    version: "1.0.0",
    risk: "read",
    description:
      "Consulta fontes públicas brasileiras (read-only) via MCP Brasil.",
    inputSchema: mcpBrasilQueryInputSchema,
    outputSchema: mcpBrasilQueryOutputSchema,
    policy: {
      defaultTier: "auto",
      requiresCwdLock: false,
      timeoutMs: 15_000,
      maxOutputBytes: 50_000,
    },
  },
  "browser.run": {
    id: "browser.run",
    version: "1.0.0",
    risk: "network",
    description:
      "Automação web isolada com allowlist de domínios, plano e aprovação para mutações.",
    inputSchema: browserRunInputSchema,
    outputSchema: browserRunOutputSchema,
    policy: {
      defaultTier: "confirm",
      requiresCwdLock: false,
      timeoutMs: 60_000,
      maxOutputBytes: 500_000,
    },
  },
};

export function getTool(id: string): ToolManifest | null {
  return TOOL_REGISTRY[id] ?? null;
}

export function listTools(): ToolManifest[] {
  return Object.values(TOOL_REGISTRY);
}
