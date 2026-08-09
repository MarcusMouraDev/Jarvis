import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import { jsonNoStore, safeRouteError } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

interface RunRouteContext {
  params: Promise<{ runId: string }>;
}

export async function POST(request: Request, context: RunRouteContext) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const core = getSafeCoreRuntime();
  const auth = requireProtectedRequest(request, { store: core.store });
  if (!auth.ok) return auth.response;
  try {
    const { runId } = await context.params;
    const snapshot = core.service.cancelRun(auth.session, runId);
    return snapshot
      ? jsonNoStore(snapshot)
      : jsonNoStore({ error: "run_not_found" }, { status: 404 });
  } catch (error) {
    return safeRouteError(error);
  }
}
