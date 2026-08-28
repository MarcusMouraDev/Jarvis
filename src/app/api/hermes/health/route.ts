import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore, safeRouteError } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import { probeHermesHealth } from "@/integrations/hermes/health";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    return jsonNoStore(await probeHermesHealth());
  } catch (error) {
    return safeRouteError(error);
  }
}
