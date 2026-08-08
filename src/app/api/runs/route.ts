import {
  getRun,
  listRuns,
  type ListRunsFilters,
  type RunKind,
  type RunStatus,
} from "@/core/run-ledger";

export const runtime = "nodejs";

export async function GET(req: Request) {
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
