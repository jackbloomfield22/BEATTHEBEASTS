import * as THREE from 'three';
import { atmosphereUniforms } from '../sky/atmosphere';
import { burst, type EffectId } from './effects';

// The GPU particle pool: one instanced draw for every effect. Bursts are
// written into a ring buffer (only the touched range is uploaded); the
// vertex shader evaluates the closed-form motion from the spawn state and
// the particle's age, so the CPU does nothing per frame. Particles are
// camera-facing quads, lit by the sky and sun colors (self-lit for sparks),
// fading at the end of life and near the camera. Soft-particle depth fades
// wait for the depth prepass in M5; hit dust stays small until then.

export const POOL_SIZE = 16384;

const VERT = /* glsl */ `
attribute vec4 aPos;   // xyz spawn, w spawn time
attribute vec4 aVel;   // xyz velocity, w life
attribute vec4 aSize;  // start, end, spin, emissive
attribute vec4 aColor; // rgb, alpha
attribute vec2 aPhys;  // gravity, drag
uniform float uTime;
uniform float uViewportH; // drawing-buffer height in pixels
varying vec2 vUv;
varying vec4 vColor;
varying float vEmissive;
varying float vSoft;
void main() {
  vSoft = step(aColor.a, 0.5); // dust and breath: soft round puffs
  float age = uTime - aPos.w;
  float life = aVel.w;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = max(aPhys.y, 1e-4);
  float e = exp(-k * age);
  float f = (1.0 - e) / k;
  vec3 wp = aPos.xyz + aVel.xyz * f;
  wp.y -= (aPhys.x / k) * (age - f);
  float u = age / life;
  float size = mix(aSize.x, aSize.y, u);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // Never smaller than ~1.5 px: a 4 cm confetti square is sub-pixel at
  // stand distances and would vanish. The clamped quad keeps the particle's
  // light output by trading area for alpha (coverage), floored so a cloud
  // of confetti still glitters.
  float px = -mv.z * 2.0 / (projectionMatrix[1][1] * uViewportH);
  float shown = max(size, 1.5 * px);
  float coverage = clamp((size * size) / (shown * shown), 0.3, 1.0);
  size = shown;
  // Confetti flutters: the quad spins about the view axis and squashes.
  float ang = aSize.z * age;
  vec2 corner = (uv - 0.5) * size;
  corner.y *= mix(1.0, abs(cos(ang * 0.7)) + 0.15, step(0.01, abs(aSize.z)));
  corner = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * corner;
  mv.xy += corner;
  gl_Position = projectionMatrix * mv;
  float fadeIn = smoothstep(0.0, 0.06, u);
  float fadeOut = 1.0 - smoothstep(0.7, 1.0, u);
  float near = smoothstep(0.3, 1.2, -mv.z);
  vColor = vec4(aColor.rgb, aColor.a * fadeIn * fadeOut * near * coverage);
  vEmissive = aSize.w;
  vUv = uv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uSun;
varying vec2 vUv;
varying vec4 vColor;
varying float vEmissive;
varying float vSoft;
void main() {
  vec2 c = vUv - 0.5;
  // Round soft puffs for dust and breath (low alpha), crisp squares for
  // confetti and plugs, hot cores for sparks.
  float round = 1.0 - smoothstep(0.25, 0.5, length(c));
  float square = step(max(abs(c.x), abs(c.y)), 0.5);
  float shape = vSoft > 0.5 ? round : mix(square, round, vEmissive);
  float a = vColor.a * shape;
  if (a < 0.01) discard;
  // Lit by sky ambient + sun (diffuse, ~1/π), or self-lit.
  vec3 lit = vColor.rgb * (uSky + uSun / 3.14159);
  vec3 hot = vColor.rgb * 12.0 * (0.6 + 0.4 * round);
  gl_FragColor = vec4(mix(lit, hot, vEmissive), a);
}
`;

export interface ParticlePool {
  mesh: THREE.Mesh;
  /** Spawn an effect now (at the pool's clock). Returns the particle count. */
  emit(id: EffectId, pos: [number, number, number], opts?: { dir?: [number, number, number]; scale?: number; seed?: number; age?: number }): number;
  /** Sky ambient and sun radiance for lighting (from the preset). */
  setLight(sky: THREE.Color, sun: THREE.Color): void;
  /** Drawing-buffer height (px), for the minimum on-screen size. */
  setViewportHeight(h: number): void;
}

export function createParticlePool(size = POOL_SIZE): ParticlePool {
  const plane = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.attributes.position!);
  g.setAttribute('uv', plane.attributes.uv!);
  const mk = (n: number) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(size * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const aPos = mk(4);
  const aVel = mk(4);
  const aSize = mk(4);
  const aColor = mk(4);
  const aPhys = mk(2);
  // Unused slots start dead (spawned in the far past, zero life).
  for (let i = 0; i < size; i++) aPos.setW(i, -1e6);
  g.setAttribute('aPos', aPos);
  g.setAttribute('aVel', aVel);
  g.setAttribute('aSize', aSize);
  g.setAttribute('aColor', aColor);
  g.setAttribute('aPhys', aPhys);
  g.instanceCount = size;
  const uniforms = { uTime: atmosphereUniforms.uTime, uViewportH: { value: 1080 }, uSky: { value: new THREE.Color(0.3, 0.3, 0.3) }, uSun: { value: new THREE.Color(1, 1, 1) } };
  const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.name = 'vfx';

  let head = 0;
  let seq = 1;
  const attrs = [aPos, aVel, aSize, aColor, aPhys];
  return {
    mesh,
    setViewportHeight(h) {
      uniforms.uViewportH.value = h;
    },
    setLight(sky, sun) {
      uniforms.uSky.value.copy(sky);
      uniforms.uSun.value.copy(sun);
    },
    emit(id, pos, opts = {}) {
      const ps = burst(id, pos, opts.seed ?? seq++ * 2654435761, opts.dir, opts.scale);
      // `age` backdates the burst (screenshots of an effect mid-flight).
      const now = atmosphereUniforms.uTime.value - (opts.age ?? 0);
      const start = head;
      for (const p of ps) {
        const i = head;
        aPos.setXYZW(i, p.pos[0], p.pos[1], p.pos[2], now);
        aVel.setXYZW(i, p.vel[0], p.vel[1], p.vel[2], p.life);
        aSize.setXYZW(i, p.size[0], p.size[1], p.spin, p.emissive);
        aColor.setXYZW(i, p.color[0], p.color[1], p.color[2], p.alpha);
        aPhys.setXY(i, p.gravity, p.drag);
        head = (head + 1) % size;
      }
      // Upload only what changed (one range, or two when the ring wraps).
      // Ranges accumulate across bursts in the same frame; three uploads
      // them all and clears the list after the upload.
      for (const a of attrs) {
        if (start + ps.length <= size) a.addUpdateRange(start * a.itemSize, ps.length * a.itemSize);
        else {
          a.addUpdateRange(start * a.itemSize, (size - start) * a.itemSize);
          a.addUpdateRange(0, head * a.itemSize);
        }
        a.needsUpdate = true;
      }
      return ps.length;
    },
  };
}
