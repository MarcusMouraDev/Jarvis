import type { CSSProperties } from "react";
import type { AgentState } from "@/core/types";
import { PRESENCE_BY_STATE } from "@/state/presence-config";

interface PresenceFallbackProps {
  state: AgentState;
  animate?: boolean;
}

/** Static CSS neural globe — no animation loop when reduced motion / no WebGL. */
export function PresenceFallback({
  state,
  animate = false,
}: PresenceFallbackProps) {
  const cfg = PRESENCE_BY_STATE[state];
  const colorA = state === "failure" ? "#7a8088" : cfg.colorA;
  const colorB = state === "failure" ? "#3a3f45" : cfg.colorB;
  const desat = state === "failure";

  const style = {
    "--neural-a": colorA,
    "--neural-b": colorB,
    filter: desat ? "saturate(0.35) contrast(1.08)" : undefined,
  } as CSSProperties;

  return (
    <div
      className={`neural-fallback relative h-full w-full ${animate ? "neural-fallback--breathe" : ""}`}
      style={style}
      aria-hidden
    >
      <div className="neural-fallback__sphere" />
      <div className="neural-fallback__nodes" />
      <div className="neural-fallback__ring" />
    </div>
  );
}
