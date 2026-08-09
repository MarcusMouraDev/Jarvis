"use client";

import { useRef } from "react";
import type { CSSProperties } from "react";
import type { AgentState } from "@/core/types";
import {
  IDLE_PRESENCE_VISUAL,
  resolvePresenceVisual,
  type PresenceVisual,
} from "@/state/presence-config";

interface PresenceFallbackProps {
  state: AgentState;
  animate?: boolean;
  previousVisual?: PresenceVisual;
}

const NODE_POSITIONS = [
  [18, 32],
  [72, 28],
  [48, 18],
  [30, 68],
  [68, 62],
  [52, 78],
  [22, 48],
  [80, 48],
  [40, 42],
  [60, 50],
  [12, 55],
  [88, 38],
  [35, 22],
  [65, 20],
  [45, 58],
  [55, 35],
  [25, 38],
  [75, 55],
  [42, 72],
  [58, 68],
  [15, 42],
  [85, 62],
  [38, 48],
  [62, 42],
] as const;

const LINK_LINES = [
  [18, 32, 48, 18],
  [48, 18, 72, 28],
  [30, 68, 52, 78],
  [52, 78, 68, 62],
  [22, 48, 40, 42],
  [60, 50, 80, 48],
] as const;

/** Static CSS neural globe — no animation loop when reduced motion / no WebGL. */
export function PresenceFallback({
  state,
  animate = false,
  previousVisual,
}: PresenceFallbackProps) {
  const lastRef = useRef<PresenceVisual>(previousVisual ?? IDLE_PRESENCE_VISUAL);
  const visual = resolvePresenceVisual(state, lastRef.current);
  if (state !== "failure") {
    lastRef.current = visual;
  } else {
    lastRef.current = visual;
  }

  const style = {
    "--neural-a": visual.colorA,
    "--neural-b": visual.colorB,
    filter:
      visual.saturation < 0.99
        ? `saturate(${visual.saturation}) contrast(1.08)`
        : undefined,
  } as CSSProperties;

  return (
    <div
      className={`neural-fallback relative h-full w-full ${animate ? "neural-fallback--breathe" : ""}`}
      style={style}
      aria-hidden
    >
      <div className="neural-fallback__sphere" />
      <div className="neural-fallback__nodes">
        {NODE_POSITIONS.map(([x, y], i) => (
          <span
            key={i}
            className="neural-fallback__node"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        ))}
        <svg
          className="neural-fallback__links"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {LINK_LINES.map(([x1, y1, x2, y2], i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--neural-a)"
              strokeOpacity="0.35"
              strokeWidth="0.4"
            />
          ))}
        </svg>
      </div>
      <div className="neural-fallback__ring" />
      <div className="neural-fallback__ring neural-fallback__ring--outer" />
    </div>
  );
}
