import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "@/core/policy";
import type { PathContextSummary } from "@/composer/mention-types";
import { getShellRoot } from "@/tools/shell-policy";
import { resolveRepoPath } from "./path-policy";

const MAX_BYTES = 512 * 1024;
const MAX_EXCERPT = 2000;

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".md": "markdown",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".css": "css",
    ".html": "html",
    ".sh": "shell",
  };
  return map[ext] ?? "text";
}

function extractImports(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(
    /(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\()['"]([^'"]+)['"]/g,
  )) {
    out.add(m[1]!);
  }
  return [...out].slice(0, 24);
}

function extractExports(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(
    /export\s+(?:async\s+)?(?:function|class|const|let|type|interface)\s+([A-Za-z0-9_]+)/g,
  )) {
    out.add(m[1]!);
  }
  for (const m of content.matchAll(
    /export\s+\{\s*([^}]+)\s*\}/g,
  )) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) out.add(name);
    }
  }
  return [...out].slice(0, 32);
}

function extractSymbols(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(
    /(?:function|class|const|let|type|interface)\s+([A-Za-z0-9_]+)/g,
  )) {
    out.add(m[1]!);
  }
  return [...out].slice(0, 40);
}

export function summarizePath(
  relPath: string,
  root = getShellRoot(),
): PathContextSummary | { error: string } {
  const abs = resolveRepoPath(relPath, root);
  if (!abs) return { error: "caminho negado pela política" };

  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return { error: "arquivo não encontrado" };
  }

  if (st.isDirectory()) {
    return {
      relPath: path.relative(root, abs).split(path.sep).join("/"),
      absPath: abs,
      hash: crypto.createHash("sha256").update(abs).digest("hex").slice(0, 16),
      byteSize: 0,
      lineCount: 0,
      language: "directory",
      exports: [],
      imports: [],
      symbols: [],
      excerpt: `[diretório] ${path.basename(abs)}`,
    };
  }

  if (st.size > MAX_BYTES) {
    return { error: `arquivo acima de ${MAX_BYTES} bytes` };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch {
    return { error: "não foi possível ler o arquivo" };
  }

  const redacted = redactSecrets(raw);
  const excerpt = redacted.slice(0, MAX_EXCERPT);
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const rel = path.relative(root, abs).split(path.sep).join("/");

  return {
    relPath: rel,
    absPath: abs,
    hash,
    byteSize: st.size,
    lineCount: raw.split(/\r?\n/).length,
    language: detectLanguage(abs),
    exports: extractExports(raw),
    imports: extractImports(raw),
    symbols: extractSymbols(raw),
    excerpt,
  };
}
