import { describe, expect, it } from "vitest";
import {
  advanceStreamLevel,
  createStreamLevelState,
  noteChars,
} from "./stream-level";

function settle(state = createStreamLevelState(), seconds = 1, dt = 1 / 60) {
  let s = state;
  for (let t = 0; t < seconds; t += dt) s = advanceStreamLevel(s, dt);
  return s;
}

describe("stream level", () => {
  it("comeca em zero", () => {
    expect(createStreamLevelState().level).toBe(0);
  });

  it("sobe quando chegam caracteres", () => {
    const s = settle(noteChars(createStreamLevelState(), 120), 0.25);
    expect(s.level).toBeGreaterThan(0.3);
  });

  it("decai para perto de zero sem novos caracteres", () => {
    const hot = settle(noteChars(createStreamLevelState(), 200), 0.3);
    const cold = settle(hot, 6);
    expect(cold.level).toBeLessThan(0.05);
  });

  it("nunca passa de 1 nem fica negativo", () => {
    const burst = settle(noteChars(createStreamLevelState(), 100000), 2);
    expect(burst.level).toBeLessThanOrEqual(1);
    expect(burst.level).toBeGreaterThanOrEqual(0);
  });

  it("sobe mais rapido do que desce", () => {
    const up = settle(noteChars(createStreamLevelState(), 120), 0.2);
    const down = settle({ level: up.level, pending: 0 }, 0.2);
    expect(up.level - 0).toBeGreaterThan(up.level - down.level);
  });

  it("ignora entrada invalida", () => {
    const s = noteChars(createStreamLevelState(), Number.NaN);
    expect(s.pending).toBe(0);
  });
});
