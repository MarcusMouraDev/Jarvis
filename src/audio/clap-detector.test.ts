import { describe, expect, it } from "vitest";
import { ClapDetector, rmsFromTimeDomain } from "./clap-detector";

describe("ClapDetector", () => {
  it("detecta duas palmas com gap válido", () => {
    const detector = new ClapDetector({
      spikeMultiplier: 4,
      minGapMs: 150,
      maxGapMs: 800,
      absoluteFloor: 0.01,
    });

    let t = 0;
    for (let i = 0; i < 40; i += 1) {
      detector.processEnergy(0.002, t);
      t += 0.03;
    }

    detector.processEnergy(0.2, t);
    t += 0.35;
    const woke = detector.processEnergy(0.2, t);
    expect(woke).toBe(true);
  });

  it("ignora picos muito próximos", () => {
    const detector = new ClapDetector({
      spikeMultiplier: 4,
      minGapMs: 150,
      maxGapMs: 800,
      absoluteFloor: 0.01,
    });

    let t = 0;
    for (let i = 0; i < 30; i += 1) {
      detector.processEnergy(0.002, t);
      t += 0.03;
    }

    detector.processEnergy(0.2, t);
    t += 0.05;
    expect(detector.processEnergy(0.2, t)).toBe(false);
  });
});

describe("rmsFromTimeDomain", () => {
  it("calcula RMS de buffer", () => {
    const data = new Float32Array([0.5, -0.5, 0, 0]);
    expect(rmsFromTimeDomain(data)).toBeCloseTo(0.3535, 3);
  });
});
