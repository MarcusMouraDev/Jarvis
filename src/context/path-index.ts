import fs from "node:fs";
import path from "node:path";
import { getShellRoot } from "@/tools/shell-policy";
import { isPathDenied } from "./path-policy";

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
]);

export function indexPaths(
  query = "",
  root = getShellRoot(),
  limit = 40,
): PathIndexEntry[] {
  const q = query.trim().toLowerCase();
  const out: PathIndexEntry[] = [];

  function walk(dir: string, depth: number) {
    if (out.length >= limit || depth > 6) return;
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
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (isPathDenied(rel, root).denied) continue;

      const matches = !q || rel.toLowerCase().includes(q);
      if (matches) {
        out.push({ relPath: rel, isDir: entry.isDirectory() });
      }
      if (entry.isDirectory()) walk(abs, depth + 1);
    }
  }

  walk(root, 0);
  return out.slice(0, limit);
}
