import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import { jsonNoStore } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import { GET as getRunEvents } from "./events/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunRouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, context: RunRouteContext) {
  const accept = request.headers.get("accept") ?? "";
  const stream = new URL(request.url).searchParams.get("stream");
  if (accept.includes("text/event-stream") || stream === "1") {
    return getRunEvents(request, context);
  }
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
