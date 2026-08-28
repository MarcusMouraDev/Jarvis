import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_JARVIS_SOUL_POLICY,
  compileJarvisSystemInstruction,
  createJarvisSoulPolicy,
  loadJarvisSoulPolicy,
  saveJarvisSoulPreferences,
} from "./jarvis-soul";

describe("Jarvis soul policy", () => {
  it("compiles a deterministic provider-neutral system instruction", () => {
    const policy = createJarvisSoulPolicy({ style: "compact", preferredAddress: "Marcus" });
    const first = compileJarvisSystemInstruction(policy);
    const second = compileJarvisSystemInstruction(policy);

    expect(first).toEqual(second);
    expect(first).toContain("português do Brasil");
    expect(first).toContain("Marcus");
    expect(first).toContain("Nunca alegue uma ação");
    expect(policy.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes digest when preferences change without mutating the default", () => {
    const compact = createJarvisSoulPolicy({ style: "compact" });
    const formal = createJarvisSoulPolicy({ style: "formal" });

    expect(compact.digest).not.toBe(formal.digest);
    expect(DEFAULT_JARVIS_SOUL_POLICY.preferences.style).toBe("neutral");
  });

  it("loads only supported preferences from environment", () => {
    process.env.JARVIS_RESPONSE_STYLE = "formal";
    process.env.JARVIS_PREFERRED_ADDRESS = "Operador";
    const policy = loadJarvisSoulPolicy();
    expect(policy.preferences).toEqual({ style: "formal", preferredAddress: "Operador" });
    delete process.env.JARVIS_RESPONSE_STYLE;
    delete process.env.JARVIS_PREFERRED_ADDRESS;
  });

  it("persists validated preferences in the canonical data directory", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jarvis-soul-"));
    process.env.JARVIS_DATA_DIR = directory;
    try {
      const saved = saveJarvisSoulPreferences({ style: "compact", preferredAddress: "Marcus" });
      expect(saved.preferences).toEqual({ style: "compact", preferredAddress: "Marcus" });
      expect(loadJarvisSoulPolicy().digest).toBe(saved.digest);
      expect(() =>
        saveJarvisSoulPreferences({ style: "casual" as "compact", preferredAddress: "x" }),
      ).toThrow("invalid_delivery_style");
    } finally {
      delete process.env.JARVIS_DATA_DIR;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
