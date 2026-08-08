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
import { createNeuralGeometry } from "./neural-geometry";
import {
  linkFragmentShader,
  linkVertexShader,
  nodeFragmentShader,
  nodeVertexShader,
} from "./shaders";

interface PresenceMeshProps {
  state: AgentState;
  levelRef: React.RefObject<number>;
  reducedMotion: boolean;
  paused: boolean;
  pointerRef: React.RefObject<{ x: number; y: number; active: boolean }>;
}

export function PresenceMesh({
  state,
  levelRef,
  reducedMotion,
  paused,
  pointerRef,
}: PresenceMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const nodeMatRef = useRef<THREE.ShaderMaterial>(null);
  const linkMatRef = useRef<THREE.ShaderMaterial>(null);
  const spring = useRef({ x: 0, y: 0, vx: 0, vy: 0, strength: 0 });

  const geometry = useMemo(() => createNeuralGeometry(), []);
  const initial = PRESENCE_BY_STATE.idle;

  const current = useRef({
    colorA: hexToRgb(initial.colorA),
    colorB: hexToRgb(initial.colorB),
    coherence: initial.coherence,
    activation: initial.activation,
    linkIntensity: initial.linkIntensity,
    pulseTravel: initial.pulseTravel,
    rotation: initial.rotation,
  });

  const nodeGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(geometry.positions, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(geometry.phases, 1));
    return g;
  }, [geometry]);

  const linkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(geometry.edgePositions, 3),
    );
    g.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(geometry.edgePhases, 1),
    );
    const along = new Float32Array(geometry.edges.length * 2);
    for (let i = 0; i < geometry.edges.length; i += 1) {
      along[i * 2] = 0;
      along[i * 2 + 1] = 1;
    }
    g.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
    return g;
  }, [geometry]);

  const nodeUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uActivation: { value: initial.activation },
      uPulse: { value: initial.pulse },
      uCoherence: { value: initial.coherence },
      uReducedMotion: { value: 0 },
      uPointer: { value: new THREE.Vector3(0, 0, 1) },
      uPointerStrength: { value: 0 },
      uColorA: { value: new THREE.Vector3(...hexToRgb(initial.colorA)) },
      uColorB: { value: new THREE.Vector3(...hexToRgb(initial.colorB)) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create once
    [],
  );

  const linkUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uPulseTravel: { value: initial.pulseTravel },
      uLinkIntensity: { value: initial.linkIntensity },
      uCoherence: { value: initial.coherence },
      uReducedMotion: { value: 0 },
      uPointer: { value: new THREE.Vector3(0, 0, 1) },
      uPointerStrength: { value: 0 },
      uColorA: { value: new THREE.Vector3(...hexToRgb(initial.colorA)) },
      uColorB: { value: new THREE.Vector3(...hexToRgb(initial.colorB)) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create once
    [],
  );

  useFrame((_, delta) => {
    if (paused) return;
    if (!nodeMatRef.current || !linkMatRef.current) return;

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

    current.current.coherence = lerp(
      current.current.coherence,
      next.coherence,
      t,
    );
    current.current.activation = lerp(
      current.current.activation,
      next.activation,
      t,
    );
    current.current.linkIntensity = lerp(
      current.current.linkIntensity,
      next.linkIntensity,
      t,
    );
    current.current.pulseTravel = lerp(
      current.current.pulseTravel,
      next.pulseTravel,
      t,
    );
    current.current.rotation = lerp(
      current.current.rotation,
      next.rotation,
      t,
    );

    const level = reducedMotion ? 0 : (levelRef.current ?? 0);
    const rm = reducedMotion ? 1 : 0;

    // Spring toward pointer (manual — avoid motion lib in R3F loop).
    const ptr = pointerRef.current;
    const targetX = !reducedMotion && ptr?.active ? ptr.x : 0;
    const targetY = !reducedMotion && ptr?.active ? ptr.y : 0;
    const targetStrength = !reducedMotion && ptr?.active ? 1 : 0;
    const stiffness = 48;
    const damping = 10;
    const s = spring.current;
    const ax = (targetX - s.x) * stiffness - s.vx * damping;
    const ay = (targetY - s.y) * stiffness - s.vy * damping;
    s.vx += ax * delta;
    s.vy += ay * delta;
    s.x += s.vx * delta;
    s.y += s.vy * delta;
    s.strength = lerp(s.strength, targetStrength, Math.min(1, delta * 8));

    const pointerDir = new THREE.Vector3(s.x, s.y, 0.85).normalize();

    const nu = nodeMatRef.current.uniforms;
    const lu = linkMatRef.current.uniforms;

    nu.uColorA.value.set(...current.current.colorA);
    nu.uColorB.value.set(...current.current.colorB);
    nu.uCoherence.value = current.current.coherence;
    nu.uActivation.value = current.current.activation;
    nu.uPulse.value = next.pulse;
    nu.uLevel.value = level;
    nu.uReducedMotion.value = rm;
    nu.uPointer.value.copy(pointerDir);
    nu.uPointerStrength.value = s.strength;

    lu.uColorA.value.set(...current.current.colorA);
    lu.uColorB.value.set(...current.current.colorB);
    lu.uCoherence.value = current.current.coherence;
    lu.uLinkIntensity.value = current.current.linkIntensity;
    lu.uPulseTravel.value = current.current.pulseTravel;
    lu.uLevel.value = level;
    lu.uReducedMotion.value = rm;
    lu.uPointer.value.copy(pointerDir);
    lu.uPointerStrength.value = s.strength;

    if (!reducedMotion) {
      const dt = delta * (0.6 + next.pulse);
      nu.uTime.value += dt;
      lu.uTime.value += dt;
      if (groupRef.current) {
        groupRef.current.rotation.y +=
          delta * current.current.rotation * (0.55 + level * 0.5);
        groupRef.current.rotation.x =
          Math.sin(nu.uTime.value * 0.15) * 0.12 * current.current.rotation +
          s.y * 0.18 * s.strength;
        groupRef.current.rotation.z = -s.x * 0.1 * s.strength;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <points geometry={nodeGeo}>
        <shaderMaterial
          ref={nodeMatRef}
          vertexShader={nodeVertexShader}
          fragmentShader={nodeFragmentShader}
          uniforms={nodeUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <lineSegments geometry={linkGeo}>
        <shaderMaterial
          ref={linkMatRef}
          vertexShader={linkVertexShader}
          fragmentShader={linkFragmentShader}
          uniforms={linkUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}
