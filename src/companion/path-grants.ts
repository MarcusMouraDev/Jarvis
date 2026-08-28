import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export function resolveGrantedFile(grantedRoot: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("grant_path_escape");
  }
  const root = realpathSync(grantedRoot);
  const segments = relativePath.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("grant_path_escape");
  }
  let candidate = root;
  for (const segment of segments) {
    candidate = path.join(candidate, segment);
    if (lstatSync(candidate).isSymbolicLink()) throw new Error("grant_symlink_rejected");
  }
  const resolved = realpathSync(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("grant_path_escape");
  }
  return resolved;
}
