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

  // Stars at night: one jittered point per cell of a direction grid, drawn
  // as a soft round dot with a little twinkle, fading into the horizon haze.
  if (uNight > 0.0 && d.y > 0.0) {
    vec3 g = d * 260.0;
    vec3 cell = floor(g);
    float s = hash12(cell.xy + cell.z * 17.13);
    vec3 jitter = vec3(hash12(cell.yz + 3.1), hash12(cell.zx + 7.7), hash12(cell.xy + 1.9));
    float r = length(g - cell - jitter);
    float bright = step(0.93, s) * (0.3 + 3.0 * pow(hash12(cell.xz + 5.3), 6.0));
    float star = bright * smoothstep(0.22, 0.0, r) * smoothstep(0.02, 0.25, d.y) * (0.75 + 0.25 * sin(uTime * 1.7 + s * 90.0));
    // Stars wash out near the moon.
    star *= smoothstep(0.985, 0.9, dot(d, uSunDir));
    col += vec3(0.8, 0.86, 1.0) * star * 0.05 * uNight;
  }

  // Light dome over the floodlit bowl: warm glow low in the sky toward the
  // stadium (everywhere around the horizon when the camera is inside it).
  if (uStadiumGlow > 0.0) {
    vec3 sc = vec3(0.0, 30.0, -10.0) - cameraPosition; // bowl center, above the field
    float dS = length(sc.xz);
    vec3 toS = normalize(vec3(sc.x, sc.y + 40.0 + dS * 0.04, sc.z));
    float lobe = mix(1.0, pow(max(dot(d, toS), 0.0), 5.0), smoothstep(120.0, 600.0, dS));
    float fall = exp(-max(d.y, 0.0) * 3.0) * exp(-dS / 2500.0);
    col += vec3(1.0, 0.78, 0.55) * uStadiumGlow * 0.035 * lobe * fall;
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
