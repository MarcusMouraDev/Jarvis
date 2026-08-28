import path from "node:path";
import { requireWorkspaceRequest, workspaceRouteError } from "@/core/central-workspace-route";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  const auth = requireWorkspaceRequest(request, "files.read");
  if (!auth.ok) return auth.response;
  try {
    const { fileId } = await context.params;
    const file = auth.store.getFile(fileId);
    if (!file || file.deletedAt) throw new Error("file_not_found");
    const versionValue = new URL(request.url).searchParams.get("version");
    const content = auth.store.readFileContent(fileId, versionValue ? Number(versionValue) : undefined);
    return new Response(new Uint8Array(content), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.posix.basename(file.relativePath))}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
