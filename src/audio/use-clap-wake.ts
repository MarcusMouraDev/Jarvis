"use client";

import { useEffect, useRef } from "react";
import type { AgentState } from "@/core/types";
import { ClapDetector, rmsFromTimeDomain } from "./clap-detector";
import { queryMicPermission, requestMicPermission } from "./mic-permission";

const ACTIVE_STATES: AgentState[] = ["listening", "thinking", "speaking", "asking"];

export function useClapWake(options: {
  enabled: boolean;
  state: AgentState;
  onWake: () => void;
}) {
  const { enabled, state, onWake } = options;
  const onWakeRef = useRef(onWake);

  useEffect(() => {
    onWakeRef.current = onWake;
  }, [onWake]);

  const standby = enabled && state === "idle";

  useEffect(() => {
    if (!standby) return;

    let cancelled = false;
    let raf = 0;
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let stream: MediaStream | null = null;
    const detector = new ClapDetector();
    let timeDomain: Float32Array | null = null;

    void (async () => {
      const perm = await queryMicPermission();
      if (perm === "denied" || cancelled) return;
      const granted = perm === "granted" ? perm : await requestMicPermission();
      if (granted !== "granted" || cancelled) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return;
        context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        timeDomain = new Float32Array(analyser.fftSize);

        const tick = () => {
          if (cancelled || !analyser || !timeDomain) return;
          analyser.getFloatTimeDomainData(
            timeDomain as Float32Array<ArrayBuffer>,
          );
          const energy = rmsFromTimeDomain(timeDomain);
          if (detector.processEnergy(energy)) {
            onWakeRef.current();
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // mic unavailable — clap wake stays off
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
      detector.reset();
    };
  }, [standby]);

  return { standby, paused: enabled && ACTIVE_STATES.includes(state) };
}
