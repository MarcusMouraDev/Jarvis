import { describe, expect, it } from "vitest";
import {
  degradeTier,
  getEffectsProfile,
  resolveEffectsTier,
} from "./effects-profile";

const base = {
  width: 1440,
  dpr: 2,
  reducedMotion: false,
  webglAvailable: true,
  cores: 8,
};

describe("resolveEffectsTier", () => {
  it("desliga sem WebGL", () => {
    expect(resolveEffectsTier({ ...base, webglAvailable: false })).toBe("off");
  });

  it("desliga com reduced motion", () => {
    expect(resolveEffectsTier({ ...base, reducedMotion: true })).toBe("off");
  });

  it("desliga em telas estreitas para poupar bateria", () => {
    expect(resolveEffectsTier({ ...base, width: 480 })).toBe("off");
  });

  it("usa full em desktop com DPR baixo e cores suficientes", () => {
    expect(resolveEffectsTier(base)).toBe("full");
  });

  it("cai para light com DPR alto ou poucos cores", () => {
    expect(resolveEffectsTier({ ...base, dpr: 3 })).toBe("light");
    expect(resolveEffectsTier({ ...base, cores: 4 })).toBe("light");
  });
});

describe("getEffectsProfile", () => {
  it("zera todos os efeitos no tier off", () => {
    const p = getEffectsProfile("off");
    expect(p.bloomStrength).toBe(0);
    expect(p.grain).toBe(0);
    expect(p.aberration).toBe(0);
    expect(p.scanline).toBe(0);
  });

  it("mantem full mais forte que light em bloom e grain", () => {
    const light = getEffectsProfile("light");
    const full = getEffectsProfile("full");
    expect(full.bloomStrength).toBeGreaterThan(light.bloomStrength);
    expect(full.grain).toBeGreaterThan(light.grain);
  });

  it("comeca com valores discretos para nao virar ruido", () => {
    const full = getEffectsProfile("full");
    expect(full.aberration).toBeLessThanOrEqual(0.006);
    expect(full.grain).toBeLessThanOrEqual(0.05);
    expect(full.scanline).toBeLessThanOrEqual(0.03);
  });
});

describe("degradeTier", () => {
  it("desce um nivel por vez e para em off", () => {
    expect(degradeTier("full")).toBe("light");
    expect(degradeTier("light")).toBe("off");
    expect(degradeTier("off")).toBe("off");
  });
});
