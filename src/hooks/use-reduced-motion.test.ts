import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("reduced-motion contract", () => {
  it("PresenceField uses CSS fallback when reducedMotion is true", () => {
    const src = readFileSync(
      resolve(__dirname, "../presence/PresenceField.tsx"),
      "utf8",
    );
    expect(src).toContain("if (reducedMotion)");
    expect(src).toContain("PresenceFallback");
  });

  it("useReducedMotion server snapshot defaults to reduced", () => {
    const src = readFileSync(
      resolve(__dirname, "./use-reduced-motion.ts"),
      "utf8",
    );
    expect(src).toContain("getReducedMotionServerSnapshot");
    expect(src).toMatch(/function getReducedMotionServerSnapshot\(\) \{\s*return true;/);
  });
});
