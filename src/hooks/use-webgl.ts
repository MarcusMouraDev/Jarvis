"use client";

import { useSyncExternalStore } from "react";

let cached: boolean | null = null;
let contextLost = false;
let listenersAttached = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function attachContextListeners(canvas: HTMLCanvasElement) {
  if (listenersAttached) return;
  listenersAttached = true;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    contextLost = true;
    cached = false;
    emit();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    cached = null;
    emit();
  });
}

/** Pure helper — detect once; optional cache reset for tests. */
export function detectWebGLOnce(options?: { force?: boolean }): boolean {
  if (typeof document === "undefined") return false;
  if (contextLost) return false;
  if (cached !== null && !options?.force) return cached;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    cached = !!gl;
    if (gl) attachContextListeners(canvas);
    return cached;
  } catch {
    cached = false;
    return false;
  }
}

export function resetWebGLDetectionCache(): void {
  cached = null;
  contextLost = false;
  listenersAttached = false;
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot() {
  return detectWebGLOnce();
}

function getServerSnapshot() {
  return false;
}

export function useWebGLAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
