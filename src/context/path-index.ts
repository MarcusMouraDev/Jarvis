import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  getContextRoot,
  isPathDenied,
  toContextRelPath,
} from "./path-policy";

export interface PathIndexEntry {
  relPath: string;
  isDir: boolean;
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".jarvis",
  "coverage",
  "dist",
  "build",
  ".turbo",
  "playwright-report",
  "test-results",
  ".Trash",
  "Caches",
  "cache",
  "__pycache__",
  ".cache",
  "Library",
]);

function scoreMatch(rel: string, q: string): number {
  const lower = rel.toLowerCase();
  const base = path.basename(lower);
  if (base === q) return 0;
  if (base.startsWith(q)) return 1;
  if (lower.endsWith(`/${q}`)) return 2;
  if (base.includes(q)) return 3;
  if (lower.includes(q)) return 4;
  return 5;
}

function pushUnique(
  out: PathIndexEntry[],
  seen: Set<string>,
  entry: PathIndexEntry,
  limit: number,
) {
  if (out.length >= limit) return;
  if (seen.has(entry.relPath)) return;
  seen.add(entry.relPath);
  out.push(entry);
}

function resolveQueryStart(
  query: string,
  root: string,
): { startDir: string; filter: string } {
  const raw = query.replace(/^~\//, "").replace(/^\.\//, "");
  if (!raw.includes("/") && !raw.includes("\\")) {
    return { startDir: root, filter: raw };
  }

  const absCandidate = path.isAbsolute(query)
    ? path.resolve(query)
    : path.resolve(root, raw);
  try {
    if (fs.existsSync(absCandidate) && fs.statSync(absCandidate).isDirectory()) {
      return { startDir: absCandidate, filter: "" };
    }
  } catch {
    /* fall through */
  }

  const parent = path.dirname(absCandidate);
  const filter = path.basename(absCandidate);
  try {
    if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
      return { startDir: parent, filter };
    }
  } catch {
    /* fall through */
  }
  return { startDir: root, filter: raw };
}

function walkIndex(
  startDir: string,
  root: string,
  filter: string,
  limit: number,
  maxDepth: number,
): PathIndexEntry[] {
  const q = filter.trim().toLowerCase();
  const out: PathIndexEntry[] = [];
  const seen = new Set<string>();

  function walk(dir: string, depth: number) {
    if (out.length >= limit || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".env")) continue;
      }
      if (SKIP_DIRS.has(entry.name)) continue;

      const abs = path.join(dir, entry.name);
      const rel = toContextRelPath(abs, root);
      if (isPathDenied(rel, root).denied) continue;

      const matches = !q || rel.toLowerCase().includes(q);
      if (matches) {
        pushUnique(out, seen, { relPath: rel, isDir: entry.isDirectory() }, limit);
      }
      if (entry.isDirectory()) walk(abs, depth + 1);
    }
  }

  walk(startDir, 0);
  return out;
}

function spotlightIndex(
  query: string,
  root: string,
  limit: number,
): PathIndexEntry[] {
  if (process.platform !== "darwin") return [];
  const q = query.trim();
  if (q.length < 2) return [];

  let stdout = "";
  try {
    // Name match across the context root (usually $HOME).
    stdout = execFileSync(
      "mdfind",
      ["-onlyin", root, `kMDItemFSName == '*${q.replace(/[*'\\]/g, "")}*'cd`],
      {
        encoding: "utf8",
        timeout: 2500,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
  } catch {
    try {
      stdout = execFileSync("mdfind", ["-onlyin", root, q.replace(/['\\]/g, "")], {
        encoding: "utf8",
        timeout: 2500,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch {
      return [];
    }
  }

  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, limit * 4);

  const scored: Array<PathIndexEntry & { score: number }> = [];
  const seen = new Set<string>();
  const qLower = q.toLowerCase();

  for (const abs of lines) {
    const rel = toContextRelPath(abs, root);
    if (seen.has(rel)) continue;
    if (isPathDenied(rel, root).denied) continue;
    if (!rel.toLowerCase().includes(qLower) && !path.basename(rel).toLowerCase().includes(qLower)) {
      continue;
    }
    let isDir = false;
    try {
      isDir = fs.statSync(abs).isDirectory();
    } catch {
      continue;
    }
    seen.add(rel);
    scored.push({
      relPath: rel,
      isDir,
      score: scoreMatch(rel, qLower),
    });
  }

  scored.sort((a, b) => a.score - b.score || a.relPath.length - b.relPath.length);
  return scored.slice(0, limit).map(({ relPath, isDir }) => ({ relPath, isDir }));
}

/**
 * Autocomplete for `#caminho` across JARVIS_CONTEXT_ROOT (default: home).
 * Uses Spotlight on macOS when the query has 2+ chars; falls back to a bounded walk.
 */
export function indexPaths(
  query = "",
  root = getContextRoot(),
  limit = 40,
): PathIndexEntry[] {
  const q = query.trim();

  if (q.length >= 2) {
    const viaSpotlight = spotlightIndex(q, root, limit);
    if (viaSpotlight.length > 0) return viaSpotlight;
  }

  const { startDir, filter } = resolveQueryStart(q, root);
  if (!startDir.startsWith(root + path.sep) && startDir !== root) {
    return [];
  }

  // Deeper walk when navigating a concrete folder prefix; shallow for bare queries.
  const maxDepth = filter.includes("/") || startDir !== root ? 5 : q ? 4 : 2;
  const walked = walkIndex(startDir, root, filter || q, limit * 2, maxDepth);
  const qLower = (filter || q).toLowerCase();
  if (!qLower) return walked.slice(0, limit);

  return walked
    .map((e) => ({ ...e, score: scoreMatch(e.relPath, qLower) }))
    .sort((a, b) => a.score - b.score || a.relPath.length - b.relPath.length)
    .slice(0, limit)
    .map(({ relPath, isDir }) => ({ relPath, isDir }));
}
