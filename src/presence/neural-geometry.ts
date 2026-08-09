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

export type NeuralLayer = "core" | "cortex" | "micro";
export type NeuralQuality = "mobile" | "balanced" | "high";

export interface NeuralProfile {
  quality: NeuralQuality;
  coreCount: number;
  cortexCount: number;
  microCount: number;
  neighbors: number;
  maxEdges: number;
}

export interface LayeredNeuralGeometry {
  core: NeuralGeometry;
  cortex: NeuralGeometry;
  micro: NeuralGeometry;
  edges: NeuralEdge[];
}

export const DEFAULT_NEURON_COUNT = 220;
export const DEFAULT_NEIGHBORS = 6;
export const MAX_EDGES = 1200;

const PROFILES: Record<NeuralQuality, Omit<NeuralProfile, "quality">> = {
  // Densidade cinematográfica — volume preenchido, não cascas ocas
  mobile: {
    coreCount: 220,
    cortexCount: 340,
    microCount: 260,
    neighbors: 6,
    maxEdges: 1800,
  },
  balanced: {
    coreCount: 420,
    cortexCount: 680,
    microCount: 520,
    neighbors: 8,
    maxEdges: 5200,
  },
  high: {
    coreCount: 640,
    cortexCount: 980,
    microCount: 780,
    neighbors: 9,
    maxEdges: 9000,
  },
};

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

function packGeometry(
  points: NeuralPoint[],
  edges: NeuralEdge[],
): NeuralGeometry {
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

export function createNeuralGeometry(
  count = DEFAULT_NEURON_COUNT,
  neighbors = DEFAULT_NEIGHBORS,
  radius = 1.15,
): NeuralGeometry {
  const points = fibonacciSphere(count, radius);
  const edges = buildEdges(points, neighbors);
  return packGeometry(points, edges);
}

export function getNeuralProfile(input: {
  width: number;
  dpr: number;
  reducedMotion: boolean;
}): NeuralProfile {
  void input.reducedMotion;
  let quality: NeuralQuality = "balanced";
  // Prefer dense on typical laptop/desktop; mobile only when narrow.
  if (input.width < 640) quality = "mobile";
  else if (input.width >= 1100 && input.dpr <= 2) quality = "high";
  return { quality, ...PROFILES[quality] };
}

/**
 * Volume ball — fills interior (pow bias packs mass toward center like a glowing core).
 * Surface-only shells looked sparse vs the reference neural orb.
 */
function fibonacciVolume(
  count: number,
  rMin: number,
  rMax: number,
  phaseOffset: number,
  centerBias = 0.55,
): NeuralPoint[] {
  const dirs = fibonacciSphere(count, 1);
  return dirs.map((p, i) => {
    const u = hash01(phaseOffset + i * 17 + 3);
    const t = Math.pow(u, centerBias);
    const radius = rMin + (rMax - rMin) * t;
    return {
      x: p.x * radius,
      y: p.y * radius,
      z: p.z * radius,
      phase: hash01(phaseOffset + i + 1),
    };
  });
}

function pointsForLayer(
  layer: NeuralLayer,
  count: number,
  phaseOffset: number,
): NeuralPoint[] {
  if (layer === "core") {
    return fibonacciVolume(count, 0.02, 0.58, phaseOffset, 0.42);
  }
  if (layer === "cortex") {
    return fibonacciVolume(count, 0.48, 0.98, phaseOffset, 0.7);
  }
  // micro: outer filaments + orbital dust
  return fibonacciVolume(count, 0.88, 1.38, phaseOffset, 0.85);
}

export function createLayeredNeuralGeometry(
  profile: NeuralProfile,
): LayeredNeuralGeometry {
  const corePoints = pointsForLayer("core", profile.coreCount, 0);
  const cortexPoints = pointsForLayer("cortex", profile.cortexCount, 10_000);
  const microPoints = pointsForLayer("micro", profile.microCount, 20_000);

  const combined = [...corePoints, ...cortexPoints, ...microPoints];
  const edges = buildEdges(combined, profile.neighbors, profile.maxEdges);

  const coreEnd = corePoints.length;
  const cortexEnd = coreEnd + cortexPoints.length;

  const remapEdge = (e: NeuralEdge, offset: number, localCount: number) => {
    const a = e.a - offset;
    const b = e.b - offset;
    if (a < 0 || b < 0 || a >= localCount || b >= localCount) return null;
    return { a, b, phase: e.phase };
  };

  const coreLocalEdges: NeuralEdge[] = [];
  const cortexLocalEdges: NeuralEdge[] = [];
  const microLocalEdges: NeuralEdge[] = [];

  for (const e of edges) {
    const inCore = e.a < coreEnd && e.b < coreEnd;
    const inCortex =
      e.a >= coreEnd &&
      e.a < cortexEnd &&
      e.b >= coreEnd &&
      e.b < cortexEnd;
    const inMicro = e.a >= cortexEnd && e.b >= cortexEnd;
    if (inCore) {
      const local = remapEdge(e, 0, corePoints.length);
      if (local) coreLocalEdges.push(local);
    } else if (inCortex) {
      const local = remapEdge(e, coreEnd, cortexPoints.length);
      if (local) cortexLocalEdges.push(local);
    } else if (inMicro) {
      const local = remapEdge(e, cortexEnd, microPoints.length);
      if (local) microLocalEdges.push(local);
    }
  }

  return {
    core: packGeometry(corePoints, coreLocalEdges),
    cortex: packGeometry(cortexPoints, cortexLocalEdges),
    micro: packGeometry(microPoints, microLocalEdges),
    edges,
  };
}

export function averageDegree(geometry: NeuralGeometry): number {
  if (!geometry.points.length) return 0;
  return (geometry.edges.length * 2) / geometry.points.length;
}

/** Cross-layer edge buffers for a single lineSegments draw (combined space). */
export function packCombinedEdges(
  layered: LayeredNeuralGeometry,
): { edgePositions: Float32Array; edgePhases: Float32Array } {
  const points = [
    ...layered.core.points,
    ...layered.cortex.points,
    ...layered.micro.points,
  ];
  const edges = layered.edges;
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
  return { edgePositions, edgePhases };
}
