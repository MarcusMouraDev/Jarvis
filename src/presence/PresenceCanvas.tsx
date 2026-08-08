"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import type { AgentState } from "@/core/types";
import { PresenceMesh } from "./PresenceMesh";

interface PresenceCanvasProps {
  state: AgentState;
  levelRef: React.RefObject<number>;
  reducedMotion: boolean;
  paused: boolean;
}

function VisibilityGate({ paused }: { paused: boolean }) {
  const { invalidate, set, gl } = useThree();
  useEffect(() => {
    gl.setClearColor(0x000000, 0);
    set({ frameloop: paused ? "never" : "always" });
    if (!paused) invalidate();
  }, [paused, invalidate, set, gl]);
  return null;
}

export function PresenceCanvas({
  state,
  levelRef,
  reducedMotion,
  paused,
}: PresenceCanvasProps) {
  const pointerRef = useRef({ x: 0, y: 0, active: false });
  const finePointer = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    const sync = () => {
      finePointer.current = mq.matches;
      if (!mq.matches) pointerRef.current.active = false;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const dpr =
    typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 1.75) : 1;
  const stopLoop = paused || reducedMotion;

  return (
    <div
      className="relative z-20 h-full w-full"
      onPointerMove={(e) => {
        if (!finePointer.current || reducedMotion) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        pointerRef.current.x = nx;
        pointerRef.current.y = ny;
        pointerRef.current.active = true;
      }}
      onPointerLeave={() => {
        pointerRef.current.active = false;
      }}
    >
      <Canvas
        className="h-full w-full"
        dpr={dpr}
        camera={{ position: [0, 0.12, 3.35], fov: 40 }}
        gl={{
          antialias: true,
          alpha: true,
          premultipliedAlpha: false,
          powerPreference: "high-performance",
        }}
        frameloop={stopLoop ? "demand" : "always"}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <VisibilityGate paused={stopLoop} />
        <Suspense fallback={null}>
          <PresenceMesh
            state={state}
            levelRef={levelRef}
            reducedMotion={reducedMotion}
            paused={paused}
            pointerRef={pointerRef}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
