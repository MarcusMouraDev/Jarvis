import { safeCoreFetch } from "./safe-core-client";

const DEFAULT_CHUNK_SIZE = 1024 * 1024;

export function browserUploadOrigin(userAgent: string): "mac" | "iphone" {
  return /iPhone|iPad|iPod/i.test(userAgent) ? "iphone" : "mac";
}

export function splitUploadChunks(size: number, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid_upload_size");
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error("invalid_chunk_size");
  const chunks: Array<{ index: number; start: number; end: number }> = [];
  for (let start = 0, index = 0; start < size; start += chunkSize, index += 1) {
    chunks.push({ index, start, end: Math.min(size, start + chunkSize) });
  }
  return chunks;
}

async function digest(value: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function retry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function uploadWorkspaceFile(
  workspaceId: string,
  file: File,
  options: { origin?: "mac" | "iphone"; onProgress?: (progress: number) => void } = {},
) {
  const full = await file.arrayBuffer();
  const sha256 = await digest(full);
  const resumeKey = `jarvis.upload.${workspaceId}.${sha256}`;
  let uploadId = window.localStorage.getItem(resumeKey);
  if (!uploadId) {
    const response = await safeCoreFetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/uploads`,
      {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          relativePath: `Inbox/${file.name}`,
          mime: file.type || "application/octet-stream",
          size: file.size,
          sha256,
          origin: options.origin ?? "iphone",
        }),
      },
    );
    if (!response.ok) throw new Error(`upload_create_${response.status}`);
    uploadId = String(((await response.json()) as { uploadId: string }).uploadId);
    window.localStorage.setItem(resumeKey, uploadId);
  }

  const chunks = splitUploadChunks(file.size);
  for (const chunk of chunks) {
    const body = await file.slice(chunk.start, chunk.end).arrayBuffer();
    const checksum = await digest(body);
    await retry(async () => {
      const response = await safeCoreFetch(
        `/api/uploads/${encodeURIComponent(uploadId!)}/chunks/${chunk.index}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Chunk-SHA256": checksum,
          },
          body,
        },
      );
      if (!response.ok) throw new Error(`upload_chunk_${response.status}`);
    });
    options.onProgress?.((chunk.end / Math.max(1, file.size)) * 100);
  }
  const complete = await safeCoreFetch(`/api/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: "POST",
  });
  if (!complete.ok) throw new Error(`upload_complete_${complete.status}`);
  window.localStorage.removeItem(resumeKey);
  options.onProgress?.(100);
  return complete.json();
}
