/**
 * Double-clap wake detector — port of BIGBRODIE94/JARVIS.py (jarvis/voice.py).
 * Two sharp energy spikes within ~0.15–0.8s activate listening.
 */
export interface ClapDetectorConfig {
  spikeMultiplier?: number;
  minGapMs?: number;
  maxGapMs?: number;
  absoluteFloor?: number;
  ambientWindow?: number;
}

const DEFAULTS: Required<ClapDetectorConfig> = {
  spikeMultiplier: 8,
  minGapMs: 150,
  maxGapMs: 800,
  absoluteFloor: 0.02,
  ambientWindow: 100,
};

export function rmsFromTimeDomain(data: Float32Array): number {
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export class ClapDetector {
  private readonly cfg: Required<ClapDetectorConfig>;
  private ambientLevels: number[] = [];
  private clapTimes: number[] = [];

  constructor(config: ClapDetectorConfig = {}) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  reset(): void {
    this.ambientLevels = [];
    this.clapTimes = [];
  }

  /** Feed RMS energy (0–1). Returns true when a valid double-clap is detected. */
  processEnergy(energy: number, nowSec = performance.now() / 1000): boolean {
    this.ambientLevels.push(energy);
    if (this.ambientLevels.length > this.cfg.ambientWindow) {
      this.ambientLevels.shift();
    }

    const ambient =
      this.ambientLevels.length > 10
        ? median(this.ambientLevels)
        : 0.005;
    const threshold = Math.max(
      this.cfg.absoluteFloor,
      ambient * this.cfg.spikeMultiplier,
    );

    if (energy <= threshold) {
      return false;
    }

    const minGap = this.cfg.minGapMs / 1000;
    const maxGap = this.cfg.maxGapMs / 1000;

    if (!this.clapTimes.length || nowSec - this.clapTimes[this.clapTimes.length - 1]! > minGap) {
      this.clapTimes.push(nowSec);
    }

    while (this.clapTimes.length && nowSec - this.clapTimes[0]! > maxGap + 0.5) {
      this.clapTimes.shift();
    }

    if (this.clapTimes.length < 2) return false;

    const gap = this.clapTimes[this.clapTimes.length - 1]! - this.clapTimes[this.clapTimes.length - 2]!;
    if (gap >= minGap && gap <= maxGap) {
      this.reset();
      return true;
    }

    return false;
  }
}
