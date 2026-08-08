import type { McpBrasilQueryInput } from "./manifest";

const DISALLOWED_ADVICE =
  /\b(invista|compre|venda|recomendo|aconselho|garantia de retorno|consultoria jurídica|parecer legal)\b/i;

/** Allowed MCP Brasil tools and their permitted param keys. */
const TOOL_PARAM_ALLOWLIST: Record<
  McpBrasilQueryInput["tool"],
  ReadonlySet<string>
> = {
  "bcb.selic": new Set([]),
  "ibge.population": new Set(["year", "uf"]),
};

export interface AllowlistResult {
  allowed: boolean;
  reason?: string;
}

export function checkMcpBrasilAllowlist(
  input: McpBrasilQueryInput,
): AllowlistResult {
  const allowedParams = TOOL_PARAM_ALLOWLIST[input.tool];
  if (!allowedParams) {
    return { allowed: false, reason: "tool_not_allowlisted" };
  }

  for (const key of Object.keys(input.params)) {
    if (!allowedParams.has(key)) {
      return { allowed: false, reason: `param_not_allowlisted:${key}` };
    }
  }

  return { allowed: true };
}

export function sanitizeMcpBrasilText(text: string): string {
  if (DISALLOWED_ADVICE.test(text)) {
    return "Dados referenciais apenas. Não constitui aconselhamento jurídico ou financeiro.";
  }
  return text;
}

export const MCP_BRASIL_DISCLAIMER =
  "Informação referencial obtida de fontes públicas brasileiras. Não constitui aconselhamento jurídico ou financeiro.";
