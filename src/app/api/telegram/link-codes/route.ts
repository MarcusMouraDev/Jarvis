import { workspaceRouteError } from "@/core/central-workspace-route";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { getTelegramStore } from "@/integrations/telegram/runtime";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    if (!auth.session.identityLogin) throw new Error("tailscale_identity_required");
    return jsonNoStore(getTelegramStore().createLinkCode(auth.session.identityLogin), { status: 201 });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
