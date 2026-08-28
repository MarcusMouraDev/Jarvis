import { z } from "zod";
import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import { jsonNoStore, readJsonBody, safeRouteError } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    kind: z.enum(["steer", "interrupt-subagent", "clarify"]),
    runId: z.string().trim().min(1),
    subagentId: z.string().trim().max(200).optional(),
    requestId: z.string().trim().max(200).optional(),
    text: z.string().trim().max(8_000).optional(),
  })
  .strict();

export async function POST(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const core = getSafeCoreRuntime();
  const auth = requireProtectedRequest(request, { store: core.store });
  if (!auth.ok) return auth.response;
  try {
    const body = bodySchema.parse(await readJsonBody(request));
    await core.service.steerHermes({
      ...body,
      sessionId: auth.session.sessionId,
    });
    return jsonNoStore({ ok: true });
  } catch (error) {
    return safeRouteError(error);
  }
}
