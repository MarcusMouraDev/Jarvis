import { describe, expect, it } from "vitest";
import {
  getSafeToolManifest,
  listSafeToolManifests,
} from "./safe-tool-manifests";

describe("safe tool manifests", () => {
  it("defines M1 tools plus OmniRoute read tools with complete versioned policy metadata", () => {
    const manifests = listSafeToolManifests();

    expect(manifests.map((tool) => tool.id)).toEqual([
      "code.context",
      "terminal.read",
      "terminal.run",
      "file.patch",
      "project.create",
      "omniroute.list_models",
      "omniroute.check_quota",
      "omniroute.compression_status",
    ]);
    for (const tool of manifests) {
      expect(tool.version).toMatch(/^1\.\d+\.\d+$/);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.requiredScopes.length).toBeGreaterThan(0);
      expect(tool.timeoutMs).toBeGreaterThan(0);
      expect(tool.maxOutputBytes).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }
    expect(getSafeToolManifest("code.context")).toMatchObject({
      risk: "read",
      sideEffect: "none",
      idempotent: true,
      supportsPreview: false,
    });
    expect(getSafeToolManifest("file.patch")).toMatchObject({
      risk: "write",
      sideEffect: "local",
      supportsPreview: true,
    });
  });

  it("rejects prototype-inherited registry keys", () => {
    expect(getSafeToolManifest("constructor")).toBeNull();
    expect(getSafeToolManifest("toString")).toBeNull();
  });

  it("rejects raw terminal commands and malformed patch hashes at the schema boundary", () => {
    expect(() =>
      getSafeToolManifest("terminal.read")?.inputSchema.parse({ command: "pwd" }),
    ).toThrow();
    expect(() =>
      getSafeToolManifest("terminal.run")?.inputSchema.parse({
        program: "npm",
        args: "run test",
      }),
    ).toThrow();
    expect(() =>
      getSafeToolManifest("file.patch")?.inputSchema.parse({
        diff: "--- a/a\n+++ b/a\n",
        preimageHashes: { a: "not-a-sha" },
      }),
    ).toThrow();
  });
});
