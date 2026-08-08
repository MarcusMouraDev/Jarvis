/** Neuron point shaders — soft discs with phase-driven activation + pointer pull. */
export const nodeVertexShader = /* glsl */ `
attribute float aPhase;

uniform float uTime;
uniform float uLevel;
uniform float uActivation;
uniform float uPulse;
uniform float uReducedMotion;
uniform vec3 uPointer;
uniform float uPointerStrength;

varying float vGlow;
varying float vPhase;

void main() {
  vPhase = aPhase;
  float breathe = uReducedMotion > 0.5
    ? 0.35
    : 0.55 + 0.45 * sin(uTime * (1.4 + uPulse) + aPhase * 6.2831853);
  float audio = uLevel * (0.65 + aPhase * 0.55);
  float gate = smoothstep(
    1.0 - clamp(uActivation, 0.05, 1.0) - 0.2,
    1.0 - clamp(uActivation, 0.05, 1.0) + 0.55,
    aPhase + audio * 0.3
  );
  vGlow = clamp(0.45 + gate * 0.85 + breathe * 0.35 * max(gate, 0.35) + audio * 0.45, 0.2, 1.8);

  vec3 pos = position;
  vec3 n = normalize(position);
  float pull = 0.0;
  if (uPointerStrength > 0.001) {
    pull = smoothstep(0.45, 1.0, dot(n, normalize(uPointer)));
    pos += n * pull * uPointerStrength * 0.18;
    vGlow += pull * uPointerStrength * 0.55;
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (5.5 + vGlow * 14.0 + pull * uPointerStrength * 8.0) * (320.0 / max(-mv.z, 0.001));
  gl_PointSize = clamp(size, 3.0, 40.0);
}
`;

export const nodeFragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uCoherence;

varying float vGlow;
varying float vPhase;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;

  float core = smoothstep(0.42, 0.04, d);
  float halo = smoothstep(0.5, 0.14, d) * 0.85;
  float ring = smoothstep(0.28, 0.16, d) * smoothstep(0.08, 0.18, d) * 0.55;
  float alpha = (core + halo + ring) * clamp(vGlow, 0.25, 1.85);

  vec3 color = mix(uColorB, uColorA, 0.35 + vPhase * 0.4 + vGlow * 0.35);
  color *= 0.8 + vGlow * 0.55;
  color = mix(color, uColorA, core * 0.35);
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma), (1.0 - uCoherence) * 0.7);

  gl_FragColor = vec4(color, alpha);
}
`;

/** Synapse line shaders — visible links with traveling pulse + pointer boost. */
export const linkVertexShader = /* glsl */ `
attribute float aPhase;
attribute float aAlong;

uniform float uTime;
uniform float uPulseTravel;
uniform float uLevel;
uniform float uReducedMotion;
uniform vec3 uPointer;
uniform float uPointerStrength;

varying float vPulse;
varying float vPhase;
varying float vPull;

void main() {
  vPhase = aPhase;
  float travel = uReducedMotion > 0.5
    ? fract(aPhase)
    : fract(aPhase + uTime * (0.2 + uPulseTravel * 0.65) + uLevel * 0.1);
  float dist = abs(aAlong - travel);
  dist = min(dist, 1.0 - dist);
  vPulse = uReducedMotion > 0.5
    ? 0.25
    : exp(-dist * dist * 36.0);

  vPull = 0.0;
  if (uPointerStrength > 0.001) {
    vPull = smoothstep(0.4, 1.0, dot(normalize(position), normalize(uPointer)));
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

varying float vPulse;
varying float vPhase;
varying float vPull;

void main() {
  float base = 0.22 + uLinkIntensity * 0.38;
  float alpha = clamp(
    base + vPulse * (0.65 + uLinkIntensity * 0.5) + vPull * uPointerStrength * 0.35,
    0.08,
    0.98
  );
  vec3 color = mix(uColorB, uColorA, 0.45 + vPhase * 0.3 + vPulse * 0.4);
  color *= 0.9 + vPulse * 0.55 + vPull * uPointerStrength * 0.35;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma), (1.0 - uCoherence) * 0.75);
  alpha *= mix(0.35 + step(0.55, fract(vPhase * 7.3)) * 0.65, 1.0, uCoherence);
  gl_FragColor = vec4(color, alpha);
}
`;
