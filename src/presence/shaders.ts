/** Neuron point shaders — dense synaptic mass, depth + rim, controlled bloom. */
export const nodeVertexShader = /* glsl */ `
attribute float aPhase;

uniform float uTime;
uniform float uLevel;
uniform float uActivation;
uniform float uPulse;
uniform float uReducedMotion;
uniform vec3 uPointer;
uniform float uPointerStrength;
uniform float uPointScale;
uniform float uTurbulence;

varying float vGlow;
varying float vPhase;
varying float vCore;
varying float vDepth;
varying float vRim;

void main() {
  vPhase = aPhase;
  float radial = length(position);
  // núcleo quente estreito — não lava a esfera toda
  vCore = smoothstep(0.55, 0.08, radial);
  // rim accent — define contorno da esfera sem aro sólido
  vRim = smoothstep(0.88, 0.98, radial) * (1.0 - smoothstep(1.05, 1.18, radial));

  float breathe = uReducedMotion > 0.5
    ? 0.35
    : 0.5 + 0.35 * sin(uTime * (1.35 + uPulse * 0.8 + uTurbulence * 0.5) + aPhase * 6.2831853);
  float audio = uLevel * (0.5 + aPhase * 0.4);
  float gate = smoothstep(
    1.0 - clamp(uActivation, 0.05, 1.0) - 0.18,
    1.0 - clamp(uActivation, 0.05, 1.0) + 0.55,
    aPhase + audio * 0.2 + vCore * 0.15
  );
  vGlow = clamp(0.4 + gate * 0.7 + breathe * 0.28 * max(gate, 0.35) + audio * 0.28 + vCore * 0.35, 0.2, 1.45);

  vec3 pos = position;
  vec3 n = normalize(position + 1e-5);
  float pull = 0.0;
  if (uPointerStrength > 0.001) {
    pull = smoothstep(0.45, 1.0, dot(n, normalize(uPointer)));
    pos += n * pull * uPointerStrength * 0.08;
    vGlow += pull * uPointerStrength * 0.28;
  }
  if (uReducedMotion < 0.5 && uTurbulence > 0.01) {
    pos += n * sin(uTime * (2.0 + aPhase * 3.2) + aPhase * 12.0) * uTurbulence * 0.018;
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  // profundidade: pontos atrás do centro menores/mais fracos
  vDepth = clamp(0.55 + (-mv.z) * 0.12, 0.45, 1.15);
  gl_Position = projectionMatrix * mv;
  float size = (1.9 + vGlow * 5.2 + vCore * 2.8 + vRim * 1.4 + pull * uPointerStrength * 3.0)
    * uPointScale * vDepth * (300.0 / max(-mv.z, 0.001));
  gl_PointSize = clamp(size, 1.2, 11.0);
}
`;

export const nodeFragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uCoherence;
uniform float uLayerOpacity;

varying float vGlow;
varying float vPhase;
varying float vCore;
varying float vDepth;
varying float vRim;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;

  float core = smoothstep(0.38, 0.03, d);
  float halo = smoothstep(0.5, 0.16, d) * 0.65;
  float glow = clamp(vGlow * mix(0.72, 1.08, vDepth) + vRim * 0.22, 0.2, 1.45);
  float alpha = (core * 0.95 + halo) * glow * uLayerOpacity * 0.85;

  vec3 color = mix(uColorB, uColorA, 0.35 + vPhase * 0.3 + vGlow * 0.22);
  // highlight derivado do estado — gelo no azul, quente no âmbar
  vec3 hot = mix(uColorA, vec3(1.0), 0.75);
  color = mix(color, hot, vCore * 0.28 + core * 0.12);
  color = mix(color, uColorA, vRim * 0.18);
  color *= (0.72 + vGlow * 0.38) * mix(0.75, 1.05, vDepth);
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma), (1.0 - uCoherence) * 0.6);

  gl_FragColor = vec4(color, alpha);
}
`;

/** Synapse filaments — dense but not overexposed; depth-aware. */
export const linkVertexShader = /* glsl */ `
attribute float aPhase;
attribute float aAlong;

uniform float uTime;
uniform float uPulseTravel;
uniform float uLevel;
uniform float uReducedMotion;
uniform vec3 uPointer;
uniform float uPointerStrength;
uniform float uTurbulence;

varying float vPulse;
varying float vPhase;
varying float vPull;
varying float vDepth;
varying float vRim;

void main() {
  vPhase = aPhase;
  float radial = length(position);
  vRim = smoothstep(0.88, 0.98, radial) * (1.0 - smoothstep(1.05, 1.18, radial));

  float travel = uReducedMotion > 0.5
    ? fract(aPhase)
    : fract(aPhase + uTime * (0.2 + uPulseTravel * 0.55 + uTurbulence * 0.12) + uLevel * 0.08);
  float dist = abs(aAlong - travel);
  dist = min(dist, 1.0 - dist);
  vPulse = uReducedMotion > 0.5
    ? 0.22
    : exp(-dist * dist * 32.0);

  vPull = 0.0;
  if (uPointerStrength > 0.001) {
    vPull = smoothstep(0.35, 1.0, dot(normalize(position + 1e-5), normalize(uPointer)));
  }

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = clamp(0.55 + (-mv.z) * 0.12, 0.45, 1.15);
  gl_Position = projectionMatrix * mv;
}
`;

export const linkFragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uCoherence;
uniform float uLinkIntensity;
uniform float uPointerStrength;
uniform float uLayerOpacity;

varying float vPulse;
varying float vPhase;
varying float vPull;
varying float vDepth;
varying float vRim;

void main() {
  float base = 0.22 + uLinkIntensity * 0.32;
  float alpha = clamp(
    base + vPulse * (0.45 + uLinkIntensity * 0.28) + vPull * uPointerStrength * 0.18 + vRim * 0.08,
    0.08,
    0.72
  ) * uLayerOpacity * 0.9 * mix(0.7, 1.05, vDepth);
  vec3 color = mix(uColorB, uColorA, 0.42 + vPhase * 0.22 + vPulse * 0.22);
  vec3 hot = mix(uColorA, vec3(1.0), 0.75);
  color = mix(color, hot, vPulse * 0.18);
  color *= (0.78 + vPulse * 0.35) * mix(0.78, 1.05, vDepth);
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma), (1.0 - uCoherence) * 0.65);
  gl_FragColor = vec4(color, alpha);
}
`;
