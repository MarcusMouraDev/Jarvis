import { workspaceRouteError } from "@/core/central-workspace-route";
import { getCompanionStore } from "@/core/companion-runtime";
import {
  COMPANION_CAPABILITIES,
  type CompanionCapability,
} from "@/core/companion-store";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore, readJsonBody } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ deviceId: string }> },
) {
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    const { deviceId } = await context.params;
    const device = getCompanionStore().getDevice(deviceId);
    if (!device || device.identityLogin !== auth.session.identityLogin) {
      throw new Error("companion_not_found");
    }
    const body = (await readJsonBody(request)) as {
      capability?: string;
      payload?: unknown;
      idempotencyKey?: string;
      ttlSeconds?: number;
    };
    if (!COMPANION_CAPABILITIES.includes(body.capability as CompanionCapability)) {
      throw new Error("invalid_companion_capability");
    }
    if (!body.idempotencyKey || body.idempotencyKey.length > 128) {
      throw new Error("invalid_idempotency_key");
    }
    return jsonNoStore(
      getCompanionStore().createJob({
        deviceId,
        capability: body.capability as CompanionCapability,
        payload: body.payload,
        idempotencyKey: body.idempotencyKey,
        ttlSeconds: body.ttlSeconds,
      }),
      { status: 201 },
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}
