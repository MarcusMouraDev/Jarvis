import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeCoreStore, openCoreStore, type CoreStore } from "@/core/core-store";
import { loadAgentCatalogFromDisk } from "@/core/agent-catalog";
import { SafeCoreService } from "@/core/safe-core-service";
import {
  resetSafeCoreRuntimeForTests,
  setSafeCoreRuntimeForTests,
} from "@/core/safe-core-runtime";

const fetchOmnirouteUsageReport = vi.fn();

vi.mock("@/integrations/omniroute-mcp/usage-report", () => ({
  fetchOmnirouteUsageReport: (...args: unknown[]) => fetchOmnirouteUsageReport(...args),
}));

const originalDataDir = process.env.JARVIS_DATA_DIR;
const originalSafeCore = process.env.JARVIS_SAFE_AGENT_CORE;
const csrfToken = "csrf-omni-usage";

describe("GET /api/omniroute/usage", () => {
  let dataDir: string;
  let store: CoreStore;

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-omni-usage-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    fetchOmnirouteUsageReport.mockReset();
    store = openCoreStore();
    store.createSafeSession({
      sessionId: "session-usage",
      csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
      defaultAgentId: "Hermes",
      expiresAt: "2099-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
    });
    const catalog = loadAgentCatalogFromDisk();
    const orchestrator = {
      execute: vi.fn(),
      cancel: vi.fn(),
      hasPendingContinuation: vi.fn(),
      resumePendingTool: vi.fn(),
      discardPendingContinuation: vi.fn(),
    };
    const gateway = { decideApproval: vi.fn() };
    const service = new SafeCoreService({
      store,
      catalog,
      orchestrator,
      toolGateway: gateway,
      listWorkspaceNames: () => [],
    });
    setSafeCoreRuntimeForTests({
      store,
      catalog,
      orchestrator,
      gateway,
      service,
    });
  });

  afterEach(() => {
    resetSafeCoreRuntimeForTests();
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
    if (originalSafeCore === undefined) delete process.env.JARVIS_SAFE_AGENT_CORE;
    else process.env.JARVIS_SAFE_AGENT_CORE = originalSafeCore;
  });

  function request(init: RequestInit = {}) {
    return new Request("http://localhost/api/omniroute/usage", {
      ...init,
      headers: {
        host: "localhost",
        origin: "http://localhost",
        cookie: "jarvis_session=session-usage",
        "X-Jarvis-CSRF": csrfToken,
        ...init.headers,
      },
    });
  }

  it("returns 401 without a session when safe core is on", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      request({ headers: { cookie: "", "X-Jarvis-CSRF": "" } }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 502 when the OmniRoute sidecar is down", async () => {
    fetchOmnirouteUsageReport.mockResolvedValue({
      omniUp: false,
      range: "7d",
      analyticsAuth: "unavailable",
      totals: null,
      providers: [],
      criticalPercentRemaining: null,
      compression: null,
      source: {},
    });
    const { GET } = await import("./route");
    const response = await GET(request());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ omniUp: false });
  });

  it("returns a sanitized usage report when OmniRoute is up", async () => {
    fetchOmnirouteUsageReport.mockResolvedValue({
      omniUp: true,
      range: "7d",
      analyticsAuth: "ok",
      totals: { requests: 4, tokensIn: 10, tokensOut: 2, costUsd: 0.1 },
      providers: [
        {
          name: "codex",
          provider: "codex",
          quotaUsed: 1,
          quotaTotal: 10,
          percentRemaining: 90,
          resetAt: null,
        },
      ],
      criticalPercentRemaining: 90,
      compression: { enabled: false },
      source: {
        quota: "omniroute:/api/usage/quota",
        analytics: "omniroute:/api/usage/analytics?range=7d",
        compression: "omniroute:/api/compression/status",
      },
    });
    const { GET } = await import("./route");
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      omniUp: true,
      totals: { requests: 4 },
      criticalPercentRemaining: 90,
    });
  });
});
