import { workspaceRouteError } from "@/core/central-workspace-route";
import { getCompanionStore } from "@/core/companion-runtime";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ deviceId: string }> },
) {
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    const device = getCompanionStore().getDevice((await context.params).deviceId);
    if (!device || device.identityLogin !== auth.session.identityLogin) {
      throw new Error("companion_not_found");
    }
    return jsonNoStore(getCompanionStore().revokeDevice(device.deviceId));
  } catch (error) {
    return workspaceRouteError(error);
  }
}
