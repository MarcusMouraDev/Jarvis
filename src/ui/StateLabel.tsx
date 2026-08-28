"use client";

import type { AgentState } from "@/core/types";
import { STATE_LABELS } from "@/state/agent-state";

const STATE_COLOR: Record<AgentState, string> = {
  idle: "text-ink-2",
  listening: "text-accent-listen",
  thinking: "text-accent-think",
  speaking: "text-accent-speak",
  asking: "text-accent-ask",
  failure: "text-ink-1",
};

interface StateLabelProps {
  state: AgentState;
}

export function StateLabel({ state }: StateLabelProps) {
  return (
    <p
      className={`state-label text-center text-sm font-medium tracking-[0.04em] sm:text-base ${STATE_COLOR[state]}`}
      aria-live="polite"
      data-testid="state-label"
    >
      {STATE_LABELS[state]}
    </p>
  );
}
