import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  appendMessage,
  clearHistory,
  searchMessages,
} from "@/core/history-store";

const historyDir = path.join(process.cwd(), ".jarvis");
const historyFile = path.join(historyDir, "history.jsonl");

function backupHistory() {
  if (existsSync(historyFile)) {
    return readFileSync(historyFile, "utf8");
  }
  return null;
}

function restoreHistory(content: string | null) {
  if (content === null) {
    if (existsSync(historyFile)) rmSync(historyFile);
    return;
  }
  writeFileSync(historyFile, content, "utf8");
}

describe("history-store", () => {
  let savedHistory: string | null;

  beforeEach(() => {
    savedHistory = backupHistory();
    clearHistory();
    if (existsSync(historyFile)) rmSync(historyFile);
  });

  afterEach(() => {
    clearHistory();
    restoreHistory(savedHistory);
  });

  it("persiste e busca mensagens", () => {
    appendMessage({ role: "user", text: "olá jarvis" });
    appendMessage({ role: "assistant", text: "oi, como posso ajudar?" });

    expect(searchMessages({})).toHaveLength(2);
    expect(searchMessages({ q: "jarvis" })).toHaveLength(1);
  });

  it("redige segredos quando logContent é false", () => {
    const msg = appendMessage({
      role: "user",
      text: "minha API_KEY=abc123",
    });
    expect(msg.text).toContain("[REDACTADO]");
    expect(msg.text).not.toContain("abc123");
  });
});
