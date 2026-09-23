import * as THREE from 'three';
import type { LightingPreset } from '../lighting/presets';
import { SEA_LEVEL } from '../world/constants';

// Physically based single-scattering atmosphere (Rayleigh + Mie + ozone),
// after Hillaire 2020 in spirit: the sky radiance for every view direction is
// integrated once per lighting preset into an equirectangular LUT (with extra
// resolution at the horizon). The sky dome, the aerial perspective on every
// material, the ocean reflections and the IBL all read that one LUT, so the
// sky, the haze and the lighting always agree.

export const EARTH_RADIUS = 6360e3;
export const ATMOSPHERE_RADIUS = 6420e3;
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];
const H_R = 8000;
const BETA_M_SCA = 3.996e-6;
const BETA_M_EXT = 4.4e-6;
const H_M = 1200;
const BETA_O = [0.65e-6, 1.881e-6, 0.085e-6];

/** Viewer altitude above sea level used for the LUT (roughly the cliff top). */
export const VIEW_ALTITUDE = -SEA_LEVEL + 20;

export function sunDirection(p: LightingPreset): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(p.sunElevationDeg);
  const az = THREE.MathUtils.degToRad(p.sunAzimuthOffAxisDeg);
  // Azimuth from +Z toward -X.
  return new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

function raySphereFar(oy: number, dy: number, dxz: number, r: number): number {
  // Origin at (0, oy, 0), direction (dxz, dy) in a 2D slice. Returns far hit or -1.
  const b = oy * dy;
  const c = oy * oy - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  void dxz;
  return -b + Math.sqrt(disc);
}

/** Sun radiance transmittance from the top of the atmosphere to the viewer (CPU, matches the GPU LUT). */
export function sunTransmittance(p: LightingPreset): THREE.Color {
  const dir = sunDirection(p);
  const oy = EARTH_RADIUS + VIEW_ALTITUDE;
  const mu = dir.y;
  // Ground occlusion (sun below the horizon)
  const bGround = oy * mu;
  const cGround = oy * oy - EARTH_RADIUS * EARTH_RADIUS;
  if (mu < 0 && bGround * bGround - cGround > 0) {
    const t = -bGround - Math.sqrt(bGround * bGround - cGround);
    if (t > 0) return new THREE.Color(0, 0, 0);
  }
  const tMax = raySphereFar(oy, mu, Math.sqrt(1 - mu * mu), ATMOSPHERE_RADIUS);
  const N = 256;
  const od = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N) * tMax;
    const y = oy + mu * t;
    const x = Math.sqrt(1 - mu * mu) * t;
    const h = Math.sqrt(x * x + y * y) - EARTH_RADIUS;
    const dR = Math.exp(-h / H_R);
    const dM = Math.exp(-h / H_M);
    const dO = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
    for (let c = 0; c < 3; c++) od[c]! += (BETA_R[c]! * dR + BETA_M_EXT * p.mieScale * dM + BETA_O[c]! * dO) * (tMax / N);
  }
  return new THREE.Color(Math.exp(-od[0]!), Math.exp(-od[1]!), Math.exp(-od[2]!));
}

// ---------------------------------------------------------------------------
// Shared GLSL
// ---------------------------------------------------------------------------

/** Equirect mapping with sqrt latitude remap: more texels near the horizon. */
export const SKY_UV_GLSL = /* glsl */ `
vec2 skyUV(vec3 d) {
  float az = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(lat) * sqrt(abs(lat) / 1.5707963);
  return vec2(az / 6.2831853 + 0.5, v);
}
`;

export const ATMOSPHERE_PARS_GLSL = /* glsl */ `
uniform sampler2D uSkyLUT;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBrightness;
uniform float uSeaLevel;
uniform float uStadiumGlow;
${SKY_UV_GLSL}
// Warm light from the floodlights scattered in the haze around the bowl
// (night and storm presets). Radiance added to the fog color near the stadium.
vec3 stadiumHaze(vec3 wp) {
  float d = length(wp.xz - vec2(0.0, -10.0));
  float h = max(wp.y - uSeaLevel, 0.0);
  return vec3(1.0, 0.8, 0.58) * uStadiumGlow * 0.05 * exp(-d / 420.0) * exp(-h / 260.0);
}
vec3 skyRadiance(vec3 d) { return texture2D(uSkyLUT, skyUV(d)).rgb; }

// Aerial perspective: exponential height fog, analytically integrated along
// the view ray, colored by the sky just above the horizon in the view
// direction plus a forward-scattering glow toward the sun.
vec3 applyAtmosphere(vec3 col, vec3 wp) {
  vec3 v = wp - cameraPosition;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-3);
  float h0 = max(cameraPosition.y - uSeaLevel, 0.0);
  float h1 = max(wp.y - uSeaLevel, 0.0);
  float k = uFogFalloff;
  float dh = h1 - h0;
  float heightTerm = abs(dh) > 0.5 ? (exp(-k * h0) - exp(-k * h1)) / (k * dh) : exp(-k * h0);
  float optical = uFogDensity * dist * heightTerm;
  float f = 1.0 - exp(-optical);
  vec3 dh3 = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.35 + 0.015, dir.z));
  vec3 sky = skyRadiance(dh3);
  float mu = max(dot(dir, uSunDir), 0.0);
  vec3 glow = uSunColor * (pow(mu, 12.0) * 0.06 + pow(mu, 3.0) * 0.015);
  return mix(col, (sky + glow + stadiumHaze(mix(cameraPosition, wp, 0.5))) * uFogBrightness, f);
}
`;

export const atmosphereUniforms = {
  uSkyLUT: { value: null as THREE.Texture | null },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uFogDensity: { value: 0.0001 },
  uFogFalloff: { value: 0.004 },
  uFogBrightness: { value: 1 },
  uSeaLevel: { value: SEA_LEVEL },
  uStadiumGlow: { value: 0 },
  uTime: { value: 0 },
};

type ShaderLike = THREE.WebGLProgramParametersWithUniforms;

/**
 * Adds aerial perspective to a built-in three material (replacing its fog
 * chunk) and optionally applies further shader edits. Uniforms are shared
 * references, so preset changes reach every material at once.
 */
export function patchMaterial<T extends THREE.Material>(mat: T, extra?: (shader: ShaderLike) => void, cacheKey = ''): T {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmosphereUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmoWorldPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vAtmoWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vAtmoWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vAtmoWorldPos;\n${ATMOSPHERE_PARS_GLSL}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vAtmoWorldPos);');
    extra?.(shader);
  };
  mat.customProgramCacheKey = () => 'atmo:' + cacheKey;
  return mat;
}

// ---------------------------------------------------------------------------
// LUT generation
// ---------------------------------------------------------------------------

const LUT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uSunDir;
uniform float uMieScale;
uniform float uSunIlluminance;
uniform float uViewAlt;
uniform vec3 uTint;
const float Rg = ${EARTH_RADIUS.toFixed(1)};
const float Rt = ${ATMOSPHERE_RADIUS.toFixed(1)};
const vec3 betaR = vec3(${BETA_R.map((b) => b.toExponential(4)).join(',')});
const vec3 betaO = vec3(${BETA_O.map((b) => b.toExponential(4)).join(',')});
const float betaMs = ${BETA_M_SCA.toExponential(4)};
const float betaMe = ${BETA_M_EXT.toExponential(4)};

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}
vec3 extinction(float h) {
  float dR = exp(-h / ${H_R.toFixed(1)});
  float dM = exp(-h / ${H_M.toFixed(1)});
  float dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
  return betaR * dR + vec3(betaMe * uMieScale * dM) + betaO * dO;
}
vec3 sunTransmittance(vec3 p) {
  vec3 up = normalize(p);
  // Earth shadow
  vec2 g = raySphere(p, uSunDir, Rg);
  if (g.x > 0.0) return vec3(0.0);
  float tMax = raySphere(p, uSunDir, Rt).y;
  vec3 od = vec3(0.0);
  const int N = 10;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N) * tMax;
    vec3 q = p + uSunDir * t;
    od += extinction(length(q) - Rg) * (tMax / float(N));
  }
  return exp(-od);
}
void main() {
  float az = (vUv.x - 0.5) * 6.2831853;
  float vv = vUv.y - 0.5;
  float lat = sign(vv) * (2.0 * abs(vv)) * (2.0 * abs(vv)) * 1.5707963;
  vec3 rd = vec3(sin(az) * cos(lat), sin(lat), cos(az) * cos(lat));
  vec3 ro = vec3(0.0, Rg + uViewAlt, 0.0);
  vec2 top = raySphere(ro, rd, Rt);
  vec2 gnd = raySphere(ro, rd, Rg);
  float tMax = top.y;
  if (gnd.x > 0.0) tMax = gnd.x;
  float mu = dot(rd, uSunDir);
  float phaseR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
  float g = 0.8;
  float phaseM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  const int N = 40;
  float tPrev = 0.0;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 0.5) / float(N);
    float t = tMax * f * f;
    float dt = t - tPrev;
    tPrev = t;
    vec3 p = ro + rd * t;
    float h = length(p) - Rg;
    float dR = exp(-h / ${H_R.toFixed(1)});
    float dM = exp(-h / ${H_M.toFixed(1)});
    vec3 ext = extinction(h);
    vec3 Ts = sunTransmittance(p);
    vec3 scat = betaR * dR * phaseR + vec3(betaMs * uMieScale * dM * phaseM);
    // Cheap multiple-scattering term: isotropic, keeps shadowed sky from going black.
    vec3 ms = (betaR * dR + vec3(betaMs * uMieScale * dM)) * 0.012;
    vec3 stepT = exp(-ext * dt);
    vec3 inS = (scat * Ts + ms * (Ts * 0.5 + 0.02)) ;
    L += T * (inS - inS * stepT) / max(ext, vec3(1e-9));
    T *= stepT;
  }
  gl_FragColor = vec4(L * uSunIlluminance * uTint, 1.0);
}
`;

export class SkyLUT {
  readonly target: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(width = 512, height = 256) {
    this.target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: LUT_FRAG,
      uniforms: {
        uSunDir: { value: new THREE.Vector3() },
        uMieScale: { value: 1 },
        uSunIlluminance: { value: 20 },
        uViewAlt: { value: VIEW_ALTITUDE },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  render(gl: THREE.WebGLRenderer, p: LightingPreset): void {
    const u = this.mat.uniforms;
    u.uSunDir!.value.copy(sunDirection(p));
    u.uMieScale!.value = p.mieScale;
    u.uSunIlluminance!.value = p.sunIlluminance;
    u.uTint!.value.set(...(p.keyTint ?? [1, 1, 1]));
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(this.target);
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(prev);
  }

  dispose(): void {
    this.target.dispose();
    this.mat.dispose();
  }
}
