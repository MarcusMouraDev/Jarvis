"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { createWatchdogState, stepWatchdog } from "./fps-watchdog";
import type { EffectsProfile } from "./effects-profile";
import {
  applyProfileToUniforms,
  createCinematicComposer,
  type CinematicComposer,
  type CinematicUniforms,
} from "./post-processing";

interface PresenceEffectsProps {
  profile: EffectsProfile;
  levelRef: React.RefObject<number>;
  paused: boolean;
  onDegrade?: () => void;
}

export function PresenceEffects({
  profile,
  levelRef,
  paused,
  onDegrade,
}: PresenceEffectsProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const rigRef = useRef<CinematicComposer | null>(null);
  const profileRef = useRef(profile);
  const onDegradeRef = useRef(onDegrade);
  const sizeRef = useRef(size);
  const pausedRef = useRef(paused);
  const clock = useRef(0);
  const watchdog = useRef(createWatchdogState());

  useEffect(() => {
    profileRef.current = profile;
    const current = rigRef.current;
    if (!current) return;
    applyProfileToUniforms(
      current.cinematic.uniforms as unknown as CinematicUniforms,
      profile,
    );
    current.bloom.strength = profile.bloomStrength;
    current.bloom.radius = profile.bloomRadius;
    current.bloom.threshold = profile.bloomThreshold;
  }, [profile]);

  useEffect(() => {
    onDegradeRef.current = onDegrade;
  }, [onDegrade]);

  useEffect(() => {
    sizeRef.current = size;
    rigRef.current?.setSize(size.width, size.height);
  }, [size]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    return () => {
      rigRef.current?.dispose();
      rigRef.current = null;
    };
  }, [gl, scene, camera, profile.tier]);

  useFrame((_, delta) => {
    if (pausedRef.current) return;
    if (!rigRef.current) {
      const s = sizeRef.current;
      rigRef.current = createCinematicComposer({
        renderer: gl,
        scene,
        camera,
        width: s.width,
        height: s.height,
        profile: profileRef.current,
      });
    }
    const current = rigRef.current;
    const p = profileRef.current;
    clock.current += delta;
    const uniforms = current.cinematic.uniforms as unknown as CinematicUniforms;
    uniforms.uTime.value = clock.current;

    const level = levelRef.current ?? 0;
    current.bloom.strength = p.bloomStrength * (1 + level * 0.55);

    const out = stepWatchdog(watchdog.current, delta);
    watchdog.current = out.state;
    if (out.shouldDegrade) onDegradeRef.current?.();

    current.composer.render(delta);
  }, 1);

  return null;
}
