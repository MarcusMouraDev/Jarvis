"use client";

import dynamic from "next/dynamic";
import type { AgentState } from "@/core/types";
import { PresenceFallback } from "./PresenceFallback";

const PresenceCanvas = dynamic(
  // Intentional lazy import: keep WebGL bundle out of non-WebGL clients.
  () => import("./PresenceCanvas").then((m) => m.PresenceCanvas),
  { ssr: false, loading: () => <PresenceFallback state="idle" animate /> },
);

interface PresenceFieldProps {
  state: AgentState;
  levelRef: React.RefObject<number>;
  reducedMotion: boolean;
  paused: boolean;
  webglAvailable: boolean;
}

export function PresenceField({
  state,
  levelRef,
  reducedMotion,
  paused,
  webglAvailable,
}: PresenceFieldProps) {
  // CSS only when WebGL is unavailable. Reduced motion still uses the neural
  // mesh — shaders freeze rotation/pulses while color/structure remain.
  if (!webglAvailable) {
    return <PresenceFallback state={state} animate={false} />;
  }

  return (
    <PresenceCanvas
      state={state}
      levelRef={levelRef}
      reducedMotion={reducedMotion}
      paused={paused}
    />
  );
}
