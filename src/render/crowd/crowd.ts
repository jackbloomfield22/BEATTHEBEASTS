import * as THREE from 'three';
import { atmosphereUniforms, patchMaterial } from '../sky/atmosphere';
import { PROFILE, standPath } from '../stadium/bowl';
import { stadiumUniforms } from '../stadium/materials';
import { CARD_H, CARD_W, CELL_H, CELL_W, DIRS, POSES, type SpectatorAtlas } from './spectator';

// The crowd: one card per seat (two triangles), drawn as a single instanced
// mesh. Each card turns about its vertical axis to face the camera and shows
// the atlas cell for the view angle between the camera and the direction the
// spectator faces, in a pose picked from the crowd energy and time. Colors
// come per spectator from palettes (shirts weighted to Beasts crimson and
// black), lighting from the baked normals, so sun, floodlights, shadows, IBL
// and aerial perspective all land on the crowd like on everything else.

/** Seat pitch along a row (m); typical stadium seat width 0.46–0.56 m. */
const SEAT_PITCH = 0.55;
/** Radial aisles every AISLE_EVERY m of front-edge arc length, AISLE_W wide. */
const AISLE_EVERY = 14.5;
const AISLE_W = 1.1;

function hash(n: number): number {
  // Deterministic integer hash → [0, 1) so the crowd is identical every run.
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export interface Seats {
  /** Per seat: feet position x, y, z and facing angle (radians, facing = (sin, 0, cos)). */
  seat: Float32Array;
  /** Per seat: four independent random numbers in [0, 1). */
  rand: Float32Array;
  count: number;
}

/** Every occupied seat in the bowl, in both tiers. */
export function buildSeats(occupancy = 0.93): Seats {
  const { samples } = standPath(0.3);
  const seat: number[] = [];
  const rand: number[] = [];
  let id = 0;
  for (const tier of PROFILE.seating) {
    for (let r = 0; r < tier.rows; r++) {
      // Feet on the tread, the spectator's hips over its back half.
      const d = tier.d0 + r * tier.tread + tier.tread * 0.55;
      const y = tier.h0 + (r + 1) * tier.riser;
      let acc = 0;
      let next = SEAT_PITCH * 0.5;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!;
        const b = samples[i]!;
        const ax = a.p.x + a.n.x * d;
        const az = a.p.y + a.n.y * d;
        const bx = b.p.x + b.n.x * d;
        const bz = b.p.y + b.n.y * d;
        const L = Math.hypot(bx - ax, bz - az);
        while (next <= acc + L) {
          const t = (next - acc) / L;
          next += SEAT_PITCH;
          const s = a.s + (b.s - a.s) * t; // front-edge arc length: aisles line up radially
          if ((s % AISLE_EVERY) < AISLE_W) continue;
          id++;
          const h0 = hash(id * 4 + 1);
          // Occupancy varies by block (10 rows × one aisle-to-aisle section).
          const block = hash(Math.floor(s / AISLE_EVERY) * 131 + Math.floor(r / 10) * 7 + tier.tier * 977);
          if (h0 > occupancy - 0.08 + block * 0.1) continue;
          const nx = a.n.x + (b.n.x - a.n.x) * t;
          const nz = a.n.y + (b.n.y - a.n.y) * t;
          seat.push(ax + (bx - ax) * t, y, az + (bz - az) * t, Math.atan2(-nx, -nz));
          rand.push(hash(id * 4 + 2), hash(id * 4 + 3), hash(id * 4 + 4), block);
        }
        acc += L;
      }
    }
  }
  return { seat: new Float32Array(seat), rand: new Float32Array(rand), count: seat.length / 4 };
}

const VERT_PARS = /* glsl */ `
attribute vec4 aSeat;
attribute vec4 aRand;
uniform float uTime;
uniform float uCrowdEnergy;
uniform float uLights;
varying vec2 vAtlasUv;
varying vec2 vLocal;
varying vec3 vShirt;
varying vec3 vSkin;
varying vec3 vHair;
varying vec3 vPants;
varying vec3 vRight;
varying vec3 vToCam;
varying vec3 vFlash; // xy: phone position on the card (m), z: on/off
float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
`;

const VERT_BODY = /* glsl */ `
  vec3 base = aSeat.xyz;
  vec2 toC = cameraPosition.xz - base.xz;
  float lc = length(toC);
  toC = lc > 1e-4 ? toC / lc : vec2(0.0, 1.0);
  vec3 C = vec3(toC.x, 0.0, toC.y);
  vec3 R = vec3(C.z, 0.0, -C.x);
  float phi = aSeat.w;
  vec3 F = vec3(sin(phi), 0.0, cos(phi));
  vec3 LX = vec3(cos(phi), 0.0, -sin(phi));
  float ang = atan(dot(C, LX), dot(C, F));
  float cell = mod(floor(ang / (6.2831853 / ${DIRS.toFixed(1)}) + 0.5), ${DIRS.toFixed(1)});

  // Pose: the more energy, the more of the crowd stands; standing fans cycle
  // between standing, arms up and clapping every couple of seconds.
  float e = uCrowdEnergy;
  float block = aRand.w;
  float pose = 0.0;
  float standBias = e * 0.75 + (block - 0.5) * 0.25 * e;
  if (aRand.x < standBias) {
    float slot = floor(uTime * (0.35 + aRand.z * 0.3) + aRand.y * 17.0);
    float hh = h11(slot + aRand.z * 311.0);
    pose = hh < 0.45 * e ? 2.0 : hh < 0.45 * e + 0.35 ? 3.0 : 1.0;
  }
  float bob = pose >= 2.0 ? abs(sin(uTime * (3.2 + aRand.z * 2.5) + aRand.y * 40.0)) * 0.05 * (0.5 + e) : 0.0;
  vAtlasUv = vec2((cell + uv.x) / ${DIRS.toFixed(1)}, (${(POSES - 1).toFixed(1)} - pose + uv.y) / ${POSES.toFixed(1)});
  vLocal = vec2(position.x, position.y);
  vRight = R;
  vToCam = C;

  // Palettes (linear). Shirts weighted to Beasts crimson and black; supporter
  // blocks (block hash) lean harder into crimson.
  float r1 = fract(aRand.y * 7.13 + aRand.z * 3.1);
  float r2 = fract(aRand.x * 11.7 + aRand.y * 5.3);
  float r3 = fract(aRand.z * 13.1 + aRand.x * 2.9);
  float pick = r1 - step(0.8, block) * 0.16;
  vec3 crimson = mix(vec3(0.17, 0.012, 0.018), vec3(0.32, 0.028, 0.036), r2);
  if (pick < 0.28) vShirt = crimson;
  else if (pick < 0.58) vShirt = vec3(0.014 + 0.022 * r2);
  else if (pick < 0.68) vShirt = vec3(0.34 + 0.2 * r2);
  else if (pick < 0.88) vShirt = vec3(0.09 + 0.07 * r2, 0.09 + 0.06 * r2, 0.1 + 0.05 * r2);
  else if (pick < 0.94) vShirt = mix(vec3(0.03, 0.06, 0.16), vec3(0.12, 0.2, 0.36), r2);
  else vShirt = mix(vec3(0.35, 0.24, 0.05), vec3(0.2, 0.3, 0.12), r2);
  vSkin = mix(vec3(0.09, 0.045, 0.025), vec3(0.62, 0.42, 0.31), pow(r3, 0.8));
  float hp = fract(r1 * 5.7 + r3 * 1.9);
  if (hp < 0.14) vHair = pick < 0.28 ? crimson : vec3(0.015); // caps and beanies
  else if (hp < 0.72) vHair = vec3(0.02, 0.014, 0.01);
  else if (hp < 0.86) vHair = vec3(0.1, 0.06, 0.03);
  else if (hp < 0.94) vHair = vec3(0.42, 0.3, 0.14);
  else vHair = vec3(0.35);
  float pp = fract(r2 * 3.3 + r1 * 1.7);
  vPants = pp < 0.55 ? mix(vec3(0.03, 0.045, 0.09), vec3(0.07, 0.1, 0.17), r3) : pp < 0.85 ? vec3(0.02) : vec3(0.22, 0.17, 0.1);

  // Phone flashes after dark, held at the hands for the pose.
  float flashOn = step(0.9985, h11(floor(uTime * 1.3) + aRand.x * 1000.0)) * step(0.5, uLights);
  vec2 phone = pose == 2.0 ? vec2(0.34, 1.96) : pose == 3.0 ? vec2(0.0, 1.32) : pose == 1.0 ? vec2(0.22, 1.45) : vec2(0.18, 1.1);
  vFlash = vec3(phone, flashOn);

  vec3 transformed = base + R * position.x + vec3(0.0, position.y + bob, 0.0);
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D uCrowdMask;
uniform sampler2D uCrowdNormal;
varying vec2 vAtlasUv;
varying vec2 vLocal;
varying vec3 vShirt;
varying vec3 vSkin;
varying vec3 vHair;
varying vec3 vPants;
varying vec3 vRight;
varying vec3 vToCam;
varying vec3 vFlash;
`;

export function createCrowdMaterial(atlas: SpectatorAtlas): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const size = new THREE.Vector2(CELL_W * DIRS, CELL_H * POSES);
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, stadiumUniforms, {
        uTime: atmosphereUniforms.uTime,
        uCrowdMask: { value: atlas.mask },
        uCrowdNormal: { value: atlas.normal },
        uAtlasSize: { value: size },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vec3(cameraPosition.x - aSeat.x, 0.0, cameraPosition.z - aSeat.z) + 1e-5);')
        .replace('#include <begin_vertex>', VERT_BODY);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}\nuniform vec2 uAtlasSize;`)
        .replace(
          '#include <map_fragment>',
          `{
            vec4 mk = texture2D(uCrowdMask, vAtlasUv);
            // Alpha-tested cards lose coverage in the mips; scale alpha up
            // with the mip level so distant spectators keep their size.
            vec2 dx = dFdx(vAtlasUv * uAtlasSize);
            vec2 dy = dFdy(vAtlasUv * uAtlasSize);
            float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
            float a = mk.a * (1.0 + max(lod, 0.0) * 0.3);
            float flash = vFlash.z * (1.0 - smoothstep(0.035, 0.075, length(vLocal - vFlash.xy)));
            if (a < 0.5 && flash < 0.5) discard;
            vec3 m = mk.rgb / max(mk.a, 1e-3);
            float pants = clamp(1.0 - m.r - m.g - m.b, 0.0, 1.0);
            diffuseColor.rgb = m.r * vShirt + m.g * vSkin + m.b * vHair + pants * vPants;
            // Packed crowd: bodies below the shoulders sit in each other's and
            // the row in front's occlusion.
            // Packed shoulder to shoulder, each spectator also sees less sky.
            diffuseColor.rgb *= 0.8 * mix(0.4, 1.0, smoothstep(0.25, 1.35, vLocal.y));
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec4 nk = texture2D(uCrowdNormal, vAtlasUv);
            vec3 nl = normalize(nk.rgb / max(nk.a, 1e-3) * 2.0 - 1.0);
            vec3 nW = normalize(vRight * nl.x + vec3(0.0, 1.0, 0.0) * nl.y + vToCam * nl.z);
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * 8.0 * vFlash.z * (1.0 - smoothstep(0.035, 0.075, length(vLocal - vFlash.xy)));`,
        );
    },
    'crowd',
  );
}

/**
 * Shadow caster: the same cards, turned toward the light (the shadow pass's
 * camera), so each spectator casts the silhouette the light actually sees.
 */
export function createCrowdDepthMaterial(atlas: SpectatorAtlas): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, stadiumUniforms, { uTime: atmosphereUniforms.uTime, uCrowdMask: { value: atlas.mask } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uCrowdMask;\nvarying vec2 vAtlasUv;')
      .replace('#include <alphatest_fragment>', 'if (texture2D(uCrowdMask, vAtlasUv).a < 0.5) discard;');
  };
  mat.customProgramCacheKey = () => 'crowd-depth';
  return mat;
}

/** The instanced crowd mesh (one draw call). */
export function createCrowd(atlas: SpectatorAtlas, seats: Seats = buildSeats()): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(CARD_W, CARD_H);
  plane.translate(0, CARD_H / 2, 0);
  g.index = plane.index;
  g.setAttribute('position', plane.attributes.position!);
  g.setAttribute('normal', plane.attributes.normal!);
  g.setAttribute('uv', plane.attributes.uv!);
  g.setAttribute('aSeat', new THREE.InstancedBufferAttribute(seats.seat, 4));
  g.setAttribute('aRand', new THREE.InstancedBufferAttribute(seats.rand, 4));
  g.instanceCount = seats.count;
  // Cards move in the vertex shader, so bound the whole bowl.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, -5), 130);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-100, 0, -130), new THREE.Vector3(100, 45, 100));
  const mesh = new THREE.Mesh(g, createCrowdMaterial(atlas));
  mesh.name = 'crowd';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.customDepthMaterial = createCrowdDepthMaterial(atlas);
  return mesh;
}
