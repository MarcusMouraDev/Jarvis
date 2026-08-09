import type { AgentState } from "@/core/types";

export interface PresenceUniforms {
  colorA: string;
  colorB: string;
  turbulence: number;
  coherence: number;
  pulse: number;
  /** When true, colors freeze (previous hue) — used by failure. */
  freezeColor: boolean;
  /** Globe rotation speed. */
  rotation: number;
  /** Fraction of nodes lighting up. */
  activation: number;
  /** Synapse brightness multiplier. */
  linkIntensity: number;
  /** Speed of traveling pulses along edges. */
  pulseTravel: number;
}

export interface PresenceVisual {
  colorA: string;
  colorB: string;
  saturation: number;
  coherence: number;
  activation: number;
}

export const PRESENCE_BY_STATE: Record<AgentState, PresenceUniforms> = {
  idle: {
    // steel HUD — cool, low chroma (not neon blue)
    colorA: "#5a7d9a",
    colorB: "#1a2a3c",
    turbulence: 0.1,
    coherence: 1,
    pulse: 0.18,
    freezeColor: false,
    rotation: 0.12,
    activation: 0.62,
    linkIntensity: 0.85,
    pulseTravel: 0.4,
  },
  listening: {
    colorA: "#3d7ab0",
    colorB: "#143a5c",
    turbulence: 0.28,
    coherence: 1,
    pulse: 0.36,
    freezeColor: false,
    rotation: 0.2,
    activation: 0.84,
    linkIntensity: 1.02,
    pulseTravel: 0.7,
  },
  thinking: {
    // gold/amber neural fire — matches dense “thinking” orb reference
    colorA: "#ffc078",
    colorB: "#ff6a1a",
    turbulence: 0.85,
    coherence: 0.94,
    pulse: 0.72,
    freezeColor: false,
    rotation: 0.42,
    activation: 1,
    linkIntensity: 1.45,
    pulseTravel: 1.9,
  },
  speaking: {
    colorA: "#3cbdb0",
    colorB: "#0e6e68",
    turbulence: 0.4,
    coherence: 1,
    pulse: 0.46,
    freezeColor: false,
    rotation: 0.26,
    activation: 0.9,
    linkIntensity: 1.08,
    pulseTravel: 1.0,
  },
  asking: {
    colorA: "#d94a58",
    colorB: "#8a1828",
    turbulence: 0.18,
    coherence: 0.85,
    pulse: 0.68,
    freezeColor: false,
    rotation: 0.05,
    activation: 1,
    linkIntensity: 0.72,
    pulseTravel: 0.22,
  },
  failure: {
    // Catalog values unused as live hue — resolvePresenceVisual keeps previous.
    colorA: "#8a9199",
    colorB: "#3a3f45",
    turbulence: 0.9,
    coherence: 0.25,
    pulse: 0.1,
    freezeColor: true,
    rotation: 0.02,
    activation: 0.2,
    linkIntensity: 0.22,
    pulseTravel: 0.05,
  },
};

export const IDLE_PRESENCE_VISUAL: PresenceVisual = {
  colorA: PRESENCE_BY_STATE.idle.colorA,
  colorB: PRESENCE_BY_STATE.idle.colorB,
  saturation: 1,
  coherence: PRESENCE_BY_STATE.idle.coherence,
  activation: PRESENCE_BY_STATE.idle.activation,
};

/**
 * Resolve display colors for a state transition.
 * failure: keep previous hue, reduce saturation/activation — never invent a gray glow.
 */
export function resolvePresenceVisual(
  state: AgentState,
  previous: PresenceVisual,
): PresenceVisual {
  if (state === "failure") {
    return {
      colorA: previous.colorA,
      colorB: previous.colorB,
      saturation: Math.min(previous.saturation, 0.35),
      coherence: PRESENCE_BY_STATE.failure.coherence,
      activation: PRESENCE_BY_STATE.failure.activation,
    };
  }
  const next = PRESENCE_BY_STATE[state];
  return {
    colorA: next.colorA,
    colorB: next.colorB,
    saturation: 1,
    coherence: next.coherence,
    activation: next.activation,
  };
}

/** ~600ms transition at 60fps with this rate. */
export const STATE_BLEND_RATE = 1 / 0.6;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
