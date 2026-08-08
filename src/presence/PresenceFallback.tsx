import type { AgentState } from "@/core/types";
import { PRESENCE_BY_STATE } from "@/state/presence-config";

interface PresenceFallbackProps {
  state: AgentState;
  animate?: boolean;
}

export function PresenceFallback({
  state,
  animate = false,
}: PresenceFallbackProps) {
  const cfg = PRESENCE_BY_STATE[state];
  // Failure freezes previous hue in WebGL; CSS fallback approximates with desat.
  const colorA = state === "failure" ? "#7a8088" : cfg.colorA;
  const colorB = state === "failure" ? "#3a3f45" : cfg.colorB;

  return (
    <div
      className={`h-full w-full rounded-full ${animate ? "presence-fallback" : ""}`}
      style={{
        background: `radial-gradient(circle at 40% 35%, ${colorA}, ${colorB} 70%)`,
        filter: state === "failure" ? "saturate(0.35) contrast(1.1)" : undefined,
      }}
      aria-hidden
    />
  );
}
