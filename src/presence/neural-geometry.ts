export interface NeuralPoint {
  x: number;
  y: number;
  z: number;
  phase: number;
}

export interface NeuralEdge {
  a: number;
  b: number;
  phase: number;
}

export interface NeuralGeometry {
  points: NeuralPoint[];
  edges: NeuralEdge[];
  positions: Float32Array;
  phases: Float32Array;
  edgePositions: Float32Array;
  edgePhases: Float32Array;
}

export const DEFAULT_NEURON_COUNT = 220;
export const DEFAULT_NEIGHBORS = 6;
export const MAX_EDGES = 1200;

function hash01(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Fibonacci sphere — deterministic, even coverage. */
export function fibonacciSphere(count: number, radius = 1): NeuralPoint[] {
  const points: NeuralPoint[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    points.push({
      x: x * radius,
      y: y * radius,
      z: z * radius,
      phase: hash01(i + 1),
    });
  }
  return points;
}

function dist2(a: NeuralPoint, b: NeuralPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Build unique undirected edges to `neighbors` nearest points per node. */
export function buildEdges(
  points: NeuralPoint[],
  neighbors = DEFAULT_NEIGHBORS,
  maxEdges = MAX_EDGES,
): NeuralEdge[] {
  const seen = new Set<string>();
  const edges: NeuralEdge[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const scored: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      scored.push({ j, d: dist2(points[i], points[j]) });
    }
    scored.sort((a, b) => a.d - b.d);
    const take = Math.min(neighbors, scored.length);
    for (let k = 0; k < take; k += 1) {
      const j = scored[k].j;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const key = `${lo}-${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        a: lo,
        b: hi,
        phase: hash01(lo * 97 + hi * 13 + 3),
      });
      if (edges.length >= maxEdges) return edges;
    }
  }

  return edges;
}

export function createNeuralGeometry(
  count = DEFAULT_NEURON_COUNT,
  neighbors = DEFAULT_NEIGHBORS,
  radius = 1.15,
): NeuralGeometry {
  const points = fibonacciSphere(count, radius);
  const edges = buildEdges(points, neighbors);

  const positions = new Float32Array(points.length * 3);
  const phases = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 1) {
    positions[i * 3] = points[i].x;
    positions[i * 3 + 1] = points[i].y;
    positions[i * 3 + 2] = points[i].z;
    phases[i] = points[i].phase;
  }

  const edgePositions = new Float32Array(edges.length * 6);
  const edgePhases = new Float32Array(edges.length * 2);
  for (let i = 0; i < edges.length; i += 1) {
    const e = edges[i];
    const a = points[e.a];
    const b = points[e.b];
    const o = i * 6;
    edgePositions[o] = a.x;
    edgePositions[o + 1] = a.y;
    edgePositions[o + 2] = a.z;
    edgePositions[o + 3] = b.x;
    edgePositions[o + 4] = b.y;
    edgePositions[o + 5] = b.z;
    edgePhases[i * 2] = e.phase;
    edgePhases[i * 2 + 1] = e.phase;
  }

  return { points, edges, positions, phases, edgePositions, edgePhases };
}

export function averageDegree(geometry: NeuralGeometry): number {
  if (!geometry.points.length) return 0;
  return (geometry.edges.length * 2) / geometry.points.length;
}
