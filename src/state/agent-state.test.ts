import { describe, expect, it } from "vitest";
import {
  AgentStateMachine,
  LEGAL_TRANSITIONS,
  STATE_LABELS,
  hasTextualLabel,
} from "@/state/agent-state";
import type { AgentState } from "@/core/types";

const ALL: AgentState[] = [
  "idle",
  "listening",
  "thinking",
  "speaking",
  "asking",
  "failure",
];

describe("AgentStateMachine", () => {
  it("começa em idle", () => {
    expect(new AgentStateMachine().current).toBe("idle");
  });

  it("aceita todas as transições legais", () => {
    for (const from of ALL) {
      for (const to of LEGAL_TRANSITIONS[from]) {
        const m = new AgentStateMachine();
        m.force(from);
        expect(m.transition(to)).toBe(to);
      }
    }
  });

  it("rejeita todas as transições ilegais", () => {
    for (const from of ALL) {
      const legal = new Set(LEGAL_TRANSITIONS[from]);
      for (const to of ALL) {
        if (legal.has(to)) continue;
        const m = new AgentStateMachine();
        m.force(from);
        expect(() => m.transition(to)).toThrow(/Transição ilegal/);
      }
    }
  });

  it("force ignora a tabela legal", () => {
    const m = new AgentStateMachine();
    expect(m.force("speaking")).toBe("speaking");
  });

  it("todo estado tem rótulo textual (nunca só cor)", () => {
    for (const state of ALL) {
      expect(hasTextualLabel(state)).toBe(true);
      expect(STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });
});
