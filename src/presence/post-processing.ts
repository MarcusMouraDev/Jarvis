import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { EffectsProfile } from "./effects-profile";

export interface CinematicUniforms {
  tDiffuse: { value: THREE.Texture | null };
  uTime: { value: number };
  uAberration: { value: number };
  uGrain: { value: number };
  uVignette: { value: number };
  uScanline: { value: number };
  uResolution: { value: THREE.Vector2 };
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uAberration;
uniform float uGrain;
uniform float uVignette;
uniform float uScanline;
uniform vec2 uResolution;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);

  vec2 shift = centered * r2 * uAberration * 40.0;
  vec4 cr = texture2D(tDiffuse, uv + shift);
  vec4 cg = texture2D(tDiffuse, uv);
  vec4 cb = texture2D(tDiffuse, uv - shift);
  vec4 color = vec4(cr.r, cg.g, cb.b, max(max(cr.a, cg.a), cb.a));

  color.rgb *= 1.0 - uVignette * smoothstep(0.12, 0.72, r2);
  color.rgb *= 1.0 - uScanline * (0.5 + 0.5 * sin(uv.y * uResolution.y * 1.5 + uTime * 2.0));
  color.rgb += (hash(uv * uResolution + uTime * 60.0) - 0.5) * uGrain;

  gl_FragColor = color;
}
`;

export const cinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0 },
    uGrain: { value: 0 },
    uVignette: { value: 0 },
    uScanline: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  } satisfies CinematicUniforms,
  vertexShader,
  fragmentShader,
};

export function applyProfileToUniforms(
  uniforms: CinematicUniforms,
  profile: EffectsProfile,
): void {
  uniforms.uAberration.value = profile.aberration;
  uniforms.uGrain.value = profile.grain;
  uniforms.uVignette.value = profile.vignette;
  uniforms.uScanline.value = profile.scanline;
}

export interface CinematicComposer {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  cinematic: ShaderPass;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function createCinematicComposer(input: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
  profile: EffectsProfile;
}): CinematicComposer {
  const composer = new EffectComposer(input.renderer);
  composer.setSize(input.width, input.height);

  composer.addPass(new RenderPass(input.scene, input.camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(input.width, input.height),
    input.profile.bloomStrength,
    input.profile.bloomRadius,
    input.profile.bloomThreshold,
  );
  bloom.enabled = input.profile.bloomStrength > 0.001;

  const cinematic = new ShaderPass({
    uniforms: THREE.UniformsUtils.clone(cinematicShader.uniforms),
    vertexShader: cinematicShader.vertexShader,
    fragmentShader: cinematicShader.fragmentShader,
  });
  const uniforms = cinematic.uniforms as unknown as CinematicUniforms;
  applyProfileToUniforms(uniforms, input.profile);
  uniforms.uResolution.value.set(input.width, input.height);
  composer.addPass(bloom);
  composer.addPass(cinematic);

  return {
    composer,
    bloom,
    cinematic,
    setSize(width, height) {
      composer.setSize(width, height);
      bloom.setSize(width, height);
      uniforms.uResolution.value.set(width, height);
    },
    dispose() {
      bloom.dispose();
      cinematic.dispose();
      composer.dispose();
    },
  };
}
