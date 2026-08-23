import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf8");
}

describe("safe UI contract", () => {
  it("wires the server flag switch between legacy and safe shells", () => {
    const pageSource = read("../app/page.tsx");
    expect(pageSource).toContain("isSafeAgentCoreEnabled()");
    expect(pageSource).toContain("<JarvisShell />");
    expect(pageSource).toContain("<SafeJarvisShell />");
  });

  it("keeps SafeJarvisShell free of legacy executors and exposes cancel", () => {
    const source = read("./SafeJarvisShell.tsx");
    expect(source).toContain("<SafeAgentSelector");
    expect(source).toContain("disabled={runIsActive}");
    expect(source).toContain("<SafeApprovalCard");
    expect(source).toContain("cancel");
    expect(source).toContain("modelAlias");
    expect(source).toContain("SAFE_MODEL_PICKER_ALIASES");
    expect(source).toContain("OmnirouteUsagePanel");
    expect(source).toContain("OmnirouteStatusChip");
    expect(source).not.toMatch(/from ["']@\/lib\/chat-client["']/);
    expect(source).not.toMatch(/from ["']@\/lib\/shell-client["']/);
    expect(source).not.toMatch(/from ["']\.\/JarvisShell["']/);
  });

  it("renders sanitized approval detail labels and expiry", () => {
    const source = read("./SafeApprovalCard.tsx");
    expect(source).toContain("expiresAt");
    expect(source).toContain("effect");
    expect(source).toContain("preview");
    expect(source).toMatch(/<details/);
  });

  it("disables agent switching while a run is active", () => {
    const source = read("./SafeAgentSelector.tsx");
    expect(source).toContain("disabled={runIsActive}");
    expect(source).toContain("Hermes");
  });

  it("liga o HUD a telemetria real e mata o level morto", () => {
    const shell = read("./SafeJarvisShell.tsx");
    expect(shell).toContain("buildTelemetry");
    expect(shell).toContain("useStreamLevel");
    expect(shell).not.toContain("useRef(0)");
  });

  it("mantem o HUD sem numero fixo, lendo so do snapshot", () => {
    const ring = read("./hud/TelemetryRing.tsx");
    expect(ring).toContain("snapshot.gauges");
    expect(ring).toContain("aria-hidden");

    const frame = read("./hud/HudFrame.tsx");
    expect(frame).toContain("snapshot.readouts");
    expect(frame).not.toMatch(/US\$\s*\d/);
  });
});
