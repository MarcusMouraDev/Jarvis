import path from "node:path";
import { CompanionStore } from "./companion-store";
import { getJarvisDataDir } from "./data-dir";

let runtime: CompanionStore | null = null;

export function getCompanionStore(): CompanionStore {
  if (!runtime) runtime = new CompanionStore(path.join(getJarvisDataDir(), "companions"));
  return runtime;
}

export function resetCompanionStoreForTests(): void {
  runtime?.close();
  runtime = null;
}

export function readCompanionToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer jcp_")) throw new Error("companion_unauthorized");
  return authorization.slice("Bearer ".length);
}
