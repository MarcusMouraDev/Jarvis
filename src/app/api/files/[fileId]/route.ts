import { requireWorkspaceRequest, workspaceRouteError } from "@/core/central-workspace-route";
import { jsonNoStore } from "@/core/safe-route-response";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  const auth = requireWorkspaceRequest(request, "files.read");
  if (!auth.ok) return auth.response;
  try {
    const { fileId } = await context.params;
    const file = auth.store.getFile(fileId);
    if (!file) throw new Error("file_not_found");
    return jsonNoStore({ file, versions: auth.store.listVersions(fileId) });
  } catch (error) {
    return workspaceRouteError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ fileId: string }> }) {
  const auth = requireWorkspaceRequest(request);
  if (!auth.ok) return auth.response;
  try {
    return jsonNoStore(auth.store.deleteFile((await context.params).fileId));
  } catch (error) {
    return workspaceRouteError(error);
  }
}
