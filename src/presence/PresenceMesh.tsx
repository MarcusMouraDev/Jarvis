"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AgentState } from "@/core/types";
import {
  PRESENCE_BY_STATE,
  STATE_BLEND_RATE,
  hexToRgb,
  lerp,
  lerpColor,
  resolvePresenceVisual,
  IDLE_PRESENCE_VISUAL,
  type PresenceVisual,
} from "@/state/presence-config";
import {
  createLayeredNeuralGeometry,
  getNeuralProfile,
  packCombinedEdges,
  type NeuralLayer,
} from "./neural-geometry";
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

const LAYER_SCALE: Record<NeuralLayer | "stardust", number> = {
  core: 0.84,
  cortex: 0.61,
  micro: 0.31,
  stardust: 0.18,
};

const LAYER_OPACITY: Record<NeuralLayer | "stardust", number> = {
  core: 0.78,
  cortex: 0.74,
  micro: 0.52,
  stardust: 0.3,
};

const LAYER_INGEST: Record<NeuralLayer | "stardust", number> = {
  core: 0,
  cortex: 0.12,
  micro: 0.35,
  stardust: 0.6,
};

function makeNodeUniforms(
  initial: { colorA: string; colorB: string; activation: number; pulse: number; coherence: number },
  layer: NeuralLayer | "stardust",
) {
  return {
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
    uLayerOpacity: { value: LAYER_OPACITY[layer] },
    uPointScale: { value: LAYER_SCALE[layer] },
    uTurbulence: { value: 0.12 },
    uFlow: { value: 1 },
    uIngest: { value: 0 },
  };
}

function makeLinkUniforms(initial: {
  colorA: string;
  colorB: string;
  pulseTravel: number;
  linkIntensity: number;
  coherence: number;
}) {
  return {
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
    uLayerOpacity: { value: 0.72 },
    uTurbulence: { value: 0.12 },
    uFlow: { value: 1 },
    uIngest: { value: 0 },
  };
}

function OrbitRings({
  dustMatRef,
  ringMatRefs,
}: {
  dustMatRef: React.RefObject<THREE.ShaderMaterial | null>;
  ringMatRefs: React.MutableRefObject<(THREE.LineBasicMaterial | null)[]>;
}) {
  const { rings, dust } = useMemo(() => {
    // Round silhouette — radii near sphere, mild tilt (not flattened rings)
    const ringGeos = [0.9, 0.96, 1.02, 1.06].map((r, i) => {
      const curve = new THREE.EllipseCurve(
        0,
        0,
        r,
        r * (0.96 + (i % 2) * 0.02),
        0,
        Math.PI * 2,
        false,
        i * 0.25,
      );
      const pts = curve.getPoints(180);
      const positions = new Float32Array(pts.length * 3);
      const yScale = 0.55 + (i % 2) * 0.12;
      for (let j = 0; j < pts.length; j += 1) {
        positions[j * 3] = pts[j].x;
        positions[j * 3 + 1] = pts[j].y * yScale * 0.35;
        positions[j * 3 + 2] = pts[j].y;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      return g;
    });

    const dustCount = 480;
    const dustPos = new Float32Array(dustCount * 3);
    const dustPhase = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i += 1) {
      const ring = 0.9 + (i % 4) * 0.05;
      const a = (i / dustCount) * Math.PI * 2 * 7;
      const yTilt = Math.sin(i * 0.37) * 0.12;
      dustPos[i * 3] = Math.cos(a) * ring;
      dustPos[i * 3 + 1] = yTilt * ring;
      dustPos[i * 3 + 2] = Math.sin(a) * ring;
      dustPhase[i] = (i % 97) / 97;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute("aPhase", new THREE.BufferAttribute(dustPhase, 1));
    return { rings: ringGeos, dust: dustGeo };
  }, []);

  const dustUniforms = useMemo(
    () => makeNodeUniforms(PRESENCE_BY_STATE.idle, "micro"),
    [],
  );

  const idleRing = PRESENCE_BY_STATE.idle.colorA;

  return (
    <group rotation={[0.28, 0.18, 0.1]}>
      {rings.map((g, i) => (
        <lineLoop key={i} geometry={g}>
          <lineBasicMaterial
            ref={(mat) => {
              ringMatRefs.current[i] = mat;
            }}
            color={idleRing}
            transparent
            opacity={0.1 - i * 0.014}
            depthWrite={false}
          />
        </lineLoop>
      ))}
      <points geometry={dust}>
        <shaderMaterial
          ref={dustMatRef}
          vertexShader={nodeVertexShader}
          fragmentShader={nodeFragmentShader}
          uniforms={dustUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export function PresenceMesh({
  state,
  levelRef,
  reducedMotion,
  paused,
  pointerRef,
}: PresenceMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const coreMatRef = useRef<THREE.ShaderMaterial>(null);
  const cortexMatRef = useRef<THREE.ShaderMaterial>(null);
  const microMatRef = useRef<THREE.ShaderMaterial>(null);
  const stardustMatRef = useRef<THREE.ShaderMaterial>(null);
  const dustMatRef = useRef<THREE.ShaderMaterial>(null);
  const ringMatRefs = useRef<(THREE.LineBasicMaterial | null)[]>([]);
  const coreLinkMatRef = useRef<THREE.ShaderMaterial>(null);
  const outerLinkMatRef = useRef<THREE.ShaderMaterial>(null);
  const spring = useRef({ x: 0, y: 0, vx: 0, vy: 0, strength: 0 });
  const visualRef = useRef<PresenceVisual>(IDLE_PRESENCE_VISUAL);
  const { invalidate } = useThree();

  const layered = useMemo(() => {
    const width =
      typeof window !== "undefined" ? window.innerWidth : 1280;
    const dpr =
      typeof window !== "undefined"
        ? Math.min(window.devicePixelRatio, 1.75)
        : 1;
    return createLayeredNeuralGeometry(
      getNeuralProfile({ width, dpr, reducedMotion }),
    );
  }, [reducedMotion]);

  const initial = PRESENCE_BY_STATE.idle;
  const current = useRef({
    colorA: hexToRgb(initial.colorA),
    colorB: hexToRgb(initial.colorB),
    coherence: initial.coherence,
    activation: initial.activation,
    linkIntensity: initial.linkIntensity,
    pulseTravel: initial.pulseTravel,
    rotation: initial.rotation,
    turbulence: initial.turbulence,
    saturation: 1,
    ingest: 0,
  });

  const coreGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(layered.core.positions, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(layered.core.phases, 1));
    return g;
  }, [layered]);

  const cortexGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(layered.cortex.positions, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(layered.cortex.phases, 1));
    return g;
  }, [layered]);

  const microGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(layered.micro.positions, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(layered.micro.phases, 1));
    return g;
  }, [layered]);

  const stardustGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(layered.stardust.positions, 3),
    );
    g.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(layered.stardust.phases, 1),
    );
    return g;
  }, [layered]);

  const { coreLinkGeo, outerLinkGeo } = useMemo(() => {
    const packed = packCombinedEdges(layered);
    const coreEnd = layered.core.points.length;
    const cortexEnd = coreEnd + layered.cortex.points.length;

    const coreEdges: number[] = [];
    const outerEdges: number[] = [];
    const corePhases: number[] = [];
    const outerPhases: number[] = [];
    const coreAlong: number[] = [];
    const outerAlong: number[] = [];

    for (let i = 0; i < layered.edges.length; i += 1) {
      const e = layered.edges[i];
      const o = i * 6;
      const segment = [
        packed.edgePositions[o],
        packed.edgePositions[o + 1],
        packed.edgePositions[o + 2],
        packed.edgePositions[o + 3],
        packed.edgePositions[o + 4],
        packed.edgePositions[o + 5],
      ];
      const bothCore = e.a < coreEnd && e.b < coreEnd;
      const bothOuter = e.a >= cortexEnd || e.b >= cortexEnd;
      const target = bothCore ? coreEdges : outerEdges;
      const phases = bothCore ? corePhases : outerPhases;
      const along = bothCore ? coreAlong : outerAlong;
      if (!bothCore && !bothOuter && e.a < cortexEnd && e.b < cortexEnd) {
        // cortex-internal → core family (primary structure)
        coreEdges.push(...segment);
        corePhases.push(e.phase, e.phase);
        coreAlong.push(0, 1);
        continue;
      }
      target.push(...segment);
      phases.push(e.phase, e.phase);
      along.push(0, 1);
    }

    const mk = (positions: number[], phases: number[], along: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      g.setAttribute("aPhase", new THREE.BufferAttribute(new Float32Array(phases), 1));
      g.setAttribute("aAlong", new THREE.BufferAttribute(new Float32Array(along), 1));
      return g;
    };

    return {
      coreLinkGeo: mk(coreEdges, corePhases, coreAlong),
      outerLinkGeo: mk(outerEdges, outerPhases, outerAlong),
    };
  }, [layered]);

  const coreUniforms = useMemo(
    () => makeNodeUniforms(PRESENCE_BY_STATE.idle, "core"),
    [],
  );
  const cortexUniforms = useMemo(
    () => makeNodeUniforms(PRESENCE_BY_STATE.idle, "cortex"),
    [],
  );
  const microUniforms = useMemo(
    () => makeNodeUniforms(PRESENCE_BY_STATE.idle, "micro"),
    [],
  );
  const stardustUniforms = useMemo(
    () => makeNodeUniforms(PRESENCE_BY_STATE.idle, "stardust"),
    [],
  );
  const coreLinkUniforms = useMemo(
    () => makeLinkUniforms(PRESENCE_BY_STATE.idle),
    [],
  );
  const outerLinkUniforms = useMemo(
    () => ({
      ...makeLinkUniforms(PRESENCE_BY_STATE.idle),
      uLayerOpacity: { value: 0.58 },
    }),
    [],
  );

  const syncRingColors = () => {
    const [r, g, b] = current.current.colorA;
    for (const mat of ringMatRefs.current) {
      if (mat) mat.color.setRGB(r, g, b);
    }
  };

  const applyUniforms = (force = false) => {
    const mats = [
      coreMatRef.current,
      cortexMatRef.current,
      microMatRef.current,
      stardustMatRef.current,
      dustMatRef.current,
      coreLinkMatRef.current,
      outerLinkMatRef.current,
    ];
    if (mats.some((m) => !m) && !force) return;

    const nextCfg = PRESENCE_BY_STATE[state];
    const visual = resolvePresenceVisual(state, visualRef.current);
    if (state !== "failure") {
      visualRef.current = visual;
    } else {
      visualRef.current = visual;
    }

    const targetA = hexToRgb(visual.colorA);
    const targetB = hexToRgb(visual.colorB);
    const t = reducedMotion || force ? 1 : 0;

    if (t === 1) {
      current.current.colorA = targetA;
      current.current.colorB = targetB;
      current.current.coherence = visual.coherence;
      current.current.activation = visual.activation;
      current.current.linkIntensity = nextCfg.linkIntensity;
      current.current.pulseTravel = nextCfg.pulseTravel;
      current.current.rotation = nextCfg.rotation;
      current.current.turbulence = nextCfg.turbulence;
      current.current.saturation = visual.saturation;
      current.current.ingest =
        state === "thinking" ? 1 : state === "speaking" ? -0.35 : 0;
    }

    const nodeMats = [
      coreMatRef,
      cortexMatRef,
      microMatRef,
      stardustMatRef,
      dustMatRef,
    ];
    for (const ref of nodeMats) {
      const mat = ref.current;
      if (!mat) continue;
      mat.uniforms.uColorA.value.set(...current.current.colorA);
      mat.uniforms.uColorB.value.set(...current.current.colorB);
      mat.uniforms.uCoherence.value =
        current.current.coherence * (0.55 + current.current.saturation * 0.45);
      mat.uniforms.uActivation.value = current.current.activation;
      mat.uniforms.uPulse.value = nextCfg.pulse;
      mat.uniforms.uTurbulence.value = current.current.turbulence;
      mat.uniforms.uReducedMotion.value = reducedMotion ? 1 : 0;
      mat.uniforms.uFlow.value = reducedMotion ? 0 : 1;
    }
    for (const ref of [coreLinkMatRef, outerLinkMatRef]) {
      const mat = ref.current;
      if (!mat) continue;
      mat.uniforms.uColorA.value.set(...current.current.colorA);
      mat.uniforms.uColorB.value.set(...current.current.colorB);
      mat.uniforms.uCoherence.value =
        current.current.coherence * (0.55 + current.current.saturation * 0.45);
      mat.uniforms.uLinkIntensity.value = current.current.linkIntensity;
      mat.uniforms.uPulseTravel.value = current.current.pulseTravel;
      mat.uniforms.uTurbulence.value = current.current.turbulence;
      mat.uniforms.uReducedMotion.value = reducedMotion ? 1 : 0;
      mat.uniforms.uFlow.value = reducedMotion ? 0 : 1;
    }
    syncRingColors();
  };

  useEffect(() => {
    applyUniforms(true);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on state/motion only
  }, [state, reducedMotion, invalidate]);

  useFrame((_, delta) => {
    if (paused) return;
    if (
      !coreMatRef.current ||
      !cortexMatRef.current ||
      !microMatRef.current ||
      !stardustMatRef.current ||
      !dustMatRef.current ||
      !coreLinkMatRef.current ||
      !outerLinkMatRef.current
    ) {
      return;
    }

    const nextCfg = PRESENCE_BY_STATE[state];
    const visual = resolvePresenceVisual(state, visualRef.current);
    visualRef.current = visual;
    const t = reducedMotion ? 1 : Math.min(1, delta * STATE_BLEND_RATE);

    current.current.colorA = lerpColor(
      current.current.colorA,
      hexToRgb(visual.colorA),
      t,
    );
    current.current.colorB = lerpColor(
      current.current.colorB,
      hexToRgb(visual.colorB),
      t,
    );
    current.current.coherence = lerp(
      current.current.coherence,
      visual.coherence,
      t,
    );
    current.current.activation = lerp(
      current.current.activation,
      visual.activation,
      t,
    );
    current.current.linkIntensity = lerp(
      current.current.linkIntensity,
      nextCfg.linkIntensity,
      t,
    );
    current.current.pulseTravel = lerp(
      current.current.pulseTravel,
      nextCfg.pulseTravel,
      t,
    );
    current.current.rotation = lerp(
      current.current.rotation,
      nextCfg.rotation,
      t,
    );
    current.current.turbulence = lerp(
      current.current.turbulence,
      nextCfg.turbulence,
      t,
    );
    current.current.saturation = lerp(
      current.current.saturation,
      visual.saturation,
      t,
    );
    const ingestTarget =
      state === "thinking" ? 1 : state === "speaking" ? -0.35 : 0;
    current.current.ingest = lerp(current.current.ingest, ingestTarget, t);

    const level = reducedMotion ? 0 : (levelRef.current ?? 0);
    const rm = reducedMotion ? 1 : 0;
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

    const syncNode = (mat: THREE.ShaderMaterial, ingestScale: number) => {
      const u = mat.uniforms;
      u.uColorA.value.set(...current.current.colorA);
      u.uColorB.value.set(...current.current.colorB);
      u.uCoherence.value =
        current.current.coherence * (0.55 + current.current.saturation * 0.45);
      u.uActivation.value = current.current.activation;
      u.uPulse.value = nextCfg.pulse;
      u.uLevel.value = level;
      u.uReducedMotion.value = rm;
      u.uPointer.value.copy(pointerDir);
      u.uPointerStrength.value = s.strength;
      u.uTurbulence.value = current.current.turbulence;
      u.uFlow.value = reducedMotion ? 0 : 1;
      u.uIngest.value = current.current.ingest * ingestScale;
    };
    const syncLink = (mat: THREE.ShaderMaterial) => {
      const u = mat.uniforms;
      u.uColorA.value.set(...current.current.colorA);
      u.uColorB.value.set(...current.current.colorB);
      u.uCoherence.value =
        current.current.coherence * (0.55 + current.current.saturation * 0.45);
      u.uLinkIntensity.value = current.current.linkIntensity;
      u.uPulseTravel.value = current.current.pulseTravel;
      u.uLevel.value = level;
      u.uReducedMotion.value = rm;
      u.uPointer.value.copy(pointerDir);
      u.uPointerStrength.value = s.strength;
      u.uTurbulence.value = current.current.turbulence;
      u.uFlow.value = reducedMotion ? 0 : 1;
      u.uIngest.value = current.current.ingest * 0.2;
    };

    syncNode(coreMatRef.current, LAYER_INGEST.core);
    syncNode(cortexMatRef.current, LAYER_INGEST.cortex);
    syncNode(microMatRef.current, LAYER_INGEST.micro);
    syncNode(stardustMatRef.current, LAYER_INGEST.stardust);
    syncNode(dustMatRef.current, LAYER_INGEST.stardust);
    syncLink(coreLinkMatRef.current);
    syncLink(outerLinkMatRef.current);
    syncRingColors();

    if (!reducedMotion) {
      const dt = delta * (0.6 + nextCfg.pulse);
      for (const mat of [
        coreMatRef.current,
        cortexMatRef.current,
        microMatRef.current,
        stardustMatRef.current,
        dustMatRef.current,
        coreLinkMatRef.current,
        outerLinkMatRef.current,
      ]) {
        mat.uniforms.uTime.value += dt;
      }
      if (groupRef.current) {
        groupRef.current.rotation.y +=
          delta * current.current.rotation * (0.55 + level * 0.5);
        groupRef.current.rotation.x =
          Math.sin(coreMatRef.current.uniforms.uTime.value * 0.15) *
            0.08 *
            current.current.rotation +
          s.y * 0.12 * s.strength;
        groupRef.current.rotation.z = -s.x * 0.07 * s.strength;
        if (state === "idle") {
          const tIdle = coreMatRef.current.uniforms.uTime.value as number;
          groupRef.current.rotation.y += Math.sin(tIdle * 7.3) * 0.00035;
          groupRef.current.rotation.x += Math.sin(tIdle * 5.1 + 1.7) * 0.00025;
        }
      }
    }
  });

  return (
    <group ref={groupRef} scale={0.9}>
      <OrbitRings dustMatRef={dustMatRef} ringMatRefs={ringMatRefs} />
      <points geometry={coreGeo}>
        <shaderMaterial
          ref={coreMatRef}
          vertexShader={nodeVertexShader}
          fragmentShader={nodeFragmentShader}
          uniforms={coreUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points geometry={cortexGeo}>
        <shaderMaterial
          ref={cortexMatRef}
          vertexShader={nodeVertexShader}
          fragmentShader={nodeFragmentShader}
          uniforms={cortexUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points geometry={microGeo}>
        <shaderMaterial
          ref={microMatRef}
          vertexShader={nodeVertexShader}
          fragmentShader={nodeFragmentShader}
          uniforms={microUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points geometry={stardustGeo}>
        <shaderMaterial
          ref={stardustMatRef}
          vertexShader={nodeVertexShader}
          fragmentShader={nodeFragmentShader}
          uniforms={stardustUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <lineSegments geometry={coreLinkGeo}>
        <shaderMaterial
          ref={coreLinkMatRef}
          vertexShader={linkVertexShader}
          fragmentShader={linkFragmentShader}
          uniforms={coreLinkUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      <lineSegments geometry={outerLinkGeo}>
        <shaderMaterial
          ref={outerLinkMatRef}
          vertexShader={linkVertexShader}
          fragmentShader={linkFragmentShader}
          uniforms={outerLinkUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}
