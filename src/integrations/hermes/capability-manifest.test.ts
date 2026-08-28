import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertHermesCapabilitiesMapped,
  HERMES_CAPABILITY_MANIFEST,
  HERMES_PINNED_CAPABILITIES,
} from "./capability-manifest";

describe("Hermes capability manifest", () => {
  it("matches the versioned pinned Hermes surface snapshot", () => {
    const snapshot = JSON.parse(
      readFileSync("config/hermes/capabilities.json", "utf8"),
    ) as { revision: string; capabilities: string[] };
    expect(snapshot.revision).toBe(HERMES_CAPABILITY_MANIFEST.revision);
    expect(snapshot.capabilities).toEqual([...HERMES_PINNED_CAPABILITIES]);
    expect(() => assertHermesCapabilitiesMapped(snapshot.capabilities)).not.toThrow();
  });

  it("maps every pinned capability to a Jarvis-owned surface", () => {
    expect(Object.keys(HERMES_CAPABILITY_MANIFEST.capabilities).sort()).toEqual(
      [...HERMES_PINNED_CAPABILITIES].sort(),
    );
    for (const binding of Object.values(HERMES_CAPABILITY_MANIFEST.capabilities)) {
      expect(["vps-native", "jarvis-ui", "companion-local"]).toContain(binding.owner);
      expect(existsSync(binding.surface), binding.surface).toBe(true);
    }
    expect(() => assertHermesCapabilitiesMapped(HERMES_PINNED_CAPABILITIES)).not.toThrow();
  });

  it("fails closed when Hermes adds an unmapped capability", () => {
    expect(() => assertHermesCapabilitiesMapped(["new_capability"])).toThrow(
      "hermes_capability_unmapped:new_capability",
    );
  });
});
