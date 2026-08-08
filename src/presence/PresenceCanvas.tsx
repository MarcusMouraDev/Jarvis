"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import type { AgentState } from "@/core/types";
import { PresenceMesh } from "./PresenceMesh";

interface PresenceCanvasProps {
  state: AgentState;
  levelRef: React.RefObject<number>;
  reducedMotion: boolean;
  paused: boolean;
}

function VisibilityGate({ paused }: { paused: boolean }) {
  const { invalidate, set } = useThree();
  useEffect(() => {
    set({ frameloop: paused ? "never" : "always" });
    if (!paused) invalidate();
  }, [paused, invalidate, set]);
  return null;
}

export function PresenceCanvas({
  state,
  levelRef,
  reducedMotion,
  paused,
}: PresenceCanvasProps) {
  const dpr =
    typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 1.75) : 1;

  return (
    <Canvas
      className="h-full w-full"
      dpr={dpr}
      camera={{ position: [0, 0, 3.4], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
      frameloop={paused || reducedMotion ? "demand" : "always"}
    >
      <VisibilityGate paused={paused || reducedMotion} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[2, 2, 4]} intensity={0.8} />
      <Suspense fallback={null}>
        <PresenceMesh
          state={state}
          levelRef={levelRef}
          reducedMotion={reducedMotion}
          paused={paused}
        />
      </Suspense>
    </Canvas>
  );
}
