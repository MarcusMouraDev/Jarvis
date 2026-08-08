import type { AgentState } from "@/core/types";

const LEGAL: Record<AgentState, AgentState[]> = {
  idle: ["listening", "thinking", "asking", "failure"],
  listening: ["thinking", "idle", "failure"],
  thinking: ["speaking", "asking", "idle", "failure"],
  speaking: ["idle", "listening", "asking", "failure"],
  asking: ["thinking", "idle", "listening", "failure"],
  failure: ["idle", "asking"],
};

export class AgentStateMachine {
  private state: AgentState = "idle";

  get current(): AgentState {
    return this.state;
  }

  canTransition(to: AgentState): boolean {
    return LEGAL[this.state].includes(to);
  }

  transition(to: AgentState): AgentState {
    if (!this.canTransition(to)) {
      throw new Error(`Transição ilegal: ${this.state} → ${to}`);
    }
    this.state = to;
    return this.state;
  }

  force(to: AgentState): AgentState {
    this.state = to;
    return this.state;
  }
}

export const STATE_LABELS: Record<AgentState, string> = {
  idle: "repouso",
  listening: "ouvindo",
  thinking: "pensando",
  speaking: "falando",
  asking: "perguntando",
  failure: "falha",
};

export function hasTextualLabel(state: AgentState): boolean {
  return Boolean(STATE_LABELS[state]);
}

export { LEGAL as LEGAL_TRANSITIONS };
