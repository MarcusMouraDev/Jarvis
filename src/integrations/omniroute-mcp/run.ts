import { isOmnirouteMcpEnabled } from "@/integrations/flags";
import { isOmnirouteMcpToolAllowed, sanitizeOmnirouteJson } from "./allowlist";
import {
  OmnirouteMcpClient,
  OmnirouteMcpClientError,
  resolveOmnirouteBaseUrl,
} from "./client";
import {
  omnirouteEmptyInputSchema,
  type OmnirouteCheckQuotaOutput,
  type OmnirouteCompressionStatusOutput,
  type OmnirouteListModelsOutput,
  type OmnirouteMcpToolId,
} from "./manifest";

export type OmnirouteMcpRunResult =
  | {
      status: "ok";
      output:
        | OmnirouteListModelsOutput
        | OmnirouteCheckQuotaOutput
        | OmnirouteCompressionStatusOutput;
    }
  | { status: "denied"; reason: string }
  | { status: "failed"; reason: string };

export interface RunOmnirouteMcpOptions {
  client?: OmnirouteMcpClient;
  readEnv?: (name: string) => string | undefined;
}

function readEnvDefault(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function mapModels(payload: unknown): OmnirouteListModelsOutput["models"] {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = Array.isArray(root.data) ? root.data : [];
  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string") return [];
    return [
      {
        id: row.id,
        ...(typeof row.owned_by === "string" ? { ownedBy: row.owned_by } : {}),
      },
    ];
  });
}

export async function runOmnirouteMcpTool(
  toolId: string,
  rawInput: unknown,
  options: RunOmnirouteMcpOptions = {},
): Promise<OmnirouteMcpRunResult> {
  const readEnv = options.readEnv ?? readEnvDefault;
  if (!isOmnirouteMcpEnabled()) {
    return { status: "denied", reason: "omniroute_mcp_disabled" };
  }
  if (!isOmnirouteMcpToolAllowed(toolId)) {
    return { status: "denied", reason: "tool_not_allowlisted" };
  }

  omnirouteEmptyInputSchema.parse(rawInput ?? {});

  const client =
    options.client ??
    new OmnirouteMcpClient({
      baseUrl: resolveOmnirouteBaseUrl(readEnv),
      apiKey: readEnv("OMNIROUTE_API_KEY") || readEnv("LOCAL_OPENAI_API_KEY"),
    });

  try {
    const id = toolId as OmnirouteMcpToolId;
    if (id === "omniroute.list_models") {
      const payload = await client.getJson("/v1/models");
      return {
        status: "ok",
        output: {
          models: mapModels(sanitizeOmnirouteJson(payload)),
          source: "omniroute:/v1/models",
        },
      };
    }
    if (id === "omniroute.check_quota") {
      const payload = await client.getJson("/api/usage/quota");
      return {
        status: "ok",
        output: {
          quota: sanitizeOmnirouteJson(payload),
          source: "omniroute:/api/usage/quota",
        },
      };
    }
    const payload = await client.getJson("/api/compression/status");
    return {
      status: "ok",
      output: {
        status: sanitizeOmnirouteJson(payload),
        source: "omniroute:/api/compression/status",
      },
    };
  } catch (error) {
    if (error instanceof OmnirouteMcpClientError) {
      if (error.code === "disabled_host") {
        return { status: "denied", reason: error.message };
      }
      return { status: "failed", reason: error.message };
    }
    throw error;
  }
}
