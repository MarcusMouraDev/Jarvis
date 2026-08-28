import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PWA privacy contract", () => {
  it("never caches API or file content", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname.includes("/files/")');
    expect(worker).not.toMatch(/cache\.put\([^)]*api/i);
  });

  it("declares standalone install metadata", () => {
    const manifest = readFileSync("src/app/manifest.ts", "utf8");
    expect(manifest).toContain('display: "standalone"');
    expect(manifest).toContain('start_url: "/"');
  });
});
