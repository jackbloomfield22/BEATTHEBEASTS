import * as THREE from 'three';
import { ATMOSPHERE_PARS_GLSL, atmosphereUniforms } from '../sky/atmosphere';
import { SEA_LEVEL } from '../world/constants';
import { NOISE_GLSL } from '../sky/SkyDome';

// Ocean: Gerstner swell in the vertex shader, two scrolling tileable detail
// normal layers, Fresnel sky reflection from the atmosphere LUT, GGX sun glint
// (the ref-01 glitter path), depth-based color through the shallows at the
// cliff foot (ref-03 turquoise) and shoreline foam.

/** Tileable detail normal map from a sum of integer-wavenumber sine waves. */
function buildDetailNormals(size = 256, seed = 7): THREE.DataTexture {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const waves: { kx: number; ky: number; a: number; ph: number }[] = [];
  for (let i = 0; i < 48; i++) {
    const mag = 1 + Math.floor(rnd() * 22);
    const ang = rnd() * Math.PI * 2;
    const kx = Math.round(Math.cos(ang) * mag);
    const ky = Math.round(Math.sin(ang) * mag);
    if (kx === 0 && ky === 0) continue;
    waves.push({ kx, ky, a: 1 / Math.pow(Math.hypot(kx, ky), 1.35), ph: rnd() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      const u = x / size;
      const v = y / size;
      for (const w of waves) {
        const arg = 2 * Math.PI * (w.kx * u + w.ky * v) + w.ph;
        const c = Math.cos(arg) * w.a * 2 * Math.PI;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const sc = 0.012;
      const n = new THREE.Vector3(-dx * sc, 1, -dy * sc).normalize();
      const k = (y * size + x) * 4;
      data[k] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Gerstner swell: long period, low amplitude (a calm evening sea).
const WAVES = [
  { dir: [0.2, -1.0], len: 95, amp: 0.55, steep: 0.35 },
  { dir: [-0.35, -1.0], len: 61, amp: 0.34, steep: 0.35 },
  { dir: [0.7, -0.8], len: 37, amp: 0.2, steep: 0.4 },
  { dir: [-0.8, -0.5], len: 23, amp: 0.12, steep: 0.45 },
  { dir: [0.1, -1.0], len: 14, amp: 0.07, steep: 0.5 },
  { dir: [0.95, -0.3], len: 9, amp: 0.04, steep: 0.5 },
];

const WAVES_GLSL = WAVES.map((w) => {
  const len = Math.hypot(w.dir[0]!, w.dir[1]!);
  return `vec4(${(w.dir[0]! / len).toFixed(4)}, ${(w.dir[1]! / len).toFixed(4)}, ${w.len.toFixed(2)}, ${w.amp.toFixed(3)})`;
}).join(',\n  ');

const vert = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vWaveNormal;
const int NW = ${WAVES.length};
const vec4 W[NW] = vec4[NW](
  ${WAVES_GLSL}
);
const float STEEP[NW] = float[NW](${WAVES.map((w) => w.steep.toFixed(2)).join(', ')});
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  float dist = length(p.xz - cameraPosition.xz);
  float atten = 1.0 - smoothstep(600.0, 2500.0, dist); // waves fade to flat far away
  vec3 disp = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < NW; i++) {
    vec2 d = W[i].xy;
    float k = 6.2831853 / W[i].z;
    float c = sqrt(9.81 / k);
    float a = W[i].w * atten;
    float f = k * (dot(d, p.xz) - c * uTime);
    float q = STEEP[i];
    disp.x += q * a * d.x * cos(f);
    disp.z += q * a * d.y * cos(f);
    disp.y += a * sin(f);
    n.x -= d.x * k * a * cos(f);
    n.z -= d.y * k * a * cos(f);
    n.y -= q * k * a * sin(f);
  }
  p += disp;
  vWorld = p;
  vWaveNormal = normalize(n);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const frag = /* glsl */ `
uniform float uTime;
uniform sampler2D uDetail;
uniform sampler2D uHeight;
uniform float uHeightExtent;
uniform float uStadiumLights;
varying vec3 vWorld;
varying vec3 vWaveNormal;
${ATMOSPHERE_PARS_GLSL}
${NOISE_GLSL}

vec3 detailNormal(vec2 uv) {
  vec3 t = texture2D(uDetail, uv).xyz * 2.0 - 1.0;
  return vec3(t.x, t.z, t.y);
}

float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * d * d);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);

  // Detail normals: two scales scrolling in different directions, faded out
  // with distance (where they would only alias) into a smoother, rougher sea.
  vec2 uvA = vWorld.xz / 38.0 + vec2(uTime * 0.012, -uTime * 0.021);
  vec2 uvB = vWorld.xz / 11.0 + vec2(-uTime * 0.031, -uTime * 0.017);
  vec2 uvC = vWorld.xz / 170.0 + vec2(uTime * 0.004, -uTime * 0.006);
  float fadeNear = 1.0 - smoothstep(80.0, 900.0, dist);
  vec3 dn = detailNormal(uvA) * 0.9 + detailNormal(uvB) * 0.6 * fadeNear + detailNormal(uvC) * 1.1;
  vec3 N = normalize(vWaveNormal + vec3(dn.x, 0.0, dn.z) * mix(0.35, 0.9, fadeNear));

  // Water depth from the terrain height texture (seabed below the surface).
  vec2 huv = (vWorld.xz - vec2(0.0, 300.0)) / (2.0 * uHeightExtent) + 0.5;
  float bed = (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) ? texture2D(uHeight, huv).r : uSeaLevel - 80.0;
  float depth = max(uSeaLevel - bed, 0.0);

  // Reflection
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.002;
  vec3 refl = skyRadiance(normalize(R));
  float NoV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);

  // Body color: deep blue-green offshore, luminous turquoise over the shallows.
  vec3 skyAmb = skyRadiance(vec3(0.0, 1.0, 0.0));
  float sunUp = clamp(uSunDir.y * 4.0 + 0.2, 0.0, 1.0);
  vec3 deep = vec3(0.004, 0.022, 0.032);
  vec3 shallow = vec3(0.03, 0.2, 0.19);
  float shallowAmt = exp(-depth / 5.5);
  vec3 body = mix(deep, shallow, shallowAmt);
  vec3 scatter = body * (skyAmb * 1.4 + uSunColor * 0.06 * sunUp);
  // Sunlit wave crests glow faintly (subsurface).
  float crest = max(vWaveNormal.x * -uSunDir.x + vWaveNormal.z * -uSunDir.z, 0.0);
  scatter += uSunColor * shallow * crest * 0.02 * sunUp;

  // Sun glint: sharp near, widening with distance into the glitter path.
  vec3 H = normalize(uSunDir + V);
  float rough = mix(0.035, 0.16, smoothstep(50.0, 4000.0, dist));
  float spec = D_GGX(max(dot(N, H), 0.0), rough) * fres;
  vec3 sun = uSunColor * spec * 0.9 * step(0.0, uSunDir.y);

  // Stadium light reflections at night (a soft warm sheen near the cliff).
  vec3 col = mix(scatter, refl, fres) + sun;
  // The floodlit bowl on the cliff: its glow reflects in the water below and
  // around the promontory (a broad warm sheen, strongest at grazing angles),
  // plus scattered light in the water body near the cliff foot.
  float dBowl = length(vWorld.xz - vec2(0.0, 40.0));
  vec3 warm = vec3(1.0, 0.8, 0.58);
  col += warm * uStadiumGlow * (0.22 * exp(-dBowl / 260.0) + 0.05 * exp(-dBowl / 900.0)) * fres;
  col += warm * shallow * uStadiumGlow * 0.12 * exp(-dBowl / 200.0);
  col += warm * uStadiumLights * 0.015 * exp(-dBowl / 180.0) * fres * 4.0 * (1.0 - uStadiumGlow);

  // Shoreline foam where the swell meets rock.
  float foamBand = smoothstep(2.2, 0.0, depth) * step(0.001, depth + 0.5);
  float foamN = fbm(vWorld.xz * 0.35 + vec2(uTime * 0.2, -uTime * 0.3), 4);
  float foam = foamBand * smoothstep(0.35, 0.75, foamN + foamBand * 0.4);
  vec3 foamCol = (skyAmb * 1.2 + uSunColor * 0.08 * sunUp) * 0.9;
  col = mix(col, foamCol, foam * 0.85);

  gl_FragColor = vec4(applyAtmosphere(col, vWorld), 1.0);
}
`;

export function createOcean(heightTexture: THREE.Texture, heightExtent: number): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  // Radial grid: dense rings near the promontory, stretching to the horizon.
  const rings = 150;
  const segs = 256;
  const pos: number[] = [];
  const idx: number[] = [];
  const cx = 0;
  const cz = 150;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = 2 + Math.pow(t, 2.6) * 14000;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * rad, SEA_LEVEL, cz + Math.sin(a) * rad);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * segs + s;
      const b = r * segs + ((s + 1) % segs);
      const c = a + segs;
      const d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      ...atmosphereUniforms,
      uDetail: { value: buildDetailNormals() },
      uHeight: { value: heightTexture },
      uHeightExtent: { value: heightExtent },
      uStadiumLights: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  return { mesh, material };
}
