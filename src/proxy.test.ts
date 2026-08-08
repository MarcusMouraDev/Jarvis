import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

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
});
