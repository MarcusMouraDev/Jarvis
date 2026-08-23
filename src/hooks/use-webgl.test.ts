import { describe, expect, it, beforeEach } from "vitest";
import {
  detectWebGLOnce,
  resetWebGLDetectionCache,
} from "@/hooks/use-webgl";

describe("detectWebGLOnce", () => {
  beforeEach(() => {
    resetWebGLDetectionCache();
  });

  it("retorna false sem document (ambiente de teste)", () => {
    expect(detectWebGLOnce()).toBe(false);
  });

  it("reusa cache quando force não é passado", () => {
    const a = detectWebGLOnce();
    const b = detectWebGLOnce();
    expect(a).toBe(b);
  });
});
