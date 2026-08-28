export type EffectsTier = "off" | "light" | "full";

export interface EffectsProfile {
  tier: EffectsTier;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  /** Radial channel offset, in UV. */
  aberration: number;
  grain: number;
  vignette: number;
  scanline: number;
}

const PROFILES: Record<EffectsTier, Omit<EffectsProfile, "tier">> = {
  off: {
    bloomStrength: 0,
    bloomRadius: 0,
    bloomThreshold: 1,
    aberration: 0,
    grain: 0,
    vignette: 0,
    scanline: 0,
  },
  light: {
    bloomStrength: 0.12,
    bloomRadius: 0.38,
    bloomThreshold: 0.82,
    aberration: 0.0008,
    grain: 0.008,
    vignette: 0.08,
    scanline: 0,
  },
  full: {
    bloomStrength: 0.2,
    bloomRadius: 0.42,
    bloomThreshold: 0.78,
    aberration: 0.0014,
    grain: 0.012,
    vignette: 0.1,
    scanline: 0,
  },
};

export function resolveEffectsTier(input: {
  width: number;
  dpr: number;
  reducedMotion: boolean;
  webglAvailable: boolean;
  cores: number;
}): EffectsTier {
  if (!input.webglAvailable) return "off";
  if (input.reducedMotion) return "off";
  if (input.width < 640) return "off";
  if (input.width >= 1100 && input.dpr <= 2 && input.cores >= 8) return "full";
  return "light";
}

export function getEffectsProfile(tier: EffectsTier): EffectsProfile {
  return { tier, ...PROFILES[tier] };
}

export function degradeTier(tier: EffectsTier): EffectsTier {
  if (tier === "full") return "light";
  return "off";
}
