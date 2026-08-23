import os from "node:os";
import path from "node:path";

export const PATH_DENY_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".jarvis",
  "coverage",
  ".Trash",
  "Keychains",
]);

export const PATH_DENY_FILES = /(^|[/\\])\.env(\.|$)/i;

/** Sensitive home subtrees skipped by # indexing (still readable if user pastes exact path? — denied). */
export const PATH_DENY_PREFIXES = [
  "Library/Keychains",
  "Library/Cookies",
  "Library/Messages",
  "Library/Mail",
  ".ssh",
  ".gnupg",
  ".aws",
  ".config/gcloud",
];

/**
 * Root for `#caminho` autocomplete + context summarize.
 * Defaults to the user home so paths across the Mac are reachable.
 * Override with JARVIS_CONTEXT_ROOT (absolute path).
 */
export function getContextRoot(): string {
  const fromEnv = process.env.JARVIS_CONTEXT_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(os.homedir());
}

function normalizeRel(relOrAbs: string, root: string): string {
  const resolved = path.isAbsolute(relOrAbs)
    ? path.resolve(relOrAbs)
    : path.resolve(root, relOrAbs.replace(/^~\//, ""));
  if (resolved === root) return "";
  if (resolved.startsWith(root + path.sep)) {
    return path.relative(root, resolved).split(path.sep).join("/");
  }
  return resolved.split(path.sep).join("/");
}

export function isPathDenied(
  relOrAbs: string,
  root = getContextRoot(),
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
    : path.resolve(root, relOrAbs.replace(/^~\//, ""));

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { denied: true, reason: "fora de JARVIS_CONTEXT_ROOT" };
  }

  const rel = normalizeRel(relOrAbs, root);
  const relLower = rel.toLowerCase();
  for (const prefix of PATH_DENY_PREFIXES) {
    const p = prefix.toLowerCase();
    if (relLower === p || relLower.startsWith(`${p}/`)) {
      return { denied: true, reason: `área sensível: ${prefix}` };
    }
  }

  return { denied: false };
}

export function resolveRepoPath(
  rel: string,
  root = getContextRoot(),
): string | null {
  const cleaned = rel.trim().replace(/^~\//, "");
  const check = isPathDenied(cleaned, root);
  if (check.denied) return null;
  const resolved = path.isAbsolute(cleaned)
    ? path.resolve(cleaned)
    : path.resolve(root, cleaned);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/** Display path relative to context root (forward slashes). */
export function toContextRelPath(abs: string, root = getContextRoot()): string {
  const resolved = path.resolve(abs);
  if (resolved === root) return ".";
  if (resolved.startsWith(root + path.sep)) {
    return path.relative(root, resolved).split(path.sep).join("/");
  }
  return resolved.split(path.sep).join("/");
}
