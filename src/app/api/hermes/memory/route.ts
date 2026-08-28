import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore, safeRouteError } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import { fetchHermesJson } from "@/integrations/hermes/dashboard";
import { hermesHome } from "@/integrations/hermes/profile";

export const runtime = "nodejs";

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export async function GET(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  if (!auth.ok) return auth.response;
  try {
    const home = hermesHome();
    const remote = await fetchHermesJson<{ memory?: string; user?: string }>("/api/memory");
    const [memory, user] = await Promise.all([
      remote?.memory
        ? Promise.resolve(remote.memory)
        : readOptional(join(home, "MEMORY.md")),
      remote?.user
        ? Promise.resolve(remote.user)
        : readOptional(join(home, "USER.md")),
    ]);
    return jsonNoStore({ memory, user });
  } catch (error) {
    return safeRouteError(error);
  }
}
