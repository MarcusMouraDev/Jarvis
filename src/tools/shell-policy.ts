import path from "node:path";

export type ShellTier = "auto" | "confirm" | "deny";

export interface ClassifiedCommand {
  tier: ShellTier;
  raw: string;
  argv: string[];
  reasons: string[];
  bin: string;
}

const META = /[;&|><`$()\\~]|&&|\|\|/;

/** Read-only patterns that may auto-run via execFile (no shell). */
const AUTO_PATTERNS: Array<{ bin: string; args?: RegExp; exactArgs?: string[] }> = [
  { bin: "ls" },
  { bin: "pwd", exactArgs: [] },
  { bin: "date", exactArgs: [] },
  { bin: "which" },
  { bin: "cat" },
  { bin: "head" },
  { bin: "tail" },
  { bin: "wc" },
  { bin: "rg" },
  { bin: "grep" },
  { bin: "find" },
  { bin: "git", args: /^(status|log|diff|branch|show)$/ },
  { bin: "node", exactArgs: ["-v"] },
  { bin: "npm", args: /^run$/, /* next arg checked below */ },
  { bin: "tsc", exactArgs: ["--noEmit"] },
];

const NPM_AUTO_SCRIPTS = new Set(["lint", "typecheck", "test"]);

const WRITEISH =
  /\b(rm|mv|cp|chmod|chown|kill|pkill|sudo|tee|dd|mkfs|shutdown|reboot|curl|wget|ssh|scp|rsync|npm\s+i(nstall)?|npm\s+publish|git\s+push|git\s+commit|git\s+reset|git\s+clean)\b/i;

const ENV_FILE = /(^|[/\\])\.env(\.|$)/i;

export function getShellRoot(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.JARVIS_SHELL_ROOT || process.cwd(),
  );
}

/** Simple argv split respecting single/double quotes. */
export function tokenizeCommand(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw.trim()))) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function pathEscapesRoot(token: string, root: string): boolean {
  if (!token || token.startsWith("-")) return false;
  if (token.includes("..")) {
    const resolved = path.resolve(root, token);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) return true;
  }
  if (path.isAbsolute(token)) {
    const resolved = path.resolve(token);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) return true;
  }
  return false;
}

function matchesAuto(argv: string[]): boolean {
  if (argv.length === 0) return false;
  const bin = path.basename(argv[0]);
  for (const rule of AUTO_PATTERNS) {
    if (rule.bin !== bin) continue;
    if (rule.exactArgs) {
      if (argv.slice(1).join(" ") === rule.exactArgs.join(" ")) return true;
      continue;
    }
    if (bin === "npm") {
      // npm run lint|typecheck|test
      if (argv[1] === "run" && argv[2] && NPM_AUTO_SCRIPTS.has(argv[2]) && argv.length === 3) {
        return true;
      }
      continue;
    }
    if (rule.args) {
      if (argv[1] && rule.args.test(argv[1])) return true;
      continue;
    }
    // bare bin with any non-meta args
    return true;
  }
  return false;
}

export function classifyCommand(raw: string): ClassifiedCommand {
  const trimmed = raw.trim();
  const reasons: string[] = [];
  const root = getShellRoot();

  if (!trimmed) {
    return {
      tier: "deny",
      raw: trimmed,
      argv: [],
      reasons: ["comando vazio"],
      bin: "",
    };
  }

  if (META.test(trimmed)) {
    reasons.push("encadeamento de shell");
  }

  if (WRITEISH.test(trimmed)) {
    reasons.push("escrita ou rede");
  }

  if (ENV_FILE.test(trimmed)) {
    return {
      tier: "deny",
      raw: trimmed,
      argv: tokenizeCommand(trimmed),
      reasons: ["leitura de .env bloqueada"],
      bin: "",
    };
  }

  const argv = tokenizeCommand(trimmed);
  const bin = argv[0] ? path.basename(argv[0]) : "";

  for (const token of argv.slice(1)) {
    if (pathEscapesRoot(token, root)) {
      return {
        tier: "deny",
        raw: trimmed,
        argv,
        reasons: ["caminho fora de JARVIS_SHELL_ROOT"],
        bin,
      };
    }
    if (ENV_FILE.test(token)) {
      return {
        tier: "deny",
        raw: trimmed,
        argv,
        reasons: ["leitura de .env bloqueada"],
        bin,
      };
    }
  }

  const hasMeta = reasons.includes("encadeamento de shell");
  const autoOk = !hasMeta && matchesAuto(argv);

  if (autoOk && reasons.length === 0) {
    return { tier: "auto", raw: trimmed, argv, reasons: [], bin };
  }

  if (!autoOk && !reasons.includes("fora da allowlist") && !hasMeta) {
    reasons.push("fora da allowlist");
  }

  return {
    tier: "confirm",
    raw: trimmed,
    argv,
    reasons: reasons.length ? reasons : ["requer aprovação"],
    bin,
  };
}
