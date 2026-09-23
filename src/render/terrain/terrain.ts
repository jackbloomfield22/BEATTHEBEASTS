import * as THREE from 'three';
import { clamp, fbm2, lerp, ridged2, smoothstep } from '../util/noise';
import { coastZ, SEA_LEVEL } from '../world/constants';
import { patchMaterial } from '../sky/atmosphere';
import { NOISE_GLSL } from '../sky/SkyDome';

// The cliff-top promontory the stadium sits on, the sea cliffs, the seabed,
// and distant headlands. Heights are deterministic (seeded noise).

const SEED = 1971;

/** Terrain height at (x, z). The plateau around the stadium is flat at y = 0. */
export function terrainHeight(x: number, z: number): number {
  // Coves and buttresses at several scales keep the cliff line from reading as a wall.
  const cz = coastZ(x) + fbm2(x * 0.008, 3.1, 3, SEED) * 26 + fbm2(x * 0.035, 7.7, 3, SEED + 5) * 9 + ridged2(x * 0.09, 1.3, 2, SEED + 6) * 5;
  // Inland: rolling coastal hills that rise to the north.
  const inland = Math.max(0, -z - 150);
  let land = fbm2(x * 0.004, z * 0.004, 5, SEED + 1) * 22 + smoothstep(0, 900, inland) * 70 * (0.6 + 0.4 * fbm2(x * 0.002, z * 0.002, 3, SEED + 2));
  // Flatten a generous pad for the stadium and its concourse.
  const pad = smoothstep(260, 170, Math.hypot(x * 0.85, (z + 5) * 0.8));
  land = lerp(land, 0, pad);
  land = Math.max(land, lerp(-3, 0, pad));
  // Toward the edge the land rolls off slightly before the cliff.
  const edge = cz - z; // meters from the cliff edge (positive = on land)
  land -= smoothstep(40, 0, edge) * 3;
  // Cliff: a steep upper wall with ledges, then a rubble talus into the sea.
  const ledge = ridged2(x * 0.03, z * 0.03, 4, SEED + 3);
  const wallT = smoothstep(1 + ledge * 4, -9 - ledge * 5, edge);
  const talusTop = SEA_LEVEL + 7 + fbm2(x * 0.05, z * 0.05, 3, SEED + 8) * 4;
  const talus = lerp(talusTop, SEA_LEVEL - 3, smoothstep(-10, -32, edge)) + ridged2(x * 0.08, z * 0.08, 3, SEED + 7) * 3;
  const seabed = Math.min(talus, SEA_LEVEL - 4 - clamp(-edge - 20, 0, 400) * 0.12 - ridged2(x * 0.02, z * 0.02, 3, SEED + 4) * 5);
  const lower = lerp(talus, seabed, smoothstep(-22, -40, edge));
  return lerp(land, lower, wallT);
}

/** Non-uniform grid: dense near the stadium, coarse toward the edges. */
function remap(u: number, half: number): number {
  return Math.sign(u) * Math.pow(Math.abs(u), 1.7) * half;
}

export interface TerrainBuild {
  geometry: THREE.BufferGeometry;
  heightTexture: THREE.DataTexture; // for the ocean: seabed depth and shoreline foam
  heightTextureExtent: number; // half-size in meters covered by heightTexture
}

export function buildTerrain(segments = 360, half = 2600): TerrainBuild {
  const n = segments + 1;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = remap((i / segments) * 2 - 1, half);
      const z = remap((j / segments) * 2 - 1, half) + 120;
      const k = (j * n + i) * 3;
      pos[k] = x;
      pos[k + 1] = terrainHeight(x, z);
      pos[k + 2] = z;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // Height texture for the ocean shader (512² over ±heightExtent).
  const res = 512;
  const heightExtent = 900;
  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res) * 2 * heightExtent - heightExtent;
      const z = ((j + 0.5) / res) * 2 * heightExtent - heightExtent + 300;
      data[j * res + i] = terrainHeight(x, z);
    }
  }
  const heightTexture = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.FloatType);
  heightTexture.minFilter = THREE.LinearFilter;
  heightTexture.magFilter = THREE.LinearFilter;
  heightTexture.wrapS = heightTexture.wrapT = THREE.ClampToEdgeWrapping;
  heightTexture.needsUpdate = true;
  return { geometry, heightTexture, heightTextureExtent: heightExtent };
}

/** Distant headlands and islands that layer into the haze (ref-03 depth). */
export function buildHeadlands(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const specs = [
    { x: -1500, z: 1700, rx: 700, rz: 260, h: 95, seed: 11 },
    { x: -2600, z: 1150, rx: 900, rz: 420, h: 150, seed: 12 },
    { x: 1900, z: 2300, rx: 1100, rz: 380, h: 120, seed: 13 },
    { x: 3400, z: 900, rx: 1300, rz: 700, h: 210, seed: 14 },
    { x: -4200, z: 3200, rx: 1600, rz: 500, h: 180, seed: 15 },
    { x: 600, z: 4200, rx: 900, rz: 300, h: 70, seed: 16 },
  ];
  for (const s of specs) {
    const seg = 64;
    const g = new THREE.PlaneGeometry(s.rx * 2.4, s.rz * 2.4, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i);
      const lz = p.getZ(i);
      const r = Math.hypot(lx / s.rx, lz / s.rz);
      const shape = Math.max(0, 1 - r) ** 0.7;
      const n = 0.65 + 0.35 * fbm2(lx * 0.002, lz * 0.002, 4, s.seed) + ridged2(lx * 0.004, lz * 0.004, 3, s.seed) * 0.3;
      const y = shape > 0 ? SEA_LEVEL - 6 + shape * s.h * n + smoothstep(0, 0.15, shape) * 10 : SEA_LEVEL - 30;
      p.setXYZ(i, lx + s.x, y, lz + s.z);
    }
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geoms) {
    vCount += g.attributes.position!.count;
    iCount += g.index!.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position!.array as Float32Array, vo * 3);
    nor.set(g.attributes.normal!.array as Float32Array, vo * 3);
    const gi = g.index!.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i]! + vo;
    vo += g.attributes.position!.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Terrain shading: slope and height decide rock vs. dry coastal grass vs.
 * sand and wet rock at the waterline, with layered rock strata and noise
 * normals so the cliffs read at broadcast distances.
 */
export function createTerrainMaterial(distant = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.userData.porosity = 0.75; // rock, soil and scrub
  return patchMaterial(
    mat,
    (shader) => {
      shader.uniforms.uDistant = { value: distant ? 1 : 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrWorld;\nvarying vec3 vTerrNormal;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvTerrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrNormal = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vTerrWorld;
          varying vec3 vTerrNormal;
          uniform float uDistant;
          ${NOISE_GLSL}
          vec3 terrAlbedo;
          float terrRough;
          float terrDetail(vec3 w) { vec3 n = normalize(vTerrNormal); vec3 tw = pow(abs(n), vec3(4.0)); tw /= (tw.x + tw.y + tw.z); float a = fbm(vec2(w.z, w.y) * vec2(0.16, 0.07), 5) + 0.35 * fbm(vec2(w.z, w.y) * 0.9, 3); float b = fbm(vec2(w.x, w.y) * vec2(0.16, 0.07), 5) + 0.35 * fbm(vec2(w.x, w.y) * 0.9, 3); float c = fbm(w.xz * 0.35, 4); return a * tw.x + b * tw.z + c * tw.y; }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 w = vTerrWorld;
            vec3 nrm = normalize(vTerrNormal);
            float slope = 1.0 - nrm.y;
            float n1 = fbm(w.xz * 0.05, 5);
            float n2 = fbm(w.xz * 0.6, 3);
            // Fractured cliff rock, triplanar (the two vertical planes blended by
            // the normal) so faces don't smear: joints, bedding, crevices, and
            // pale weathered bands.
            vec3 tw = pow(abs(nrm), vec3(4.0));
            tw /= (tw.x + tw.y + tw.z);
            vec2 pX = vec2(w.z, w.y);
            vec2 pZ = vec2(w.x, w.y);
            float joints = fbm(pX * vec2(0.16, 0.07), 5) * tw.x + fbm(pZ * vec2(0.16, 0.07), 5) * tw.z + fbm(w.xz * 0.12, 5) * tw.y;
            float bedding = fbm(pX * vec2(0.03, 0.35), 4) * tw.x + fbm(pZ * vec2(0.03, 0.35), 4) * tw.z + fbm(w.xz * 0.05, 3) * tw.y;
            float grain = fbm(pX * 0.9, 3) * tw.x + fbm(pZ * 0.9, 3) * tw.z + fbm(w.xz * 0.9, 3) * tw.y;
            float crev = smoothstep(0.4, 0.27, joints) * 0.6 + smoothstep(0.5, 0.33, bedding) * 0.25;
            // Blackcliff is dark volcanic rock (basalt, albedo ~0.06-0.15),
            // paler where it weathers in bands.
            vec3 rockA = vec3(0.05, 0.05, 0.055);
            vec3 rockB = vec3(0.15, 0.14, 0.13);
            vec3 rock = mix(rockA, rockB, smoothstep(0.28, 0.72, joints * 0.55 + bedding * 0.3 + grain * 0.25));
            rock = mix(rock, vec3(0.24, 0.22, 0.2), smoothstep(0.63, 0.82, bedding) * 0.4);
            rock *= (1.0 - crev) * (0.85 + 0.3 * grain);
            // Orange-yellow lichen (Xanthoria) on the sunny upper faces above
            // the spray, gray-green lichen and moss on ledges.
            float hh = w.y - uSeaLevel;
            float lichen = smoothstep(0.66, 0.8, fbm(vec2(w.x + w.z, w.y) * 0.21, 4)) * smoothstep(9.0, 18.0, hh);
            rock = mix(rock, vec3(0.42, 0.26, 0.07), lichen * 0.55);
            rock = mix(rock, vec3(0.16, 0.19, 0.1), smoothstep(0.6, 0.85, fbm(w.xz * 0.2 + w.y * 0.1, 3)) * 0.35);
            // Coastal grass: green in the hollows, drier on the exposed tops.
            vec3 grass = mix(vec3(0.11, 0.19, 0.05), vec3(0.24, 0.27, 0.1), n1);
            grass = mix(grass, vec3(0.07, 0.15, 0.04), smoothstep(0.55, 0.8, n2) * 0.6);
            float rockMask = smoothstep(0.22, 0.42, slope + (n2 - 0.5) * 0.25);
            vec3 col = mix(grass, rock, rockMask);
            // Wet dark rock and pale sand near the waterline.
            float h = w.y - uSeaLevel;
            col = mix(vec3(0.03, 0.03, 0.03), col, smoothstep(0.0, 4.0, h));
            col = mix(col, vec3(0.04, 0.08, 0.035), smoothstep(1.6, 0.3, h) * smoothstep(-0.8, 0.2, h) * 0.8); // algae
            col = mix(col, vec3(0.62, 0.55, 0.43), smoothstep(3.0, 1.0, h) * smoothstep(0.35, 0.1, slope) * smoothstep(-1.0, 0.0, h));
            if (uDistant > 0.5) col = mix(col, vec3(0.2, 0.24, 0.12), 0.35);
            diffuseColor.rgb = col;
            terrRough = mix(0.95, 0.8, rockMask) - smoothstep(2.0, 0.0, h) * 0.5;
          }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = terrRough;')
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            // Procedural bump from world-space noise (screen-space derivatives).
            float hgt = terrDetail(vTerrWorld) * mix(1.0, 0.25, uDistant);
            vec3 dpx = dFdx(vViewPosition);
            vec3 dpy = dFdy(vViewPosition);
            float dhx = dFdx(hgt);
            float dhy = dFdy(hgt);
            vec3 r1 = cross(dpy, normal);
            vec3 r2 = cross(normal, dpx);
            float det = dot(dpx, r1);
            vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
            normal = normalize(abs(det) * normal - grad * 1.6);
          }`,
        );
    },
    distant ? 'terrain-far' : 'terrain',
  );
}

/** Instanced boulders along the cliff foot and on the talus. */
export function buildBoulders(count = 700): { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[] } {
  // Fractured basalt blocks: a sphere cut by a dozen random planes (each
  // vertex pulled in to the nearest cut), then faceted, so the rocks read
  // as broken angular blocks instead of smooth pebbles.
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const cuts: { n: THREE.Vector3; d: number }[] = [];
  let cs = 77;
  const cr = () => ((cs = (cs * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 12; i++) {
    const n = new THREE.Vector3(cr() * 2 - 1, cr() * 2 - 1, cr() * 2 - 1).normalize();
    cuts.push({ n, d: 0.62 + cr() * 0.3 });
  }
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    for (const c of cuts) {
      const k = v.dot(c.n);
      if (k > c.d) v.addScaledVector(c.n, c.d - k);
    }
    v.multiplyScalar(1 + fbm2(v.x * 2.3 + v.z, v.y * 2.3 - v.z, 3, 78) * 0.06);
    v.y *= 0.7;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const faceted = geo.toNonIndexed();
  geo.dispose();
  faceted.computeVertexNormals();
  const rand = (() => {
    let a = 4242;
    return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  const matrices: THREE.Matrix4[] = [];
  let tries = 0;
  while (matrices.length < count && tries < count * 20) {
    tries++;
    const x = (rand() * 2 - 1) * 560;
    const cz = coastZ(x);
    const z = cz + 4 + rand() * 40;
    const y = terrainHeight(x, z);
    if (y > SEA_LEVEL + 9 || y < SEA_LEVEL - 3) continue;
    const s = 1.2 + Math.pow(rand(), 2.2) * 7;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y - s * 0.25, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6)),
      new THREE.Vector3(s * (0.8 + rand() * 0.6), s * (0.7 + rand() * 0.6), s * (0.8 + rand() * 0.6)),
    );
    matrices.push(m);
  }
  return { geometry: faceted, matrices };
}

export function createBoulderMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  mat.userData.porosity = 0.5; // weathered stone
  return patchMaterial(
    mat,
    (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvBWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vBWorld;\n${NOISE_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float n = fbm(vBWorld.xz * 0.4 + vBWorld.y * 0.3, 4);
            vec3 c = mix(vec3(0.05, 0.05, 0.055), vec3(0.17, 0.16, 0.15), n) * (0.8 + 0.4 * fbm(vBWorld.xz * 2.5 + vBWorld.y, 3));
            float wet = smoothstep(uSeaLevel + 2.5, uSeaLevel + 0.2, vBWorld.y);
            c = mix(c, c * 0.35, wet);
            c = mix(c, vec3(0.2, 0.26, 0.12), smoothstep(0.65, 0.8, fbm(vBWorld.xz * 1.3, 3)) * (1.0 - wet) * 0.5);
            diffuseColor.rgb = c;
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            float hgt = fbm(vBWorld.xz * 1.1 + vBWorld.y * 0.9, 5) + 0.4 * fbm(vBWorld.zy * 3.0, 3);
            vec3 dpx = dFdx(vViewPosition);
            vec3 dpy = dFdy(vViewPosition);
            float dhx = dFdx(hgt);
            float dhy = dFdy(hgt);
            vec3 r1 = cross(dpy, normal);
            vec3 r2 = cross(normal, dpx);
            float det = dot(dpx, r1);
            vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
            normal = normalize(abs(det) * normal - grad * 0.5);
          }`,
        );
    },
    'boulder',
  );
}
