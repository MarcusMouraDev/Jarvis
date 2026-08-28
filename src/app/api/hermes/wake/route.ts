import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore, safeRouteError } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import { getHermesBridge } from "@/integrations/hermes/bridge";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const store = getCoreStore();
  const auth = requireProtectedRequest(request, { store });
  if (!auth.ok) return auth.response;
  try {
    await getHermesBridge(store).startWake();
    return jsonNoStore({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/busy|wake_owned|owned/i.test(message)) {
      return jsonNoStore({ ok: false, status: "busy", reason: "wake_owned" }, { status: 409 });
    }
    return safeRouteError(error);
  }
}
