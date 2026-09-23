import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../sky/atmosphere';
import { NOISE_GLSL } from '../sky/SkyDome';
import { fbm2, mulberry32, smoothstep } from '../util/noise';
import { coastZ, SEA_LEVEL } from '../world/constants';
import { terrainHeight } from './terrain';

// Coastal vegetation, all procedural: scrub clumps (the salal, gorse and
// coyote brush of a windswept sea cliff) and wind-sculpted cypress, the
// Monterey cypress silhouette that leans away from the sea. Each plant is a
// cluster of small faceted leaf masses whose normals are bent outward from
// the plant's center, the standard foliage trick that shades a canopy as one
// soft volume while the lumpy silhouette keeps it from reading as a pillow.
// Placement is seeded: the same plants every run.

/** A leaf mass cluster: `n` icosahedra scattered over a squashed dome. */
function leafCluster(rand: () => number, n: number, radius: number, squash: number, lump: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    // Uniform-ish on the upper dome, a little inside the surface.
    const u = rand() * Math.PI * 2;
    const v = Math.acos(1 - rand() * 1.4); // bias to the upper hemisphere
    const r = radius * (0.55 + rand() * 0.4);
    const g = new THREE.IcosahedronGeometry(lump * (0.7 + rand() * 0.6), 0);
    g.translate(Math.sin(v) * Math.cos(u) * r, Math.cos(v) * r * squash, Math.sin(v) * Math.sin(u) * r);
    parts.push(g);
  }
  const m = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return m;
}

/** Bend normals outward from `center` (canopy shading); keeps 30% of the facet normal for texture. */
function canopyNormals(g: THREE.BufferGeometry, center: THREE.Vector3): void {
  g.computeVertexNormals();
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    a.set(p.getX(i), p.getY(i), p.getZ(i)).sub(center).normalize();
    b.set(n.getX(i), n.getY(i), n.getZ(i));
    a.multiplyScalar(0.7).addScaledVector(b, 0.3).normalize();
    n.setXYZ(i, a.x, a.y, a.z);
  }
}

/** Per-vertex part id for the shader: 0 foliage, 1 bark. */
function tagPart(g: THREE.BufferGeometry, id: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const arr = new Float32Array(ng.attributes.position!.count).fill(id);
  ng.setAttribute('part', new THREE.BufferAttribute(arr, 1));
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'part') ng.deleteAttribute(k);
  return ng;
}

/** Scrub clump ~1 m tall, ~2 m wide at scale 1. */
export function buildShrub(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const g = leafCluster(rand, 11, 0.95, 0.6, 0.46);
  canopyNormals(g, new THREE.Vector3(0, -0.2, 0));
  g.translate(0, 0.25, 0);
  return tagPart(g, 0);
}

/**
 * The scrub's far LOD: four larger leaf masses in the same envelope (80
 * triangles against 220). Past ~50 m a clump is a few dozen pixels wide and
 * the lumpy silhouette still reads.
 */
export function buildShrubLod(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const g = leafCluster(rand, 4, 0.8, 0.6, 0.66);
  canopyNormals(g, new THREE.Vector3(0, -0.2, 0));
  g.translate(0, 0.25, 0);
  return tagPart(g, 0);
}

/**
 * Wind-sculpted cypress ~9 m tall at scale 1: a short leaning trunk that
 * splits into limbs, each carrying a flat-topped canopy pad, all swept away
 * from the prevailing sea wind (−z, inland).
 */
export function buildCypress(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const lean = new THREE.Vector3(0, 1, -0.35).normalize();
  const trunkTop = lean.clone().multiplyScalar(4.2);
  const trunk = new THREE.CylinderGeometry(0.28, 0.5, 4.4, 7, 1);
  trunk.translate(0, 2.2, 0);
  trunk.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), lean)));
  trunk.computeVertexNormals();
  parts.push(tagPart(trunk, 1));
  const limbs = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < limbs; i++) {
    const ang = (i / limbs) * Math.PI * 2 + rand() * 0.8;
    const len = 2.2 + rand() * 2.2;
    // Limbs reach sideways and inland; the seaward ones stay short.
    const dir = new THREE.Vector3(Math.cos(ang), 0.55 + rand() * 0.4, Math.sin(ang) - 0.6).normalize();
    if (dir.z > 0) dir.multiplyScalar(0.6);
    const end = trunkTop.clone().addScaledVector(dir, len);
    const limb = new THREE.CylinderGeometry(0.1, 0.2, len, 5, 1);
    limb.translate(0, len / 2, 0);
    limb.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())));
    limb.translate(trunkTop.x, trunkTop.y, trunkTop.z);
    limb.computeVertexNormals();
    parts.push(tagPart(limb, 1));
    // Flat, wind-sheared canopy pad.
    const pad = leafCluster(rand, 16, 2.1 + rand() * 0.8, 0.32, 0.75);
    pad.scale(1, 1, 0.85);
    pad.translate(end.x, end.y + 0.5, end.z - 0.4);
    canopyNormals(pad, new THREE.Vector3(end.x, end.y - 0.8, end.z));
    parts.push(tagPart(pad, 0));
  }
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

export function createVegetationMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  mat.userData.porosity = 0.6;
  return patchMaterial(
    mat,
    (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float part;\nvarying float vPart;\nvarying vec3 vVegWorld;\nvarying vec3 vVegTint;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vPart = part;
          // Wind: foliage sways with height; the pads lag the gusts.
          #ifdef USE_INSTANCING
            vec3 iOrigin = instanceMatrix[3].xyz;
          #else
            vec3 iOrigin = vec3(0.0);
          #endif
          float sway = sin(uTime * 1.3 + iOrigin.x * 0.05 + iOrigin.z * 0.07) * 0.5 + sin(uTime * 3.1 + position.x * 1.7) * 0.15;
          transformed.xz += vec2(0.6, -1.0) * sway * 0.04 * max(position.y, 0.0) * (1.0 - part);`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          #ifdef USE_INSTANCING
            vVegWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vVegWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif
          #ifdef USE_INSTANCING_COLOR
            vVegTint = instanceColor;
          #else
            vVegTint = vec3(1.0);
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vPart;\nvarying vec3 vVegWorld;\nvarying vec3 vVegTint;\n${NOISE_GLSL}\nvec3 vegBack;`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float n = fbm(vVegWorld.xz * 0.9 + vVegWorld.y * 0.7, 3);
            float fine = fbm(vVegWorld.xz * 7.0 + vVegWorld.y * 5.0, 2);
            // Evergreen coastal foliage: deep green, with sun-bleached tips and
            // dark gaps between leaf masses.
            vec3 leaf = mix(vec3(0.025, 0.06, 0.02), vec3(0.08, 0.14, 0.035), n) * vVegTint;
            leaf *= 0.65 + 0.7 * fine;
            vec3 bark = mix(vec3(0.05, 0.04, 0.035), vec3(0.12, 0.1, 0.08), fine);
            diffuseColor.rgb = mix(leaf, bark, step(0.5, vPart));
            vegBack = leaf;
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // Light through the leaves when the sun is behind them (thin foliage transmits ~10-20%).
          float back = pow(max(dot(normalize(vVegWorld - cameraPosition), uSunDir), 0.0), 6.0);
          totalEmissiveRadiance += vegBack * uSunColor * back * 0.06 * (1.0 - step(0.5, vPart));`,
        );
    },
    'vegetation',
  );
}

export interface Scatter {
  shrubs: THREE.Matrix4[];
  cypress: THREE.Matrix4[];
  tints: THREE.Color[][];
}

/** Terrain slope (rise over run) at (x, z) from central differences. */
function slopeAt(x: number, z: number): number {
  const e = 1.5;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

/** Seeded placement on the headland: denser in hollows and along the cliff edge, never on the plaza. */
export function scatterVegetation(shrubCount = 3000, cypressCount = 140): Scatter {
  const rand = mulberry32(90210);
  const shrubs: THREE.Matrix4[] = [];
  const cypress: THREE.Matrix4[] = [];
  const tints: THREE.Color[][] = [[], []];
  const onPlaza = (x: number, z: number) => Math.abs(x) < 128 && Math.abs(z + 10) < 128;
  const place = (list: THREE.Matrix4[], tintList: THREE.Color[], x: number, z: number, s: number, tilt: number) => {
    const y = terrainHeight(x, z);
    list.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y - 0.15 * s, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt)),
        new THREE.Vector3(s * (0.8 + rand() * 0.5), s * (0.7 + rand() * 0.5), s * (0.8 + rand() * 0.5)),
      ),
    );
    tintList.push(new THREE.Color().setHSL(0.24 + (rand() - 0.5) * 0.08, 0.5 + rand() * 0.3, 0.4 + rand() * 0.25).multiplyScalar(2.2));
  };
  let tries = 0;
  while (shrubs.length < shrubCount && tries++ < shrubCount * 30) {
    const x = (rand() * 2 - 1) * 700;
    const z = -650 + rand() * 780;
    const edge = coastZ(x) - z;
    if (edge < 2 || onPlaza(x, z)) continue;
    // Clustered: a patch field, strongest along the cliff edge (salt-spray scrub belt).
    const patch = fbm2(x * 0.012, z * 0.012, 3, 5150) * 0.5 + 0.5;
    const belt = smoothstep(90, 8, edge);
    if (rand() > patch * patch * 1.4 + belt * 0.55) continue;
    if (slopeAt(x, z) > 0.8) continue;
    place(shrubs, tints[0]!, x, z, 0.8 + Math.pow(rand(), 2) * 1.8, 0.25);
  }
  tries = 0;
  while (cypress.length < cypressCount && tries++ < cypressCount * 60) {
    // Groves: sample around a few seeded grove centers on the headland shoulders.
    const g = Math.floor(rand() * 9);
    const gr = mulberry32(700 + g);
    const cx = (gr() * 2 - 1) * 520;
    const cz = Math.min(coastZ(cx) - 30, -120 - gr() * 380);
    const x = cx + (rand() - 0.5) * 120;
    const z = cz + (rand() - 0.5) * 90;
    if (coastZ(x) - z < 12 || onPlaza(x, z) || Math.hypot(x * 0.85, (z + 5) * 0.8) < 200) continue;
    if (slopeAt(x, z) > 0.45 || terrainHeight(x, z) < SEA_LEVEL + 20) continue;
    place(cypress, tints[1]!, x, z, 0.8 + rand() * 0.6, 0.08);
  }
  return { shrubs, cypress, tints };
}

/** Plants on the cliff face's ledges: upward-facing spots on the cliff mesh. */
export function ledgePlants(cliff: THREE.BufferGeometry, count = 1000): { matrices: THREE.Matrix4[]; tints: THREE.Color[] } {
  const p = cliff.attributes.position as THREE.BufferAttribute;
  const n = cliff.attributes.normal as THREE.BufferAttribute;
  const rand = mulberry32(31337);
  const matrices: THREE.Matrix4[] = [];
  const tints: THREE.Color[] = [];
  let tries = 0;
  while (matrices.length < count && tries++ < count * 40) {
    const i = Math.floor(rand() * p.count);
    const ny = n.getY(i);
    const y = p.getY(i);
    // Ledges above the spray zone; more plants higher up where soil holds.
    if (ny < 0.55 || y < SEA_LEVEL + 9) continue;
    if (rand() > smoothstep(SEA_LEVEL + 9, SEA_LEVEL + 30, y) * 0.8 + 0.2) continue;
    const s = 0.4 + Math.pow(rand(), 2) * 1.1;
    matrices.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(p.getX(i), y - 0.1 * s, p.getZ(i)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0)),
        new THREE.Vector3(s, s * 0.7, s),
      ),
    );
    tints.push(new THREE.Color().setHSL(0.22 + (rand() - 0.5) * 0.08, 0.5, 0.45 + rand() * 0.2).multiplyScalar(2.2));
  }
  return { matrices, tints };
}
