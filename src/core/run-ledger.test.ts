import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  addStep,
  clearLedger,
  decideApproval,
  finishRun,
  getApproval,
  getRun,
  listRuns,
  requestApproval,
  startRun,
} from "@/core/run-ledger";

const ledgerDir = path.join(process.cwd(), ".jarvis");
const ledgerFile = path.join(ledgerDir, "runs.jsonl");

function backupLedger() {
  if (existsSync(ledgerFile)) {
    return readLedgerContent();
  }
  return null;
}

function readLedgerContent() {
  return readFileSync(ledgerFile, "utf8");
}

function restoreLedger(content: string | null) {
  if (content === null) {
    if (existsSync(ledgerFile)) rmSync(ledgerFile);
    return;
  }
  mkdirSync(ledgerDir, { recursive: true });
  writeFileSync(ledgerFile, content, "utf8");
}

describe("run-ledger", () => {
  let savedLedger: string | null;

  beforeEach(() => {
    savedLedger = backupLedger();
    clearLedger();
    if (existsSync(ledgerFile)) rmSync(ledgerFile);
    if (existsSync(`${ledgerFile}.1`)) rmSync(`${ledgerFile}.1`);
  });

  afterEach(() => {
    clearLedger();
    restoreLedger(savedLedger);
  });

  it("ciclo de vida do run com steps", () => {
    const run = startRun({ kind: "chat", alias: "gemini", summary: "oi" });
    addStep(run.id, "route", "gemini→gemini");
    addStep(run.id, "chunk", "streaming");
    const finished = finishRun(run.id, "ok", {
      costUsd: 0.001,
      latencyMs: 120,
    });
    expect(finished?.status).toBe("ok");
    expect(finished?.costUsd).toBe(0.001);
    const detail = getRun(run.id);
    expect(detail?.steps).toHaveLength(2);
    expect(detail?.steps[0].seq).toBe(1);
    expect(listRuns()[0].id).toBe(run.id);
  });

  it("registra aprovação e decisão", () => {
    const run = startRun({ kind: "shell", summary: "rm -rf /" });
    const approval = requestApproval({
      runId: run.id,
      action: "rm -rf /tmp/x",
      scope: "shell.run",
      reasons: ["escrita"],
    });
    expect(getApproval(approval.id)?.decision).toBe("pending");
    decideApproval(approval.id, "denied");
    expect(getApproval(approval.id)?.decision).toBe("denied");
    expect(getRun(run.id)?.approvals).toHaveLength(1);
  });

  it("redige segredos no summary", () => {
    const run = startRun({
      kind: "shell",
      summary: "export API_KEY=supersecret",
    });
    expect(run.summary).toContain("[REDACTADO]");
    expect(run.summary).not.toContain("supersecret");
  });

  it("filtra runs por kind, status e texto", () => {
    const chat = startRun({ kind: "chat", summary: "pergunta sobre jarvis" });
    finishRun(chat.id, "ok");
    const shell = startRun({ kind: "shell", summary: "ls -la" });
    finishRun(shell.id, "error", { summary: "falhou" });

    expect(listRuns({ kind: "chat" })).toHaveLength(1);
    expect(listRuns({ status: "error" })[0].id).toBe(shell.id);
    expect(listRuns({ q: "jarvis" })[0].id).toBe(chat.id);
    expect(listRuns({ limit: 1 })).toHaveLength(1);
  });

  it("hidrata do disco quando memória está vazia", () => {
    const run = startRun({ kind: "voice", summary: "teste disco" });
    addStep(run.id, "tts", "minimax");
    finishRun(run.id, "ok");
    const runId = run.id;

    clearLedger();
    const hydrated = listRuns({ q: "teste disco" });
    expect(hydrated.some((r) => r.id === runId)).toBe(true);
    expect(getRun(runId)?.steps).toHaveLength(1);
  });

  it("rotaciona arquivo acima de 5MB", () => {
    mkdirSync(ledgerDir, { recursive: true });
    const padding = "x".repeat(5 * 1024 * 1024);
    writeFileSync(ledgerFile, `${padding}\n`, "utf8");

    startRun({ kind: "chat", summary: "novo run" });

    expect(existsSync(`${ledgerFile}.1`)).toBe(true);
    expect(statSync(ledgerFile).size).toBeLessThan(1024);
  });
});
