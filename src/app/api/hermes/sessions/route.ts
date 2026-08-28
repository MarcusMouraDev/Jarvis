import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import { jsonNoStore, readJsonBody, safeRouteError } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import { listHermesSessions } from "@/integrations/hermes/sessions";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const core = getSafeCoreRuntime();
  const auth = requireProtectedRequest(request, { store: core.store });
  if (!auth.ok) return auth.response;
  try {
    return jsonNoStore({ sessions: listHermesSessions() });
  } catch (error) {
    return safeRouteError(error);
  }
}

export async function POST(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const core = getSafeCoreRuntime();
  const auth = requireProtectedRequest(request, { store: core.store });
  if (!auth.ok) return auth.response;
  try {
    const snapshot = await core.service.resumeHermesSession(
      auth.session,
      await readJsonBody(request),
    );
    return jsonNoStore(snapshot, { status: 202 });
  } catch (error) {
    return safeRouteError(error);
  }
}
