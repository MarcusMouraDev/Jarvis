import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy loopback boundary", () => {
  it("uses a constant matcher that includes app and API paths", () => {
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
    ]);
  });

  it("continues exact loopback requests without CORS headers", () => {
    const response = proxy(
      new NextRequest("http://localhost/api/session/bootstrap", {
        headers: { host: "localhost" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it.each([
    ["localhost.evil", undefined],
    ["localhost", "http://localhost.evil"],
    ["localhost", "malformed"],
  ])("returns 403 for untrusted host/origin", (host, origin) => {
    const response = proxy(
      new NextRequest("http://localhost/api/session/bootstrap", {
        headers: { host, ...(origin ? { origin } : {}) },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("allows the private broker host only on the internal broker path", () => {
    vi.stubEnv("JARVIS_INTERNAL_HOSTS", "jarvis-worker:3001");

    const brokerResponse = proxy(
      new NextRequest(
        "http://jarvis-worker:3001/api/internal/hermes/v1/chat/completions",
        { headers: { host: "jarvis-worker:3001" } },
      ),
    );
    const webResponse = proxy(
      new NextRequest("http://jarvis-worker:3001/api/session/bootstrap", {
        headers: { host: "jarvis-worker:3001" },
      }),
    );

    expect(brokerResponse.status).toBe(200);
    expect(webResponse.status).toBe(403);
  });

  it("keeps worker-local broker health checks on loopback", () => {
    const response = proxy(
      new NextRequest(
        "http://127.0.0.1:3001/api/internal/hermes/v1/chat/completions",
        { headers: { host: "127.0.0.1:3001" } },
      ),
    );

    expect(response.status).toBe(200);
  });

  it("accepts only an allowlisted identity forwarded by Tailscale Serve", () => {
    vi.stubEnv("JARVIS_TRUST_TAILSCALE_HEADERS", "1");
    vi.stubEnv("JARVIS_TAILSCALE_HOSTS", "jarvis.example-tailnet.ts.net");
    vi.stubEnv("JARVIS_TAILSCALE_LOGIN_ALLOWLIST", "marcus@example.com");

    const allowed = proxy(
      new NextRequest("http://localhost/api/session/bootstrap", {
        headers: {
          host: "jarvis.example-tailnet.ts.net",
          origin: "https://jarvis.example-tailnet.ts.net",
          "tailscale-user-login": "marcus@example.com",
        },
      }),
    );
    const denied = proxy(
      new NextRequest("http://localhost/api/session/bootstrap", {
        headers: {
          host: "jarvis.example-tailnet.ts.net",
          origin: "https://jarvis.example-tailnet.ts.net",
          "tailscale-user-login": "mallory@example.com",
        },
      }),
    );

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
  });
});
