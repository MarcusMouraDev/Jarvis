import path from "node:path";
import { CentralWorkspaceStore } from "./central-workspace";
import { getJarvisDataDir } from "./data-dir";

let runtime: CentralWorkspaceStore | null = null;

export function getCentralWorkspaceStore(): CentralWorkspaceStore {
  if (!runtime) {
    runtime = new CentralWorkspaceStore(
      process.env.JARVIS_WORKSPACE_DIR || path.join(getJarvisDataDir(), "workspaces"),
    );
  }
  return runtime;
}

export function resetCentralWorkspaceStoreForTests(): void {
  runtime?.close();
  runtime = null;
}
