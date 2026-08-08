import type { AgentState } from "@/core/types";

export interface PresenceUniforms {
  colorA: string;
  colorB: string;
  turbulence: number;
  coherence: number;
  pulse: number;
  /** When true, colors freeze (previous hue) — used by failure. */
  freezeColor: boolean;
}

export const PRESENCE_BY_STATE: Record<AgentState, PresenceUniforms> = {
  idle: {
    colorA: "#5b6b7a",
    colorB: "#2a3540",
    turbulence: 0.12,
    coherence: 1,
    pulse: 0.08,
    freezeColor: false,
  },
  listening: {
    colorA: "#3d8bfd",
    colorB: "#1a4f9c",
    turbulence: 0.35,
    coherence: 1,
    pulse: 0.25,
    freezeColor: false,
  },
  thinking: {
    colorA: "#ff8c42",
    colorB: "#c45a12",
    turbulence: 0.65,
    coherence: 0.95,
    pulse: 0.4,
    freezeColor: false,
  },
  speaking: {
    colorA: "#3ee8d6",
    colorB: "#0e8f86",
    turbulence: 0.45,
    coherence: 1,
    pulse: 0.35,
    freezeColor: false,
  },
  asking: {
    colorA: "#ff4d5a",
    colorB: "#9c1c28",
    turbulence: 0.2,
    coherence: 0.85,
    pulse: 0.55,
    freezeColor: false,
  },
  failure: {
    // Colors unused when freezeColor — failure dessaturates previous hue.
    colorA: "#8a9199",
    colorB: "#3a3f45",
    turbulence: 0.9,
    coherence: 0.25,
    pulse: 0.1,
    freezeColor: true,
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
