const SLOW_FRAME_SECONDS = 0.022;
const SLOW_FRAMES_TO_DEGRADE = 90;

export interface WatchdogState {
  avgDelta: number;
  slowFrames: number;
  degraded: boolean;
}

export function createWatchdogState(): WatchdogState {
  return { avgDelta: 1 / 60, slowFrames: 0, degraded: false };
}

export function stepWatchdog(
  state: WatchdogState,
  delta: number,
): { state: WatchdogState; shouldDegrade: boolean } {
  const avgDelta = state.avgDelta * 0.9 + delta * 0.1;
  const slow = delta > SLOW_FRAME_SECONDS && avgDelta > SLOW_FRAME_SECONDS;
  const slowFrames = slow ? state.slowFrames + 1 : 0;
  const shouldDegrade =
    !state.degraded && slowFrames >= SLOW_FRAMES_TO_DEGRADE;
  return {
    state: {
      avgDelta,
      slowFrames,
      degraded: state.degraded || shouldDegrade,
    },
    shouldDegrade,
  };
}
