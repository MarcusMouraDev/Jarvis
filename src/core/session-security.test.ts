import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeCoreStore, openCoreStore, type CoreStore } from "./core-store";
import {
  requireProtectedRequest,
  validateInternalServiceRequest,
  validateLoopbackRequest,
  validateTailscaleServeRequest,
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

describe("internal service request trust boundary", () => {
  it("accepts only an explicitly configured Docker service host without an Origin", () => {
    expect(
      validateInternalServiceRequest(
        request({ host: "jarvis-worker:3001" }),
        "jarvis-worker:3001",
      ),
    ).toBe(true);
  });

  it.each([
    ["jarvis-worker:3001", "http://jarvis-worker:3001"],
    ["jarvis-worker:3000", undefined],
    ["jarvis-worker.evil:3001", undefined],
    ["jarvis-worker:3001/path", undefined],
  ])("rejects untrusted internal host/origin %s %s", (host, origin) => {
    expect(
      validateInternalServiceRequest(
        request({ host, ...(origin ? { origin } : {}) }),
        "jarvis-worker:3001",
      ),
    ).toBe(false);
  });
});

describe("Tailscale Serve trust boundary", () => {
  const options = {
    enabled: "1",
    hosts: "jarvis.example-tailnet.ts.net",
    logins: "marcus@example.com",
  };

  it("accepts an allowlisted Serve identity on the configured HTTPS host", () => {
    expect(
      validateTailscaleServeRequest(
        request({
          host: "jarvis.example-tailnet.ts.net",
          origin: "https://jarvis.example-tailnet.ts.net",
          "tailscale-user-login": "marcus@example.com",
        }),
        options,
      ),
    ).toBe(true);
  });

  it.each([
    [{ ...options, enabled: "0" }, "marcus@example.com", "https://jarvis.example-tailnet.ts.net"],
    [{ ...options, hosts: "other.example-tailnet.ts.net" }, "marcus@example.com", "https://jarvis.example-tailnet.ts.net"],
    [options, "mallory@example.com", "https://jarvis.example-tailnet.ts.net"],
    [options, "", "https://jarvis.example-tailnet.ts.net"],
    [options, "marcus@example.com", "http://jarvis.example-tailnet.ts.net"],
  ])("rejects disabled, spoofed, tagged or non-HTTPS Serve traffic", (config, login, origin) => {
    expect(
      validateTailscaleServeRequest(
        request({
          host: "jarvis.example-tailnet.ts.net",
          origin,
          ...(login ? { "tailscale-user-login": login } : {}),
        }),
        config,
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

  it("invalidates an existing session immediately when its device is revoked", () => {
    store.createDevice({
      deviceId: "device-1",
      identityLogin: "marcus@example.com",
      label: "iPhone",
      kind: "pwa",
      createdAt: "2026-08-08T10:00:00.000Z",
    });
    store.createSafeSession({
      sessionId: "device-session",
      csrfHash: createHash("sha256").update("device-csrf").digest("hex"),
      defaultAgentId: "Hermes",
      expiresAt: "2026-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
      deviceId: "device-1",
      identityLogin: "marcus@example.com",
    });
    const deviceRequest = request({
      cookie: "jarvis_session=device-session",
      "x-jarvis-csrf": "device-csrf",
    });

    expect(
      requireProtectedRequest(deviceRequest, {
        store,
        now: new Date("2026-08-08T11:00:00.000Z"),
      }).ok,
    ).toBe(true);
    store.revokeDevice("device-1", "2026-08-08T11:01:00.000Z");
    expect(
      requireProtectedRequest(deviceRequest, {
        store,
        now: new Date("2026-08-08T11:02:00.000Z"),
      }),
    ).toMatchObject({ ok: false, response: { status: 401 } });
  });
});
