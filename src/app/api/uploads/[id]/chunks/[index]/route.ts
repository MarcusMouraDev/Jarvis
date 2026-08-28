import { requireWorkspaceRequest, workspaceRouteError } from "@/core/central-workspace-route";
import { jsonNoStore } from "@/core/safe-route-response";
import { MAX_UPLOAD_CHUNK_BYTES } from "@/core/central-workspace";

export const runtime = "nodejs";

async function readChunk(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_CHUNK_BYTES) throw new Error("chunk_too_large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_UPLOAD_CHUNK_BYTES) {
      await reader.cancel();
      throw new Error("chunk_too_large");
    }
    parts.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; index: string }> },
) {
  const auth = requireWorkspaceRequest(request, "files.upload");
  if (!auth.ok) return auth.response;
  try {
    const { id, index } = await context.params;
    const checksum = request.headers.get("x-chunk-sha256");
    if (!checksum) throw new Error("missing_chunk_checksum");
    const result = auth.store.putChunk(
      id,
      Number(index),
      await readChunk(request),
      checksum,
    );
    return jsonNoStore(result);
  } catch (error) {
    return workspaceRouteError(error);
  }
}
