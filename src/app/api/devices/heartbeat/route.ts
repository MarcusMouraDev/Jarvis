import { getCompanionStore, readCompanionToken } from "@/core/companion-runtime";
import { workspaceRouteError } from "@/core/central-workspace-route";
import { jsonNoStore, readJsonBody } from "@/core/safe-route-response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { capabilities?: string[] };
    return jsonNoStore(
      getCompanionStore().heartbeat(readCompanionToken(request), body.capabilities ?? []),
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}
