import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearProfileCache } from "@/core/profiles";
import { clearSchedulerStore } from "./store";
import { createJob, executeScheduledJob } from "./engine";

const originalFlag = process.env.JARVIS_SCHEDULER;
const originalExecutor = process.env.JARVIS_TOOL_EXECUTOR;
const originalDataDir = process.env.JARVIS_DATA_DIR;

describe("scheduler", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-scheduler-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    clearSchedulerStore();
    clearProfileCache();
    process.env.JARVIS_SCHEDULER = "1";
    process.env.JARVIS_TOOL_EXECUTOR = "1";
    process.env.JARVIS_MCP_BRASIL = "1";
  });

  afterEach(() => {
    clearSchedulerStore();
    clearProfileCache();
    if (originalFlag === undefined) delete process.env.JARVIS_SCHEDULER;
    else process.env.JARVIS_SCHEDULER = originalFlag;
    if (originalExecutor === undefined) delete process.env.JARVIS_TOOL_EXECUTOR;
    else process.env.JARVIS_TOOL_EXECUTOR = originalExecutor;
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
    delete process.env.JARVIS_MCP_BRASIL;
  });

  it("cria job idempotente — segunda chamada retorna o mesmo", () => {
    const a = createJob({
      idempotencyKey: "daily-selic",
      toolId: "mcp_brasil.query",
      input: { tool: "bcb.selic", params: {} },
      profileId: "pesquisa",
    });
    const b = createJob({
      idempotencyKey: "daily-selic",
      toolId: "mcp_brasil.query",
      input: { tool: "bcb.selic", params: {} },
      profileId: "pesquisa",
    });
    expect(a.id).toBe(b.id);
  });

  it("nega criação quando scheduler desligado", () => {
    delete process.env.JARVIS_SCHEDULER;
    expect(() =>
      createJob({
        idempotencyKey: "x",
        toolId: "mcp_brasil.query",
        input: {},
        profileId: "pesquisa",
      }),
    ).toThrow("scheduler_disabled");
  });

  it("executa job de leitura e registra histórico", async () => {
    const job = createJob({
      idempotencyKey: "run-once",
      toolId: "mcp_brasil.query",
      input: { tool: "bcb.selic", params: {} },
      profileId: "pesquisa",
      runAt: new Date(0).toISOString(),
    });
    const updated = await executeScheduledJob(job.id);
    expect(updated?.history.length).toBe(1);
    expect(updated?.status).toBe("completed");
  });
});
