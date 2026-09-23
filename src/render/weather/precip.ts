import * as THREE from 'three';
import { atmosphereUniforms } from '../sky/atmosphere';
import { stadiumUniforms } from '../stadium/materials';

// Falling rain and snow: a fixed pool of particles in a box that travels with
// the camera (positions wrap inside it), animated entirely in the vertex
// shader from uTime, so there is no per-frame CPU work. Rain drops are thin
// streaks stretched along their velocity (about one frame of motion blur at
// broadcast shutter speeds); snow flakes are soft discs that drift and sway.
// Both are lit by the sky color and brightened by the floodlights inside the
// bowl, and nothing falls under the stand roofs.

/** Particle budget at density 1 (high quality). */
export const PRECIP_COUNT = 24000;
/** The box around the camera (m): wide enough to fill a 40° lens, shallow enough to stay dense. */
const BOX = new THREE.Vector3(70, 40, 70);

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uKind; // 0 rain, 1 snow
uniform float uDensity;
uniform vec3 uBox;
uniform vec2 uWind;
varying vec2 vUv;
varying float vFade;
varying float vLit;
// Same roof footprint as roofCover() in atmosphere.ts.
float roofCoverP(vec3 wp) {
  vec2 p = wp.xz - vec2(0.0, -5.0);
  float r = p.y < 0.0 ? 30.0 : 0.0;
  vec2 q = abs(p) - (vec2(39.0, 65.0) - r);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  return step(14.0, d) * step(d, 52.0) * step(wp.z, 60.0) * step(wp.y, 45.0);
}
void main() {
  vUv = uv;
  // Rain falls ~9 m/s (terminal velocity of 2-5 mm drops), snow ~1 m/s.
  float speed = mix(8.0 + aSeed.w * 2.5, 0.8 + aSeed.w * 0.6, uKind);
  vec3 vel = vec3(uWind.x, -speed, uWind.y);
  vec3 p = aSeed.xyz * uBox + vel * uTime;
  if (uKind > 0.5) {
    // Flakes flutter.
    float ph = aSeed.w * 40.0 + uTime * (0.8 + aSeed.x);
    p.x += sin(ph) * 0.35;
    p.z += cos(ph * 0.8) * 0.35;
  }
  // Wrap into the box centered on the camera.
  vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = cameraPosition + rel;
  float keep = step(aSeed.w, uDensity) * (1.0 - roofCoverP(wp)) * step(-46.0, wp.y);
  // Fade in near the camera (no drops through the lens) and out at the box edge.
  float dist = length(rel);
  // Rain streaks close to the lens are a blur, not bold lines: fade them longer.
  vFade = keep * smoothstep(mix(1.5, 0.6, uKind), mix(7.0, 2.5, uKind), dist) * (1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, dist));
  // Floodlit inside and around the bowl.
  vLit = 1.0 + stadiumLit(wp);

  vec3 toCam = normalize(cameraPosition - wp);
  vec3 axis, side;
  vec2 size;
  if (uKind < 0.5) {
    axis = normalize(vel);
    side = normalize(cross(axis, toCam));
    size = vec2(0.012, speed * 0.05); // ~1/20 s streak
  } else {
    // Camera-facing disc.
    side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + vec3(1e-4, 0.0, 0.0));
    axis = cross(toCam, side);
    size = vec2(0.035 + aSeed.x * 0.03);
  }
  vec3 pos = wp + side * (uv.x - 0.5) * size.x + axis * (uv.y - 0.5) * size.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  if (vFade <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // cull
}
`;

const FRAG = /* glsl */ `
uniform float uKind;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vFade;
varying float vLit;
void main() {
  vec2 c = vUv - 0.5;
  float a;
  if (uKind < 0.5) a = (1.0 - smoothstep(0.0, 0.5, abs(c.x))) * (1.0 - smoothstep(0.3, 0.5, abs(c.y)));
  else a = 1.0 - smoothstep(0.2, 0.5, length(c));
  a *= vFade * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * vLit, a);
}
`;

const STADIUM_LIT_GLSL = /* glsl */ `
uniform float uLights;
float stadiumLit(vec3 wp) {
  float d = length(max(abs(wp.xz - vec2(0.0, -5.0)) - vec2(39.0, 65.0), 0.0));
  return uLights * 2.5 * (1.0 - smoothstep(0.0, 60.0, d)) * smoothstep(-5.0, 10.0, wp.y);
}
`;

export interface Precipitation {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Apply a preset (null = none) and the sky color that lights the particles. */
  set(p: { kind: 'rain' | 'snow'; density: number } | null, sky: THREE.Color): void;
}

export function createPrecipitation(count = PRECIP_COUNT): Precipitation {
  const g = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1);
  g.index = plane.index;
  g.setAttribute('position', plane.attributes.position!);
  g.setAttribute('uv', plane.attributes.uv!);
  const seed = new Float32Array(count * 4);
  // Deterministic seeds (the same storm every run).
  let s = 0x9e3779b9;
  const next = () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0;
    return ((s >>> 0) % 1000003) / 1000003;
  };
  for (let i = 0; i < count * 4; i++) seed[i] = next();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    vertexShader: STADIUM_LIT_GLSL + VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: atmosphereUniforms.uTime,
      uLights: stadiumUniforms.uLights,
      uKind: { value: 0 },
      uDensity: { value: 0 },
      uBox: { value: BOX.clone() },
      uWind: { value: new THREE.Vector2(1.2, 0.6) },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0.3 },
    },
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.name = 'precipitation';
  return {
    mesh,
    material,
    set(p, sky) {
      mesh.visible = !!p && p.density > 0;
      if (!p) return;
      const u = material.uniforms;
      u.uKind!.value = p.kind === 'snow' ? 1 : 0;
      u.uDensity!.value = p.density;
      // Rain reads as faint gray streaks; snow as bright flakes.
      u.uOpacity!.value = p.kind === 'snow' ? 0.85 : 0.22;
      (u.uColor!.value as THREE.Color).copy(sky).multiplyScalar(p.kind === 'snow' ? 1.3 : 1.6);
      (u.uWind!.value as THREE.Vector2).set(p.kind === 'snow' ? 0.6 : 1.4, p.kind === 'snow' ? 0.3 : 0.7);
    },
  };
}
