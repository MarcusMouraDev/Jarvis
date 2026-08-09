import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import {
  jsonNoStore,
  readJsonBody,
  safeRouteError,
} from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

interface ApprovalRouteContext {
  params: Promise<{ approvalId: string }>;
}

export async function POST(request: Request, context: ApprovalRouteContext) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const core = getSafeCoreRuntime();
  const auth = requireProtectedRequest(request, { store: core.store });
  if (!auth.ok) return auth.response;
  try {
    const { approvalId } = await context.params;
    const snapshot = await core.service.decideApproval(
      auth.session,
      approvalId,
      await readJsonBody(request),
    );
    return jsonNoStore(snapshot);
  } catch (error) {
    return safeRouteError(error);
  }
}
