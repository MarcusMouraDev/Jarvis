import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeCoreStore, openCoreStore, type CoreStore } from "./core-store";
import {
  requireProtectedRequest,
  validateLoopbackRequest,
} from "./session-security";

const originalDataDir = process.env.JARVIS_DATA_DIR;
const originalSafeCore = process.env.JARVIS_SAFE_AGENT_CORE;

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/protected", {
    method: "POST",
    headers: { host: "localhost", ...headers },
  });
}

const unauthorizedHeaders: Record<string, string>[] = [
  { cookie: "jarvis_session=opaque-session" },
  { cookie: "jarvis_session=opaque-session", "x-jarvis-csrf": "wrong" },
  { "x-jarvis-csrf": "valid-csrf" },
  { cookie: "jarvis_session=missing", "x-jarvis-csrf": "valid-csrf" },
];

describe("loopback request trust boundary", () => {
  it.each([
    ["localhost", undefined],
    ["localhost:3000", "http://localhost:3000"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["[::1]:3000", "http://[::1]:3000"],
  ])("accepts loopback host %s", (host, origin) => {
    expect(
      validateLoopbackRequest(
        request({ host, ...(origin ? { origin } : {}) }),
      ),
    ).toBe(true);
  });

  it.each([
    ["localhost.evil", undefined],
    ["127.0.0.1.evil", undefined],
    ["example.com", "http://example.com"],
    ["localhost:3000", "http://localhost:3001"],
    ["localhost:3000", "not an origin"],
    ["localhost:3000", "null"],
  ])("rejects host/origin %s %s", (host, origin) => {
    expect(
      validateLoopbackRequest(
        request({ host, ...(origin ? { origin } : {}) }),
      ),
    ).toBe(false);
  });
});

describe("protected request helper", () => {
  let dataDir: string;
  let store: CoreStore;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-session-security-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    store = openCoreStore();
    store.createSafeSession({
      sessionId: "opaque-session",
      csrfHash: createHash("sha256").update("valid-csrf").digest("hex"),
      defaultAgentId: "Hermes",
      expiresAt: "2026-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
    });
  });

  afterEach(() => {
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
    if (originalSafeCore === undefined) delete process.env.JARVIS_SAFE_AGENT_CORE;
    else process.env.JARVIS_SAFE_AGENT_CORE = originalSafeCore;
  });

  it("authenticates session and updates last_seen only after success", () => {
    const result = requireProtectedRequest(
      request({
        cookie: "jarvis_session=opaque-session",
        "x-jarvis-csrf": "valid-csrf",
      }),
      { store, now: new Date("2026-08-08T11:00:00.000Z") },
    );

    expect(result.ok).toBe(true);
    expect(store.getSession("opaque-session")?.lastSeenAt).toBe(
      "2026-08-08T11:00:00.000Z",
    );
  });

  it.each(unauthorizedHeaders)(
    "returns the same unauthorized response for %s",
    (headers) => {
      const result = requireProtectedRequest(request(headers), {
        store,
        now: new Date("2026-08-08T11:00:00.000Z"),
      });

      expect(result).toMatchObject({ ok: false, response: { status: 401 } });
      expect(store.getSession("opaque-session")?.lastSeenAt).toBe(
        "2026-08-08T10:00:00.000Z",
      );
    },
  );

  it("rejects expired and replayed-after-expiry tokens identically", () => {
    const protectedRequest = request({
      cookie: "jarvis_session=opaque-session",
      "x-jarvis-csrf": "valid-csrf",
    });
    for (const now of [
      "2026-08-09T10:00:00.000Z",
      "2026-08-10T10:00:00.000Z",
    ]) {
      const result = requireProtectedRequest(protectedRequest, {
        store,
        now: new Date(now),
      });
      expect(result).toMatchObject({ ok: false, response: { status: 401 } });
    }
  });

  it("rejects cross-origin requests before authentication", () => {
    const result = requireProtectedRequest(
      request({
        origin: "http://localhost.evil",
        cookie: "jarvis_session=opaque-session",
        "x-jarvis-csrf": "valid-csrf",
      }),
      { store, now: new Date("2026-08-08T11:00:00.000Z") },
    );

    expect(result).toMatchObject({ ok: false, response: { status: 403 } });
  });
});
