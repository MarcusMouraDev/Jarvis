import {
  getRun,
  listRuns,
  type ListRunsFilters,
  type RunKind,
  type RunStatus,
} from "@/core/run-ledger";
import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import {
  jsonNoStore,
  readJsonBody,
  safeRouteError,
} from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

async function legacyGET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const detail = getRun(id);
    if (!detail) {
      return new Response(JSON.stringify({ error: "run_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return Response.json(detail);
  }

  const filters: ListRunsFilters = {};
  const kind = url.searchParams.get("kind");
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Number(url.searchParams.get("limit") ?? "40");

  if (kind) filters.kind = kind as RunKind;
  if (status) filters.status = status as RunStatus;
  if (q) filters.q = q;
  if (from) filters.from = from;
  if (to) filters.to = to;
  filters.limit = Number.isFinite(limit) ? limit : 40;

  const runs = listRuns(filters);
  return Response.json({ count: runs.length, runs });
}

export async function GET(request: Request) {
  if (!isSafeAgentCoreEnabled()) return legacyGET(request);
  const core = getSafeCoreRuntime();
  const auth = requireProtectedRequest(request, { store: core.store });
  if (!auth.ok) return auth.response;
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
    return jsonNoStore({ runs: core.service.listRuns(auth.session, limit) });
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
    const snapshot = await core.service.createRun(
      auth.session,
      await readJsonBody(request),
    );
    return jsonNoStore(snapshot, { status: 202 });
  } catch (error) {
    return safeRouteError(error);
  }
}
