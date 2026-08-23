import { jsonNoStore } from "@/core/safe-route-response";
import { requireProtectedRequest, validateLoopbackRequest } from "@/core/session-security";
import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import { OmnirouteMcpClient, resolveOmnirouteBaseUrl } from "@/integrations/omniroute-mcp/client";
import { fetchOmnirouteUsageReport } from "@/integrations/omniroute-mcp/usage-report";

export const runtime = "nodejs";

function readEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export async function GET(request: Request) {
  if (isSafeAgentCoreEnabled()) {
    const core = getSafeCoreRuntime();
    const auth = requireProtectedRequest(request, { store: core.store });
    if (!auth.ok) return auth.response;
  } else if (!validateLoopbackRequest(request)) {
    return jsonNoStore({ error: "forbidden" }, { status: 403 });
  }

  const client = new OmnirouteMcpClient({
    baseUrl: resolveOmnirouteBaseUrl(readEnv),
    apiKey: readEnv("OMNIROUTE_API_KEY") || readEnv("LOCAL_OPENAI_API_KEY"),
  });
  const report = await fetchOmnirouteUsageReport(client);
  if (!report.omniUp) {
    return jsonNoStore(report, { status: 502 });
  }
  return jsonNoStore(report);
}
