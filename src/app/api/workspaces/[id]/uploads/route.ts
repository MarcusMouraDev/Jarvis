import { requireWorkspaceRequest, workspaceRouteError } from "@/core/central-workspace-route";
import { readJsonBody, jsonNoStore } from "@/core/safe-route-response";
import type { CreateUploadInput } from "@/core/central-workspace";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireWorkspaceRequest(request, "files.upload");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const body = (await readJsonBody(request)) as Omit<CreateUploadInput, "workspaceId">;
    auth.store.createWorkspace({ workspaceId: id, name: id });
    return jsonNoStore(auth.store.createUpload({ ...body, workspaceId: id }), { status: 201 });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
