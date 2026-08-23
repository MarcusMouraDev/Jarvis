/** Pending characters that map to a full stream level. */
const CHARS_FOR_FULL = 90;
const ATTACK_PER_SEC = 9;
const DECAY_PER_SEC = 1.6;
const PENDING_DRAIN_PER_SEC = 4;

export interface StreamLevelState {
  level: number;
  pending: number;
}

export function createStreamLevelState(): StreamLevelState {
  return { level: 0, pending: 0 };
}

export function noteChars(
  state: StreamLevelState,
  chars: number,
): StreamLevelState {
  if (!Number.isFinite(chars) || chars <= 0) return state;
  return {
    level: state.level,
    pending: Math.min(state.pending + chars, CHARS_FOR_FULL * 4),
  };
}

export function advanceStreamLevel(
  state: StreamLevelState,
  deltaSeconds: number,
): StreamLevelState {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return state;
  const target = Math.min(1, state.pending / CHARS_FOR_FULL);
  const rate = target > state.level ? ATTACK_PER_SEC : DECAY_PER_SEC;
  const step = Math.min(1, rate * deltaSeconds);
  const level = state.level + (target - state.level) * step;
  const drain = Math.min(1, PENDING_DRAIN_PER_SEC * deltaSeconds);
  return {
    level: Math.min(1, Math.max(0, level)),
    pending: Math.max(0, state.pending * (1 - drain)),
  };
}
