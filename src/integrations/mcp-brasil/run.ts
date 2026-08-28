import { isMcpBrasilEnabled } from "@/integrations/flags";
import {
  checkMcpBrasilAllowlist,
  MCP_BRASIL_DISCLAIMER,
  sanitizeMcpBrasilText,
} from "./allowlist";
import type { McpBrasilQueryInput, McpBrasilQueryOutput } from "./manifest";
import { mcpBrasilQueryInputSchema } from "./manifest";
import { assertNever } from "@/core/assert-never";

export type McpBrasilRunResult =
  | { status: "ok"; output: McpBrasilQueryOutput }
  | { status: "denied"; reason: string };

async function fetchBcbSelic(): Promise<{ value: string; period: string }> {
  // Public BCB OData — read-only reference data.
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='08-08-2026'&$top=1&$format=json";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error("bcb_fetch_failed");
    const json = (await res.json()) as { value?: Array<{ cotacaoVenda?: number }> };
    const row = json.value?.[0];
    return {
      value: row?.cotacaoVenda != null ? String(row.cotacaoVenda) : "indisponível",
      period: new Date().toISOString().slice(0, 10),
    };
  } catch {
    return { value: "indisponível (offline)", period: new Date().toISOString().slice(0, 10) };
  }
}

async function fetchIbgePopulation(
  params: McpBrasilQueryInput["params"],
): Promise<{ summary: string }> {
  const year = params.year ?? new Date().getFullYear() - 1;
  const uf = params.uf?.toUpperCase() ?? "BR";
  const summary = sanitizeMcpBrasilText(
    `Estimativa populacional referencial para ${uf} (${year}). Consulte o IBGE para dados oficiais atualizados.`,
  );
  return { summary };
}

export async function runMcpBrasilQuery(
  raw: unknown,
): Promise<McpBrasilRunResult> {
  if (!isMcpBrasilEnabled()) {
    return { status: "denied", reason: "mcp_brasil_disabled" };
  }

  const input = mcpBrasilQueryInputSchema.parse(raw);
  const allow = checkMcpBrasilAllowlist(input);
  if (!allow.allowed) {
    return { status: "denied", reason: allow.reason ?? "allowlist_denied" };
  }

  const today = new Date().toISOString().slice(0, 10);
  let data: unknown;
  let source: string;

  switch (input.tool) {
    case "bcb.selic":
      data = await fetchBcbSelic();
      source = "Banco Central do Brasil (PTAX)";
      break;
    case "ibge.population":
      data = await fetchIbgePopulation(input.params);
      source = "IBGE — referência pública";
      break;
    default:
      return assertNever(input.tool);
  }

  return {
    status: "ok",
    output: {
      data,
      source,
      date: today,
      disclaimer: MCP_BRASIL_DISCLAIMER,
    },
  };
}
