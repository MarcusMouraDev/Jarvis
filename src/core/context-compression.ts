import type { JsonValue } from "./core-store";

export type CompressionEngine = "rtk-lite" | "none";

export interface CompressionMeta {
  engine: CompressionEngine;
  originalBytes: number;
  sentBytes: number;
  ratio: number;
  truncated: boolean;
  optedOut: boolean;
}

export interface CompressionResult {
  output: JsonValue;
  meta: CompressionMeta;
}

const DEFAULT_THRESHOLD = 4096;
const MAX_COLLAPSED_RUN = 3;
const STACK_KEEP_HEAD = 8;
const STACK_KEEP_TAIL = 12;
const STDERR_TAIL_LINES = 40;

const TERMINAL_TOOLS = new Set(["terminal.read", "terminal.run"]);

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function looksLikePath(line: string): boolean {
  return /(?:^|[\s"'])(?:\/|[A-Za-z]:\\|src\/|tests\/|\.\/)/.test(line);
}

function isStackFrame(line: string): boolean {
  return /^\s+at\s+/.test(line) || /^\s*File\s+"/.test(line);
}

function collapseRepeatedLines(text: string): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  const out: string[] = [];
  let truncated = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run += 1;
    if (run > MAX_COLLAPSED_RUN && !looksLikePath(line)) {
      out.push(line);
      out.push(`… (${run - 1} identical lines omitted)`);
      truncated = true;
      i += run;
      continue;
    }
    out.push(line);
    i += 1;
  }
  return { text: out.join("\n"), truncated };
}

function trimStackTraces(text: string): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  const out: string[] = [];
  let truncated = false;
  let i = 0;
  while (i < lines.length) {
    if (!isStackFrame(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const start = i;
    while (i < lines.length && isStackFrame(lines[i])) i += 1;
    const block = lines.slice(start, i);
    if (block.length <= STACK_KEEP_HEAD + STACK_KEEP_TAIL) {
      out.push(...block);
      continue;
    }
    out.push(...block.slice(0, STACK_KEEP_HEAD));
    out.push(`… (${block.length - STACK_KEEP_HEAD - STACK_KEEP_TAIL} stack frames omitted)`);
    out.push(...block.slice(-STACK_KEEP_TAIL));
    truncated = true;
  }
  return { text: out.join("\n"), truncated };
}

function keepStderrTail(text: string): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= STDERR_TAIL_LINES) return { text, truncated: false };
  return {
    text: [
      `… (${lines.length - STDERR_TAIL_LINES} earlier stderr lines omitted)`,
      ...lines.slice(-STDERR_TAIL_LINES),
    ].join("\n"),
    truncated: true,
  };
}

function compressTerminalStream(text: string, kind: "stdout" | "stderr"): {
  text: string;
  truncated: boolean;
} {
  let truncated = false;
  let next = collapseRepeatedLines(text);
  truncated ||= next.truncated;
  next = trimStackTraces(next.text);
  truncated ||= next.truncated;
  if (kind === "stderr") {
    next = keepStderrTail(next.text);
    truncated ||= next.truncated;
  }
  return next;
}

function isProcessOutput(
  value: unknown,
): value is { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "stdout" in value &&
    "stderr" in value &&
    "exitCode" in value &&
    "timedOut" in value
  );
}

export function isContextCompressionEnabled(
  readEnv: (name: string) => string | undefined = (name) => process.env[name],
): boolean {
  return readEnv("JARVIS_CONTEXT_COMPRESSION") !== "0";
}

/**
 * Compress tool output for the model message. Never mutates the value intended for core-store.
 */
export function compressToolOutput(
  toolId: string,
  raw: JsonValue,
  options: {
    enabled?: boolean;
    thresholdBytes?: number;
  } = {},
): CompressionResult {
  const originalBytes = byteLength(JSON.stringify(raw));
  const enabled = options.enabled ?? isContextCompressionEnabled();
  if (!enabled) {
    return {
      output: raw,
      meta: {
        engine: "none",
        originalBytes,
        sentBytes: originalBytes,
        ratio: 1,
        truncated: false,
        optedOut: true,
      },
    };
  }

  if (!TERMINAL_TOOLS.has(toolId) || !isProcessOutput(raw)) {
    return {
      output: raw,
      meta: {
        engine: "none",
        originalBytes,
        sentBytes: originalBytes,
        ratio: 1,
        truncated: false,
        optedOut: false,
      },
    };
  }

  const streamBytes = byteLength(raw.stdout) + byteLength(raw.stderr);
  const threshold = options.thresholdBytes ?? DEFAULT_THRESHOLD;
  if (streamBytes <= threshold) {
    return {
      output: raw,
      meta: {
        engine: "none",
        originalBytes,
        sentBytes: originalBytes,
        ratio: 1,
        truncated: false,
        optedOut: false,
      },
    };
  }

  const stdout = compressTerminalStream(raw.stdout, "stdout");
  const stderr = compressTerminalStream(raw.stderr, "stderr");
  const output: JsonValue = {
    exitCode: raw.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    timedOut: raw.timedOut,
  };
  const sentBytes = byteLength(JSON.stringify(output));
  return {
    output,
    meta: {
      engine: "rtk-lite",
      originalBytes,
      sentBytes,
      ratio: originalBytes === 0 ? 1 : sentBytes / originalBytes,
      truncated: stdout.truncated || stderr.truncated,
      optedOut: false,
    },
  };
}
