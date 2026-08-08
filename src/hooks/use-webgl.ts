"use client";

import { useSyncExternalStore } from "react";

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

function subscribe() {
  // Capability does not change after mount in practice.
  return () => {};
}

function getSnapshot() {
  return detectWebGL();
}

function getServerSnapshot() {
  return false;
}

export function useWebGLAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
