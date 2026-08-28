import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeCoreStore, openCoreStore } from "@/core/core-store";
import { GET } from "./route";

describe("Tailscale device bootstrap", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-bootstrap-device-"));
    vi.stubEnv("JARVIS_DATA_DIR", dataDir);
    vi.stubEnv("JARVIS_SAFE_AGENT_CORE", "1");
    vi.stubEnv("JARVIS_TRUST_TAILSCALE_HEADERS", "1");
    vi.stubEnv("JARVIS_TAILSCALE_HOSTS", "jarvis.example-tailnet.ts.net");
    vi.stubEnv("JARVIS_TAILSCALE_LOGIN_ALLOWLIST", "marcus@example.com");
  });

  afterEach(() => {
    closeCoreStore();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function serveRequest(cookie?: string): Request {
    return new Request("http://localhost/api/session/bootstrap", {
      headers: {
        host: "jarvis.example-tailnet.ts.net",
        origin: "https://jarvis.example-tailnet.ts.net",
        "tailscale-user-login": "marcus@example.com",
        "tailscale-user-name": "Marcus",
        ...(cookie ? { cookie } : {}),
      },
    });
  }

  it("creates one persistent device and secure cookies across session rotation", async () => {
    const first = await GET(serveRequest());
    const firstBody = (await first.json()) as { deviceId: string };
    const cookies = first.headers.getSetCookie();
    const deviceCookie = cookies.find((value) => value.startsWith("jarvis_device="));

    expect(first.status).toBe(200);
    expect(firstBody.deviceId).toMatch(/^[a-f0-9-]{36}$/);
    expect(deviceCookie).toContain("HttpOnly");
    expect(deviceCookie).toContain("Secure");
    expect(cookies.find((value) => value.startsWith("jarvis_session="))).toContain("Secure");

    const second = await GET(
      serveRequest(deviceCookie?.split(";")[0]),
    );
    const secondBody = (await second.json()) as { deviceId: string };
    expect(secondBody.deviceId).toBe(firstBody.deviceId);
    expect(openCoreStore().listDevices("marcus@example.com")).toHaveLength(1);
  });
});
