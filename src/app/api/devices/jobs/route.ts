import { getCompanionStore, readCompanionToken } from "@/core/companion-runtime";
import { workspaceRouteError } from "@/core/central-workspace-route";
import { jsonNoStore } from "@/core/safe-route-response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = readCompanionToken(request);
    const wait = Math.min(30, Math.max(0, Number(new URL(request.url).searchParams.get("wait") ?? 0)));
    let jobs = getCompanionStore().pollJobs(token);
    const deadline = Date.now() + wait * 1000;
    while (!jobs.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
      jobs = getCompanionStore().pollJobs(token);
    }
    return jsonNoStore({ jobs });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
