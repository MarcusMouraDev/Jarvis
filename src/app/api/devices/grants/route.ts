import { getCompanionStore, readCompanionToken } from "@/core/companion-runtime";
import { workspaceRouteError } from "@/core/central-workspace-route";
import { jsonNoStore, readJsonBody } from "@/core/safe-route-response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as {
      grantId: string;
      label: string;
      access: "read" | "read-write";
    };
    return jsonNoStore(getCompanionStore().upsertGrant(readCompanionToken(request), body));
  } catch (error) {
    return workspaceRouteError(error);
  }
}
