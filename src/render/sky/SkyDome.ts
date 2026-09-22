import * as THREE from 'three';
import { ATMOSPHERE_PARS_GLSL, atmosphereUniforms } from './atmosphere';

// The visible sky: atmosphere LUT + sun disc + an animated cloud layer +
// stars and moon at night. Rendered as a camera-centered sphere behind
// everything (depthWrite off).

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    p = r * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}
`;

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.999999, p.w); // just inside the far plane
}
`;

const frag = /* glsl */ `
varying vec3 vDir;
uniform float uTime;
uniform float uCloudCover;
uniform float uCloudStreak;
uniform vec3 uSunDiscColor;
uniform float uNight;
uniform float uIncludeClouds;
${ATMOSPHERE_PARS_GLSL}
${NOISE_GLSL}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyRadiance(d);

  // Sun disc with limb darkening (drawn larger than life, as games do).
  float cosTheta = dot(d, uSunDir);
  float r = 0.0092;
  float x = sqrt(max(0.0, 1.0 - cosTheta * cosTheta)) / r;
  if (cosTheta > 0.0 && x < 1.0) {
    float limb = 0.4 + 0.6 * sqrt(1.0 - x * x);
    col += uSunDiscColor * limb * smoothstep(1.0, 0.92, x);
  }

  // Stars + moon at night.
  if (uNight > 0.0 && d.y > 0.0) {
    vec2 sp = vec2(atan(d.x, d.z) * 180.0, d.y * 400.0);
    float s = hash12(floor(sp));
    float star = step(0.9965, s) * smoothstep(0.0, 0.2, d.y) * (0.6 + 0.4 * sin(uTime * 2.0 + s * 100.0));
    col += vec3(0.8, 0.85, 1.0) * star * 0.25 * uNight;
    vec3 moonDir = normalize(vec3(0.45, 0.32, -0.6));
    float m = dot(d, moonDir);
    col += vec3(0.75, 0.8, 0.9) * smoothstep(0.99985, 0.99992, m) * 1.4 * uNight;
    col += vec3(0.1, 0.12, 0.18) * pow(max(m, 0.0), 400.0) * 0.4 * uNight;
  }

  // Cloud layer on a plane at ~1.8 km, with long streaks at golden hour.
  if (uIncludeClouds > 0.5 && d.y > 0.002 && uCloudCover > 0.0) {
    float t = 1800.0 / d.y;
    vec2 p = d.xz * t;
    vec2 q = p / vec2(mix(2600.0, 9000.0, uCloudStreak), 2600.0) + vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm(q, 6);
    float n2 = fbm(q * 3.1 + 5.0, 4);
    float dens = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.35, n * 0.8 + n2 * 0.25);
    dens *= smoothstep(0.002, 0.08, d.y); // thin out to the horizon
    float mu = dot(d, uSunDir);
    float fwd = pow(max(mu, 0.0), 6.0);
    vec3 base = skyRadiance(normalize(vec3(d.x, 0.25, d.z))) * 0.9;
    vec3 lit = uSunColor * (0.035 + 0.45 * fwd) * (1.0 - 0.55 * dens) + base;
    // Distance haze: far clouds melt into the horizon glow.
    float haze = 1.0 - exp(-t / 45000.0);
    vec3 cloudCol = mix(lit, col, haze);
    col = mix(col, cloudCol, dens * 0.92);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSkyDome(includeClouds = true): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      ...atmosphereUniforms,
      uCloudCover: { value: 0.3 },
      uCloudStreak: { value: 0.7 },
      uSunDiscColor: { value: new THREE.Color() },
      uNight: { value: 0 },
      uIncludeClouds: { value: includeClouds ? 1 : 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
  // Keep shared uniforms shared (spread copies the wrapper objects by reference).
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, material };
}
