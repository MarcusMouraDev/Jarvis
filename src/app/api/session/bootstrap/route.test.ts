import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeCoreStore, openCoreStore } from "@/core/core-store";
import { GET } from "./route";

const originalDataDir = process.env.JARVIS_DATA_DIR;
const originalSafeCore = process.env.JARVIS_SAFE_AGENT_CORE;

describe("GET /api/session/bootstrap", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-bootstrap-"));
    process.env.JARVIS_DATA_DIR = dataDir;
  });

  afterEach(() => {
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
    if (originalSafeCore === undefined) delete process.env.JARVIS_SAFE_AGENT_CORE;
    else process.env.JARVIS_SAFE_AGENT_CORE = originalSafeCore;
  });

  it("returns 404 when the sole enable flag is not exactly 1", async () => {
    process.env.JARVIS_SAFE_AGENT_CORE = "true";
    const response = await GET(
      new Request("http://localhost/api/session/bootstrap", {
        headers: { host: "localhost" },
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "safe_core_disabled" });
  });

  it.each([
    ["http://localhost", false],
    ["https://localhost", true],
  ])("creates a 24-hour session and strict cookie for %s", async (origin, secure) => {
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    const before = Date.now();
    const response = await GET(
      new Request(`${origin}/api/session/bootstrap`, {
        headers: { host: "localhost", origin },
      }),
    );
    const after = Date.now();
    const body = (await response.json()) as {
      csrfToken: string;
      defaultAgentId: string;
      expiresAt: string;
    };

    expect(response.status).toBe(200);
    expect(Buffer.from(body.csrfToken, "base64url")).toHaveLength(32);
    expect(body.defaultAgentId).toBe("Hermes");
    expect(Date.parse(body.expiresAt)).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(Date.parse(body.expiresAt)).toBeLessThanOrEqual(after + 86_400_000);

    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("jarvis_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=86400");
    expect(cookie.includes("Secure")).toBe(secure);

    const sessionId = /jarvis_session=([^;]+)/.exec(cookie)![1];
    expect(Buffer.from(sessionId, "base64url")).toHaveLength(32);
    const session = openCoreStore().getSession(sessionId);
    expect(session).toMatchObject({
      csrfHash: createHash("sha256").update(body.csrfToken).digest("hex"),
      defaultAgentId: "Hermes",
      expiresAt: body.expiresAt,
    });
    expect(JSON.stringify(session)).not.toContain(body.csrfToken);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("repeats loopback checks at the route boundary", async () => {
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    const response = await GET(
      new Request("http://localhost/api/session/bootstrap", {
        headers: { host: "localhost.evil" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
