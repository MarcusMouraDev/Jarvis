import path from "node:path";
import { getShellRoot } from "@/tools/shell-policy";

export const PATH_DENY_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".jarvis",
  "coverage",
]);

export const PATH_DENY_FILES = /(^|[/\\])\.env(\.|$)/i;

export function isPathDenied(
  relOrAbs: string,
  root = getShellRoot(),
): { denied: boolean; reason?: string } {
  if (!relOrAbs) return { denied: true, reason: "caminho vazio" };
  if (PATH_DENY_FILES.test(relOrAbs)) {
    return { denied: true, reason: "arquivo .env bloqueado" };
  }

  const parts = relOrAbs.split(/[/\\]/).filter(Boolean);
  for (const part of parts) {
    if (PATH_DENY_SEGMENTS.has(part)) {
      return { denied: true, reason: `segmento bloqueado: ${part}` };
    }
  }

  const resolved = path.isAbsolute(relOrAbs)
    ? path.resolve(relOrAbs)
    : path.resolve(root, relOrAbs);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { denied: true, reason: "fora de JARVIS_SHELL_ROOT" };
  }

  return { denied: false };
}

export function resolveRepoPath(
  rel: string,
  root = getShellRoot(),
): string | null {
  const check = isPathDenied(rel, root);
  if (check.denied) return null;
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}
