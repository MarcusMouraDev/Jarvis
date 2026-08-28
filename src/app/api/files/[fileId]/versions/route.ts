import { requireWorkspaceRequest, workspaceRouteError } from "@/core/central-workspace-route";
import { jsonNoStore, readJsonBody } from "@/core/safe-route-response";
import type { CreateUploadInput } from "@/core/central-workspace";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ fileId: string }> }) {
  const auth = requireWorkspaceRequest(request, "files.upload");
  if (!auth.ok) return auth.response;
  try {
    const { fileId } = await context.params;
    const body = (await readJsonBody(request)) as Omit<CreateUploadInput, "workspaceId"> & {
      baseVersion: number;
    };
    return jsonNoStore(auth.store.createVersionUpload(fileId, body.baseVersion, body), {
      status: 201,
    });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
