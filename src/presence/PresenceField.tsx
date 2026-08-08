"use client";

import dynamic from "next/dynamic";
import type { AgentState } from "@/core/types";
import { PresenceFallback } from "./PresenceFallback";

const PresenceCanvas = dynamic(
  () => import("./PresenceCanvas").then((m) => m.PresenceCanvas),
  { ssr: false, loading: () => <PresenceFallback state="idle" /> },
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
  if (!webglAvailable) {
    return <PresenceFallback state={state} animate={false} />;
  }

  if (reducedMotion) {
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
