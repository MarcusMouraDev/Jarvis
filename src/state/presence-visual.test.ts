import { describe, expect, it } from "vitest";
import {
  IDLE_PRESENCE_VISUAL,
  PRESENCE_BY_STATE,
  resolvePresenceVisual,
} from "@/state/presence-config";

describe("resolvePresenceVisual", () => {
  it("thinking usa âmbar do catálogo", () => {
    const visual = resolvePresenceVisual("thinking", IDLE_PRESENCE_VISUAL);
    expect(visual.colorA).toBe(PRESENCE_BY_STATE.thinking.colorA);
    expect(visual.colorB).toBe(PRESENCE_BY_STATE.thinking.colorB);
    expect(visual.saturation).toBe(1);
  });

  it("failure preserva matiz anterior e dessatura", () => {
    const thinking = resolvePresenceVisual("thinking", IDLE_PRESENCE_VISUAL);
    const failed = resolvePresenceVisual("failure", thinking);
    expect(failed.colorA).toBe(thinking.colorA);
    expect(failed.colorB).toBe(thinking.colorB);
    expect(failed.saturation).toBeLessThanOrEqual(0.35);
    expect(failed.activation).toBe(PRESENCE_BY_STATE.failure.activation);
    expect(failed.colorA).not.toBe(PRESENCE_BY_STATE.failure.colorA);
  });

  it("failure após idle não vira cinza fixo do catálogo", () => {
    const failed = resolvePresenceVisual("failure", IDLE_PRESENCE_VISUAL);
    expect(failed.colorA).toBe(IDLE_PRESENCE_VISUAL.colorA);
  });
});
