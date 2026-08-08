import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { jarvisConfig } from "./config";
import { redactSecrets } from "./policy";

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string;
  at: string;
  runId?: string;
}

const messages: HistoryMessage[] = [];
let hydrated = false;

const MAX_STORED_TEXT = 4000;

function historyDir(): string {
  return path.join(process.cwd(), ".jarvis");
}

function historyPath(): string {
  return path.join(historyDir(), "history.jsonl");
}

function prepareText(text: string): string {
  let out = text;
  out = out.replace(
    /\b(?:api[_-]?key|token|password|secret)\b\s*[=:]\s*\S+/gi,
    "[REDACTADO]",
  );
  if (jarvisConfig.policies.redactSecrets) {
    out = redactSecrets(out);
  }
  if (!jarvisConfig.policies.logContent) {
    if (out.length > 500) {
      out = `${out.slice(0, 500)}…[truncado]`;
    }
  } else if (out.length > MAX_STORED_TEXT) {
    out = `${out.slice(0, MAX_STORED_TEXT)}…[truncado]`;
  }
  return out;
}

function hydrateFromDisk() {
  if (hydrated) return;
  hydrated = true;
  if (messages.length > 0) return;

  try {
    const filePath = historyPath();
    if (!existsSync(filePath)) return;
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as {
          type: string;
          message?: HistoryMessage;
        };
        if (record.type === "message.append" && record.message) {
          messages.push(record.message);
        }
      } catch {
        // Skip malformed lines.
      }
    }
  } catch {
    // Disk hydration is best-effort.
  }
}

function persist(message: HistoryMessage) {
  try {
    mkdirSync(historyDir(), { recursive: true });
    const line = JSON.stringify({ type: "message.append", message });
    appendFileSync(historyPath(), `${line}\n`, "utf8");
  } catch {
    // Disk persistence is best-effort.
  }
}

export function appendMessage(input: {
  id?: string;
  role: HistoryMessage["role"];
  text: string;
  meta?: string;
  runId?: string;
}): HistoryMessage {
  hydrateFromDisk();
  const message: HistoryMessage = {
    id: input.id ?? crypto.randomUUID(),
    role: input.role,
    text: prepareText(input.text),
    meta: input.meta ? prepareText(input.meta) : undefined,
    at: new Date().toISOString(),
    runId: input.runId,
  };
  messages.push(message);
  persist(message);
  return message;
}

export function searchMessages(input: {
  q?: string;
  limit?: number;
}): HistoryMessage[] {
  hydrateFromDisk();
  const limit = input.limit ?? 50;
  const q = input.q?.toLowerCase().trim();

  let results = [...messages].sort((a, b) =>
    a.at < b.at ? 1 : -1,
  );

  if (q) {
    results = results.filter((m) => {
      const hay = [m.role, m.text, m.meta, m.runId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  return results.slice(0, limit);
}

/** Test helper — wipe in-memory state. */
export function clearHistory() {
  messages.length = 0;
  hydrated = false;
}
