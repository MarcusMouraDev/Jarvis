import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendMessage,
  clearHistory,
  searchMessages,
} from "@/core/history-store";

const originalDataDir = process.env.JARVIS_DATA_DIR;

describe("history-store", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-history-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    clearHistory();
  });

  afterEach(() => {
    clearHistory();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
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
