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

export const PRESENCE_BY_STATE: Record<AgentState, PresenceUniforms> = {
  idle: {
    colorA: "#6f93c0",
    colorB: "#243a58",
    turbulence: 0.12,
    coherence: 1,
    pulse: 0.22,
    freezeColor: false,
    rotation: 0.14,
    activation: 0.55,
    linkIntensity: 0.78,
    pulseTravel: 0.45,
  },
  listening: {
    colorA: "#4a9dff",
    colorB: "#1558b8",
    turbulence: 0.35,
    coherence: 1,
    pulse: 0.4,
    freezeColor: false,
    rotation: 0.22,
    activation: 0.82,
    linkIntensity: 0.98,
    pulseTravel: 0.75,
  },
  thinking: {
    colorA: "#ffb06a",
    colorB: "#c84a08",
    turbulence: 0.72,
    coherence: 0.92,
    pulse: 0.62,
    freezeColor: false,
    rotation: 0.48,
    activation: 1,
    linkIntensity: 1.25,
    pulseTravel: 1.65,
  },
  speaking: {
    colorA: "#4af0de",
    colorB: "#12a89c",
    turbulence: 0.45,
    coherence: 1,
    pulse: 0.48,
    freezeColor: false,
    rotation: 0.28,
    activation: 0.88,
    linkIntensity: 1.05,
    pulseTravel: 1.0,
  },
  asking: {
    colorA: "#ff5a68",
    colorB: "#c02030",
    turbulence: 0.2,
    coherence: 0.85,
    pulse: 0.7,
    freezeColor: false,
    rotation: 0.06,
    activation: 1,
    linkIntensity: 0.7,
    pulseTravel: 0.25,
  },
  failure: {
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
