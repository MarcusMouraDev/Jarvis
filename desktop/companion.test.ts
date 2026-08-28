import { createRequire } from "node:module";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { insideGrant, JarvisCompanion } = require("./companion.cjs") as {
  insideGrant: (root: string, relativePath: string) => string;
  JarvisCompanion: new (input: Record<string, unknown>) => {
    execute: (job: { capability: string; payload: unknown }) => Promise<unknown>;
    start: () => void;
    stop: () => void;
    config: Record<string, unknown>;
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("desktop companion path boundary", () => {
  it("rejects a symlink selected below a granted root", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jarvis-desktop-grant-"));
    const outside = mkdtempSync(path.join(tmpdir(), "jarvis-desktop-outside-"));
    try {
      writeFileSync(path.join(outside, "secret"), "secret");
      symlinkSync(path.join(outside, "secret"), path.join(root, "link"));
      expect(() => insideGrant(root, "link")).toThrow("grant_symlink_rejected");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("shows the local Jarvis window for an approved desktop_ui job", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "jarvis-desktop-companion-"));
    let shown = 0;
    try {
      const companion = new JarvisCompanion({
        app: { getPath: () => root },
        safeStorage: { isEncryptionAvailable: () => false },
        dialog: {},
        notify: () => {},
        onAccess: () => {},
        showMain: () => { shown += 1; },
      });

      await expect(
        companion.execute({ capability: "desktop_ui", payload: { action: "show" } }),
      ).resolves.toEqual({ ok: true, action: "show" });
      expect(shown).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries a failed long poll with backoff instead of a fixed two-second interval", async () => {
    vi.useFakeTimers();
    const root = mkdtempSync(path.join(tmpdir(), "jarvis-desktop-poll-"));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const companion = new JarvisCompanion({
        app: { getPath: () => root },
        safeStorage: { isEncryptionAvailable: () => false },
        dialog: {},
        notify: () => {},
        onAccess: () => {},
        showMain: () => {},
      });
      companion.config = { baseUrl: "http://localhost", token: "token" };

      companion.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      companion.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
