"use client";

import { useCallback, useEffect, useState } from "react";
import { safeCoreFetch } from "@/lib/safe-core-client";
import { browserUploadOrigin, uploadWorkspaceFile } from "@/lib/resumable-upload";

interface WorkspaceFileRow {
  fileId: string;
  relativePath: string;
  mime: string;
  size: number;
  version: number;
  origin: "mac" | "iphone" | "telegram" | "vps";
  updatedAt: string;
}

export function WorkspaceFilesPanel({ workspaceId }: { workspaceId: string }) {
  const [files, setFiles] = useState<WorkspaceFileRow[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await safeCoreFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`);
    if (!response.ok) throw new Error(`files_${response.status}`);
    setFiles(((await response.json()) as { files: WorkspaceFileRow[] }).files);
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remote state hydration.
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "files_failed"));
  }, [refresh]);

  const upload = async (selected: FileList | null) => {
    if (!selected?.length) return;
    setError(null);
    try {
      for (const file of Array.from(selected)) {
        setProgress(0);
        await uploadWorkspaceFile(workspaceId, file, {
          origin: browserUploadOrigin(navigator.userAgent),
          onProgress: setProgress,
        });
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "upload_failed");
    } finally {
      setProgress(null);
    }
  };

  const download = async (file: WorkspaceFileRow) => {
    const response = await safeCoreFetch(`/api/files/${encodeURIComponent(file.fileId)}/content`);
    if (!response.ok) {
      setError(`download_${response.status}`);
      return;
    }
    const href = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = file.relativePath.split("/").at(-1) ?? "documento";
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <section className="mx-auto w-full max-w-4xl p-4 pb-24" aria-label="Arquivos">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div><p className="text-xs uppercase tracking-[.24em] text-cyan-300">Workspace central</p><h1 className="text-xl text-ink-0">Arquivos</h1></div>
        <label className="cursor-pointer rounded-lg border border-cyan-300/30 px-4 py-3 text-sm text-cyan-100">
          Escolher arquivos
          <input type="file" multiple className="sr-only" onChange={(event) => void upload(event.currentTarget.files)} />
        </label>
      </div>
      {progress !== null ? <div role="status" className="mb-4 text-sm text-ink-1">Enviando… {Math.round(progress)}%</div> : null}
      {error ? <p role="alert" className="mb-4 text-sm text-rose-300">{error}. Tente novamente quando a VPS estiver disponível.</p> : null}
      {!files.length ? <p className="rounded-xl border border-white/10 p-6 text-sm text-ink-2">Nenhum documento central. Arquivos locais continuam locais até upload explícito.</p> : (
        <ul className="space-y-2">
          {files.map((file) => <li key={file.fileId} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="min-w-0"><p className="truncate text-sm text-ink-0">{file.relativePath}</p><p className="text-xs text-ink-2">{file.origin} · v{file.version} · {Math.ceil(file.size / 1024)} KB</p></div>
            <button type="button" onClick={() => void download(file)} className="min-h-11 rounded-lg border border-white/15 px-3 text-xs text-ink-1">Baixar</button>
          </li>)}
        </ul>
      )}
    </section>
  );
}
