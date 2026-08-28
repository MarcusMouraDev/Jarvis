import { requireWorkspaceRequest, workspaceRouteError } from "@/core/central-workspace-route";
import { jsonNoStore } from "@/core/safe-route-response";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireWorkspaceRequest(request, "files.upload");
  if (!auth.ok) return auth.response;
  try {
    return jsonNoStore(auth.store.completeUpload((await context.params).id));
  } catch (error) {
    return workspaceRouteError(error);
  }
}
