import { z } from "zod";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore, readJsonBody, safeRouteError } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import { jobsFromCronResult, manageCron } from "@/integrations/hermes/cron";

export const runtime = "nodejs";

const postSchema = z
  .object({
    action: z.enum(["list", "add", "pause", "resume", "remove"]),
    name: z.string().trim().max(120).optional(),
    schedule: z.string().trim().max(120).optional(),
    prompt: z.string().trim().max(8_000).optional(),
    deliver: z.string().trim().max(120).optional(),
  })
  .strict();

export async function GET(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    const result = await manageCron({ action: "list", include_disabled: true });
    return jsonNoStore({ jobs: jobsFromCronResult(result) });
  } catch (error) {
    return safeRouteError(error);
  }
}

export async function POST(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    const body = postSchema.parse(await readJsonBody(request));
    const result = await manageCron(body);
    return jsonNoStore({ ok: true, result, jobs: jobsFromCronResult(result) });
  } catch (error) {
    return safeRouteError(error);
  }
}
