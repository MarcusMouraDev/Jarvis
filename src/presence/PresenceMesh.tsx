"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { AgentState } from "@/core/types";
import {
  PRESENCE_BY_STATE,
  STATE_BLEND_RATE,
  hexToRgb,
  lerp,
  lerpColor,
} from "@/state/presence-config";
import { fragmentShader, vertexShader } from "./shaders";

interface PresenceMeshProps {
  state: AgentState;
  levelRef: React.RefObject<number>;
  reducedMotion: boolean;
  paused: boolean;
}

export function PresenceMesh({
  state,
  levelRef,
  reducedMotion,
  paused,
}: PresenceMeshProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const initial = PRESENCE_BY_STATE.idle;
  const current = useRef({
    colorA: hexToRgb(initial.colorA),
    colorB: hexToRgb(initial.colorB),
    turbulence: initial.turbulence,
    coherence: initial.coherence,
  });

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uTurbulence: { value: initial.turbulence },
      uCoherence: { value: initial.coherence },
      uColorA: { value: new THREE.Vector3(...hexToRgb(initial.colorA)) },
      uColorB: { value: new THREE.Vector3(...hexToRgb(initial.colorB)) },
    }),
    // Idle baseline uniforms are stable for the mesh lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create once
    [],
  );

  useFrame((_, delta) => {
    if (!materialRef.current || paused) return;

    const next = PRESENCE_BY_STATE[state];
    const t = reducedMotion ? 1 : Math.min(1, delta * STATE_BLEND_RATE);

    if (!next.freezeColor) {
      current.current.colorA = lerpColor(
        current.current.colorA,
        hexToRgb(next.colorA),
        t,
      );
      current.current.colorB = lerpColor(
        current.current.colorB,
        hexToRgb(next.colorB),
        t,
      );
    }

    current.current.turbulence = lerp(
      current.current.turbulence,
      next.turbulence,
      t,
    );
    current.current.coherence = lerp(
      current.current.coherence,
      next.coherence,
      t,
    );

    const level = reducedMotion ? 0 : (levelRef.current ?? 0);
    const u = materialRef.current.uniforms;
    u.uColorA.value.set(...current.current.colorA);
    u.uColorB.value.set(...current.current.colorB);
    u.uTurbulence.value = reducedMotion ? 0 : current.current.turbulence;
    u.uCoherence.value = current.current.coherence;
    u.uLevel.value = level;

    if (!reducedMotion) {
      u.uTime.value += delta * (0.6 + next.pulse);
    }
  });

  return (
    <mesh>
      <icosahedronGeometry args={[1.2, 5]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
      />
    </mesh>
  );
}
