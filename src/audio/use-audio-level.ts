"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentState, MicPermission } from "@/core/types";
import { InputAnalyzer } from "./input-analyzer";
import { OutputAnalyzer } from "./output-analyzer";
import { queryMicPermission, requestMicPermission } from "./mic-permission";

export function useAudioLevel(
  state: AgentState,
  audioRef: React.RefObject<HTMLAudioElement | null>,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  const levelRef = useRef(0);
  const input = useRef<InputAnalyzer | null>(null);
  const output = useRef<OutputAnalyzer | null>(null);
  const [micPermission, setMicPermission] = useState<MicPermission>("unknown");
  const hiddenRef = useRef(false);

  useEffect(() => {
    input.current = new InputAnalyzer();
    output.current = new OutputAnalyzer();
    void queryMicPermission().then(setMicPermission);

    const onVis = () => {
      hiddenRef.current = document.hidden;
      if (document.hidden) levelRef.current = 0;
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      input.current?.stop();
      output.current?.detach();
    };
  }, []);

  useEffect(() => {
    if (!enabled || state !== "listening") {
      input.current?.stop();
      input.current = new InputAnalyzer();
      return;
    }

    let cancelled = false;
    setMicPermission("prompting");
    void (async () => {
      const perm = await requestMicPermission();
      if (cancelled) return;
      setMicPermission(perm);
      if (perm !== "granted") {
        levelRef.current = 0;
        return;
      }
      try {
        await input.current?.start();
      } catch {
        setMicPermission("denied");
        levelRef.current = 0;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state, enabled]);

  useEffect(() => {
    const audio = audioRef.current;
    if (enabled && state === "speaking" && audio) {
      try {
        output.current?.attach(audio);
      } catch {
        // MediaElementSource can only attach once per element.
      }
    }
  }, [state, audioRef, enabled]);

  useEffect(() => {
    if (!enabled) {
      levelRef.current = 0;
      return;
    }

    let raf = 0;
    const tick = () => {
      if (hiddenRef.current) {
        levelRef.current = 0;
      } else if (state === "listening" && micPermission === "granted") {
        levelRef.current = input.current?.readLevel() ?? 0;
      } else if (state === "speaking") {
        levelRef.current = output.current?.readLevel() ?? 0;
      } else {
        levelRef.current = Math.max(0, levelRef.current * 0.92);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, enabled, micPermission]);

  return { levelRef, micPermission, setMicPermission };
}
