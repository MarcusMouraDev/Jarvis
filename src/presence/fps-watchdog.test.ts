import { describe, expect, it } from "vitest";
import { createWatchdogState, stepWatchdog } from "./fps-watchdog";

function run(deltas: number[]) {
  let state = createWatchdogState();
  let fired = 0;
  for (const d of deltas) {
    const out = stepWatchdog(state, d);
    state = out.state;
    if (out.shouldDegrade) fired += 1;
  }
  return { state, fired };
}

describe("stepWatchdog", () => {
  it("nao degrada em 60fps", () => {
    expect(run(Array(200).fill(1 / 60)).fired).toBe(0);
  });

  it("degrada uma unica vez sob carga sustentada", () => {
    expect(run(Array(300).fill(1 / 20)).fired).toBe(1);
  });

  it("um frame rapido zera o contador de lentos", () => {
    const deltas = [...Array(80).fill(1 / 20), 1 / 60, ...Array(80).fill(1 / 20)];
    expect(run(deltas).fired).toBe(0);
  });

  it("marca degraded no estado apos disparar", () => {
    expect(run(Array(300).fill(1 / 20)).state.degraded).toBe(true);
  });
});
