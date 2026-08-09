import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import { jsonNoStore } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

interface RunRouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, context: RunRouteContext) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const core = getSafeCoreRuntime();
  const auth = requireProtectedRequest(request, { store: core.store });
  if (!auth.ok) return auth.response;
  const { runId } = await context.params;
  const snapshot = core.service.getRunSnapshot(auth.session, runId);
  return snapshot
    ? jsonNoStore(snapshot)
    : jsonNoStore({ error: "run_not_found" }, { status: 404 });
}
