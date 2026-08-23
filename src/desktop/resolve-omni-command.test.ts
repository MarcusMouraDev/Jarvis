import { describe, expect, it } from "vitest";
import {
  omniStartShellCommand,
  resolveJarvisCommand,
  resolveOmniCommand,
} from "./resolve-omni-command";

describe("resolveOmniCommand", () => {
  it("uses serve when a production bundle exists", () => {
    expect(
      resolveOmniCommand({
        hasServeBundle: true,
        hasProdBuild: false,
        omniDev: false,
      }),
    ).toBe("serve");
  });

  it("falls back to npm start when a Next production build exists", () => {
    expect(
      resolveOmniCommand({
        hasServeBundle: false,
        hasProdBuild: true,
        omniDev: false,
      }),
    ).toBe("start");
  });

  it("uses capped sidecar dev when OmniRoute is unbuilt", () => {
    expect(
      resolveOmniCommand({
        hasServeBundle: false,
        hasProdBuild: false,
        omniDev: false,
      }),
    ).toBe("sidecar-dev");
  });

  it("uses npm run dev only when JARVIS_OMNI_DEV is on", () => {
    expect(
      resolveOmniCommand({
        hasServeBundle: true,
        hasProdBuild: true,
        omniDev: true,
      }),
    ).toBe("dev");
    expect(
      resolveOmniCommand({
        hasServeBundle: false,
        hasProdBuild: false,
        omniDev: true,
      }),
    ).toBe("dev");
  });
});

describe("omniStartShellCommand", () => {
  it("pins heap and disables dashboard open/tray for serve", () => {
    expect(omniStartShellCommand("serve", 768)).toContain(
      "node bin/omniroute.mjs serve --no-open --no-tray --port 20128",
    );
    expect(omniStartShellCommand("serve", 768)).toContain(
      "OMNIROUTE_MEMORY_MB=768",
    );
    expect(omniStartShellCommand("serve", 768)).not.toContain("npm run dev");
  });

  it("never emits npm run dev for start", () => {
    expect(omniStartShellCommand("start")).toBe("PORT=20128 npm start");
  });

  it("caps heap for sidecar dev without npm run dev", () => {
    expect(omniStartShellCommand("sidecar-dev", 768)).toContain(
      "node --max-old-space-size=768 scripts/dev/run-next.mjs dev",
    );
    expect(omniStartShellCommand("sidecar-dev", 768)).not.toContain(
      "npm run dev",
    );
  });
});

describe("resolveJarvisCommand", () => {
  it("uses next start in Electron production when a build exists", () => {
    expect(
      resolveJarvisCommand({
        electron: true,
        nextDev: false,
        hasNextBuild: true,
      }),
    ).toBe("npm start");
  });

  it("uses next dev for browser j, desktop:dev, and Electron without a build", () => {
    expect(
      resolveJarvisCommand({
        electron: false,
        nextDev: false,
        hasNextBuild: false,
      }),
    ).toBe("npm run dev");
    expect(
      resolveJarvisCommand({
        electron: true,
        nextDev: true,
        hasNextBuild: true,
      }),
    ).toBe("npm run dev");
    expect(
      resolveJarvisCommand({
        electron: true,
        nextDev: false,
        hasNextBuild: false,
      }),
    ).toBe("npm run dev");
  });
});
