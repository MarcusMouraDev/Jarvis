"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  advanceStreamLevel,
  createStreamLevelState,
  noteChars,
  type StreamLevelState,
} from "./stream-level";

export function useStreamLevel(): {
  levelRef: React.RefObject<number>;
  noteDelta: (chars: number) => void;
} {
  const levelRef = useRef(0);
  const stateRef = useRef<StreamLevelState>(createStreamLevelState());
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const noteDelta = useCallback((chars: number) => {
    stateRef.current = noteChars(stateRef.current, chars);
    if (rafRef.current !== null) return;
    lastRef.current = 0;
    const tick = (now: number) => {
      const dt = lastRef.current === 0 ? 1 / 60 : (now - lastRef.current) / 1000;
      lastRef.current = now;
      stateRef.current = advanceStreamLevel(stateRef.current, dt);
      levelRef.current = stateRef.current.level;
      if (stateRef.current.level < 0.001 && stateRef.current.pending === 0) {
        levelRef.current = 0;
        rafRef.current = null;
        lastRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => stop, [stop]);

  return { levelRef, noteDelta };
}
