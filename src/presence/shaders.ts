/** Neuron point shaders — soft discs; dense volume reads as synaptic mass. */
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

void main() {
  vPhase = aPhase;
  float radial = length(position);
  vCore = smoothstep(1.1, 0.15, radial);

  float breathe = uReducedMotion > 0.5
    ? 0.4
    : 0.55 + 0.45 * sin(uTime * (1.6 + uPulse + uTurbulence) + aPhase * 6.2831853);
  float audio = uLevel * (0.65 + aPhase * 0.55);
  float gate = smoothstep(
    1.0 - clamp(uActivation, 0.05, 1.0) - 0.15,
    1.0 - clamp(uActivation, 0.05, 1.0) + 0.65,
    aPhase + audio * 0.25 + vCore * 0.2
  );
  vGlow = clamp(0.5 + gate * 0.95 + breathe * 0.4 * max(gate, 0.4) + audio * 0.4 + vCore * 0.55, 0.25, 2.2);

  vec3 pos = position;
  vec3 n = normalize(position + 1e-5);
  float pull = 0.0;
  if (uPointerStrength > 0.001) {
    pull = smoothstep(0.45, 1.0, dot(n, normalize(uPointer)));
    pos += n * pull * uPointerStrength * 0.14;
    vGlow += pull * uPointerStrength * 0.45;
  }
  if (uReducedMotion < 0.5 && uTurbulence > 0.01) {
    pos += n * sin(uTime * (2.4 + aPhase * 4.0) + aPhase * 14.0) * uTurbulence * 0.035;
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (2.2 + vGlow * 6.5 + vCore * 4.0 + pull * uPointerStrength * 4.0) * uPointScale * (300.0 / max(-mv.z, 0.001));
  gl_PointSize = clamp(size, 1.5, 14.0);
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

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;

  float core = smoothstep(0.4, 0.02, d);
  float halo = smoothstep(0.5, 0.12, d) * 0.9;
  float alpha = (core * 1.15 + halo) * clamp(vGlow, 0.3, 2.0) * uLayerOpacity;

  vec3 color = mix(uColorB, uColorA, 0.4 + vPhase * 0.35 + vGlow * 0.3);
  color = mix(color, vec3(1.0, 0.96, 0.9), vCore * 0.55 + core * 0.25);
  color *= 0.75 + vGlow * 0.6;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma), (1.0 - uCoherence) * 0.65);

  gl_FragColor = vec4(color, alpha);
}
`;

/** Synapse line shaders — dense filament web with traveling pulses. */
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

void main() {
  vPhase = aPhase;
  float travel = uReducedMotion > 0.5
    ? fract(aPhase)
    : fract(aPhase + uTime * (0.25 + uPulseTravel * 0.75 + uTurbulence * 0.2) + uLevel * 0.12);
  float dist = abs(aAlong - travel);
  dist = min(dist, 1.0 - dist);
  vPulse = uReducedMotion > 0.5
    ? 0.3
    : exp(-dist * dist * 28.0);

  vPull = 0.0;
  if (uPointerStrength > 0.001) {
    vPull = smoothstep(0.35, 1.0, dot(normalize(position), normalize(uPointer)));
  }

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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

void main() {
  float base = 0.38 + uLinkIntensity * 0.48;
  float alpha = clamp(
    base + vPulse * (0.7 + uLinkIntensity * 0.45) + vPull * uPointerStrength * 0.3,
    0.12,
    0.95
  ) * uLayerOpacity;
  vec3 color = mix(uColorB, uColorA, 0.5 + vPhase * 0.25 + vPulse * 0.35);
  color = mix(color, vec3(1.0, 0.92, 0.82), vPulse * 0.35);
  color *= 0.85 + vPulse * 0.65;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma), (1.0 - uCoherence) * 0.7);
  gl_FragColor = vec4(color, alpha);
}
`;
