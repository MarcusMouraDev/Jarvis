import { describe, expect, it } from "vitest";
import { Vector2 } from "three";
import { getEffectsProfile } from "./effects-profile";
import { applyProfileToUniforms, cinematicShader } from "./post-processing";

function makeUniforms() {
  return {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0 },
    uGrain: { value: 0 },
    uVignette: { value: 0 },
    uScanline: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
  };
}

describe("cinematicShader", () => {
  it("declara os uniforms que o pass alimenta", () => {
    for (const key of [
      "tDiffuse",
      "uTime",
      "uAberration",
      "uGrain",
      "uVignette",
      "uScanline",
      "uResolution",
    ]) {
      expect(cinematicShader.uniforms).toHaveProperty(key);
    }
  });

  it("preserva alpha no fragment para o vignette CSS atras continuar valendo", () => {
    expect(cinematicShader.fragmentShader).toContain("gl_FragColor = color;");
    expect(cinematicShader.fragmentShader).not.toContain("color.a = 1.0");
  });
});

describe("applyProfileToUniforms", () => {
  it("copia os valores do profile", () => {
    const u = makeUniforms();
    applyProfileToUniforms(u, getEffectsProfile("full"));
    expect(u.uAberration.value).toBeGreaterThan(0);
    expect(u.uGrain.value).toBeGreaterThan(0);
    expect(u.uVignette.value).toBeGreaterThan(0);
  });

  it("zera tudo no tier off", () => {
    const u = makeUniforms();
    applyProfileToUniforms(u, getEffectsProfile("off"));
    expect(u.uAberration.value).toBe(0);
    expect(u.uGrain.value).toBe(0);
    expect(u.uVignette.value).toBe(0);
    expect(u.uScanline.value).toBe(0);
  });
});
