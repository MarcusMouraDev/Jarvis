import { getCompanionStore } from "@/core/companion-runtime";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  if (!auth.session.identityLogin) {
    return jsonNoStore({ error: "tailscale_identity_required" }, { status: 403 });
  }
  return jsonNoStore({ devices: getCompanionStore().listDevices(auth.session.identityLogin) });
}
