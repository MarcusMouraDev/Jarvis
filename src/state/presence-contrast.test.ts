import { describe, expect, it } from "vitest";
import { PRESENCE_BY_STATE } from "@/state/presence-config";
import type { AgentState } from "@/core/types";
import { STATE_LABELS } from "@/state/agent-state";

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACE = "#1a1f28"; // approx surface-0

describe("contraste e comunicação de estado", () => {
  it("pares colorA/colorB de cada estado têm contraste interno", () => {
    for (const state of Object.keys(PRESENCE_BY_STATE) as AgentState[]) {
      if (PRESENCE_BY_STATE[state].freezeColor) continue;
      const { colorA, colorB } = PRESENCE_BY_STATE[state];
      expect(contrastRatio(colorA, colorB)).toBeGreaterThan(1.4);
    }
  });

  it("rótulos textuais existem para todos os estados (nunca só cor)", () => {
    for (const state of Object.keys(PRESENCE_BY_STATE) as AgentState[]) {
      expect(STATE_LABELS[state]).toBeTruthy();
    }
  });

  it("falha congela cor (freezeColor) em vez de usar vermelho de pergunta", () => {
    expect(PRESENCE_BY_STATE.failure.freezeColor).toBe(true);
    expect(PRESENCE_BY_STATE.asking.freezeColor).toBe(false);
    expect(PRESENCE_BY_STATE.failure.coherence).toBeLessThan(
      PRESENCE_BY_STATE.asking.coherence,
    );
  });

  it("texto claro sobre fundo escuro passa AA aproximado", () => {
    expect(contrastRatio("#f0f4f8", SURFACE)).toBeGreaterThan(4.5);
  });
});
