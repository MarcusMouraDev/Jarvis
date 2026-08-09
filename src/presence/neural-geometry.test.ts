import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEURON_COUNT,
  MAX_EDGES,
  averageDegree,
  createLayeredNeuralGeometry,
  createNeuralGeometry,
  fibonacciSphere,
  getNeuralProfile,
} from "./neural-geometry";

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

  it("respeita o teto de arestas no perfil high", () => {
    const geometry = createLayeredNeuralGeometry(
      getNeuralProfile({ width: 1440, dpr: 1, reducedMotion: false }),
    );
    expect(geometry.edges.length).toBeLessThanOrEqual(3200);
    expect(geometry.core.points.length).toBe(300);
    expect(geometry.cortex.points.length).toBe(560);
    expect(geometry.micro.points.length).toBe(420);
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
    expect(a.edges).toEqual(b.edges);
  });
});
