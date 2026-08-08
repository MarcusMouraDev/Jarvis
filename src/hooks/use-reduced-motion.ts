"use client";

import { useSyncExternalStore } from "react";

function subscribeReducedMotion(onStoreChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** SSR/default: reduced so first paint never starts motion prematurely. */
function getReducedMotionServerSnapshot() {
  return true;
}

/**
 * Prefers-reduced-motion via external store.
 * Server snapshot is `true` (reduced) until the client hydrates.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

function subscribeDocumentHidden(onStoreChange: () => void) {
  document.addEventListener("visibilitychange", onStoreChange);
  return () => document.removeEventListener("visibilitychange", onStoreChange);
}

function getDocumentHiddenSnapshot() {
  return document.hidden;
}

function getDocumentHiddenServerSnapshot() {
  return false;
}

export function useDocumentHidden(): boolean {
  return useSyncExternalStore(
    subscribeDocumentHidden,
    getDocumentHiddenSnapshot,
    getDocumentHiddenServerSnapshot,
  );
}
