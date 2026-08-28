import { z } from "zod";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore, readJsonBody, safeRouteError } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import {
  listMessagingPlatforms,
  patchMessagingPlatform,
  testMessagingPlatform,
} from "@/integrations/hermes/channels";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    enabled: z.boolean().optional(),
    env: z.record(z.string().max(80), z.string().max(4_000)).optional(),
    test: z.boolean().optional(),
  })
  .strict();

export async function GET(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    return jsonNoStore(await listMessagingPlatforms());
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
    const body = patchSchema.parse(await readJsonBody(request));
    if (body.test) {
      const response = await testMessagingPlatform(body.id);
      const payload = await response.json().catch(() => ({ ok: response.ok }));
      return jsonNoStore(payload, { status: response.ok ? 200 : 502 });
    }
    const response = await patchMessagingPlatform(body.id, {
      enabled: body.enabled,
      env: body.env,
    });
    const payload = await response.json().catch(() => ({ ok: response.ok }));
    return jsonNoStore(payload, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return safeRouteError(error);
  }
}
