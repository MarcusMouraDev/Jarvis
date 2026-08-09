import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEURON_COUNT,
  MAX_EDGES,
  MAX_LAYER_RADIUS,
  averageDegree,
  createLayeredNeuralGeometry,
  createNeuralGeometry,
  fibonacciSphere,
  getNeuralProfile,
} from "./neural-geometry";

function maxRadius(points: { x: number; y: number; z: number }[]): number {
  let max = 0;
  for (const p of points) {
    const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (r > max) max = r;
  }
  return max;
}

describe("neural-geometry", () => {
  it("gera pontos determinísticos na esfera", () => {
    const a = fibonacciSphere(48, 1);
    const b = fibonacciSphere(48, 1);
    expect(a).toEqual(b);
    for (const p of a) {
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      expect(r).toBeGreaterThan(0.98);
      expect(r).toBeLessThan(1.02);
    }
  });

  it("cria arestas únicas com grau controlado", () => {
    const geo = createNeuralGeometry(DEFAULT_NEURON_COUNT, 5);
    const keys = new Set(
      geo.edges.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`),
    );
    expect(keys.size).toBe(geo.edges.length);
    expect(geo.edges.length).toBeLessThanOrEqual(MAX_EDGES);
    expect(averageDegree(geo)).toBeGreaterThan(3);
    expect(averageDegree(geo)).toBeLessThan(12);
  });

  it("buffers batem com pontos/arestas", () => {
    const geo = createNeuralGeometry(64, 4);
    expect(geo.positions.length).toBe(geo.points.length * 3);
    expect(geo.phases.length).toBe(geo.points.length);
    expect(geo.edgePositions.length).toBe(geo.edges.length * 6);
    expect(geo.edgePhases.length).toBe(geo.edges.length * 2);
  });

  it("é determinístico entre chamadas", () => {
    const a = createNeuralGeometry(80, 5);
    const b = createNeuralGeometry(80, 5);
    expect([...a.positions]).toEqual([...b.positions]);
    expect(a.edges).toEqual(b.edges);
  });

  it("mantém o perfil determinístico por viewport", () => {
    expect(
      getNeuralProfile({ width: 390, dpr: 3, reducedMotion: false }).quality,
    ).toBe("mobile");
    expect(
      getNeuralProfile({ width: 1440, dpr: 1, reducedMotion: false }).quality,
    ).toBe("high");
    expect(
      getNeuralProfile({ width: 900, dpr: 2, reducedMotion: true }).quality,
    ).toBe("balanced");
  });

  it("respeita o teto de arestas e densidades no perfil high", () => {
    const profile = getNeuralProfile({
      width: 1440,
      dpr: 1,
      reducedMotion: false,
    });
    const geometry = createLayeredNeuralGeometry(profile);
    expect(geometry.edges.length).toBeLessThanOrEqual(12000);
    expect(geometry.core.points.length).toBe(900);
    expect(geometry.cortex.points.length).toBe(1400);
    expect(geometry.micro.points.length).toBe(1100);
    expect(geometry.stardust.points.length).toBe(3500);
    expect(geometry.stardust.edges.length).toBe(0);
    const total =
      geometry.core.points.length +
      geometry.cortex.points.length +
      geometry.micro.points.length;
    expect(total).toBe(3400);
  });

  it("mantém silhueta esférica com raio máximo fechado", () => {
    const geometry = createLayeredNeuralGeometry(
      getNeuralProfile({ width: 1440, dpr: 1, reducedMotion: false }),
    );
    const layeredMax = Math.max(
      maxRadius(geometry.core.points),
      maxRadius(geometry.cortex.points),
      maxRadius(geometry.micro.points),
    );
    expect(layeredMax).toBeLessThanOrEqual(MAX_LAYER_RADIUS + 0.02);
    expect(maxRadius(geometry.stardust.points)).toBeLessThanOrEqual(1.15);
  });

  it("camadas layered são determinísticas", () => {
    const profile = getNeuralProfile({
      width: 800,
      dpr: 2,
      reducedMotion: false,
    });
    const a = createLayeredNeuralGeometry(profile);
    const b = createLayeredNeuralGeometry(profile);
    expect([...a.core.positions]).toEqual([...b.core.positions]);
    expect([...a.cortex.positions]).toEqual([...b.cortex.positions]);
    expect([...a.micro.positions]).toEqual([...b.micro.positions]);
    expect([...a.stardust.positions]).toEqual([...b.stardust.positions]);
    expect(a.edges).toEqual(b.edges);
  });

  it("perfil mobile/balanced batem contagens densas", () => {
    const mobile = getNeuralProfile({
      width: 390,
      dpr: 3,
      reducedMotion: false,
    });
    expect(mobile.coreCount).toBe(300);
    expect(mobile.cortexCount).toBe(460);
    expect(mobile.microCount).toBe(380);
    expect(mobile.maxEdges).toBe(2600);

    const balanced = getNeuralProfile({
      width: 900,
      dpr: 2,
      reducedMotion: false,
    });
    expect(balanced.coreCount).toBe(600);
    expect(balanced.cortexCount).toBe(900);
    expect(balanced.microCount).toBe(700);
    expect(balanced.maxEdges).toBe(7000);
  });
});
