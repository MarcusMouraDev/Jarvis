import { requireWorkspaceRequest, workspaceRouteError } from "@/core/central-workspace-route";
import { jsonNoStore } from "@/core/safe-route-response";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireWorkspaceRequest(request, "files.list");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    return jsonNoStore({ files: auth.store.listFiles(id) });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
