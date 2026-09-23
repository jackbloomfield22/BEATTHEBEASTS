import * as THREE from 'three';
import { clamp, fbm2, hash2, ridged2, smoothstep } from '../util/noise';
import { coastZ } from '../world/constants';
import { terrainHeight } from './terrain';

// The sea cliff face. A heightfield can't hold a near-vertical wall (its
// triangles stretch 40 m tall over one grid cell and the rock smears), so the
// wall gets its own mesh: a curtain swept along the coastline, dense in both
// directions, sitting just seaward of the heightfield's wall and displaced
// outward by rock structure. Blackcliff is dark volcanic rock: broad
// buttresses, columnar jointing, bedding ledges that cast shadow lines, and
// fractured blocks. Everything is seeded noise, so the cliff is identical on
// every machine.

const SEED = 4711;
/** Rows per column (top of the talus to the lip); ~0.6 m apart on a 40 m cliff. */
const ROWS = 68;

/** Outward normal of the coastline curve at x (toward the sea). */
function coastNormal(x: number): THREE.Vector2 {
  // coastZ(x) = 104 − 0.00085x² ⇒ dz/dx = −0.0017x; the normal is (−dz/dx, 1).
  return new THREE.Vector2(0.0017 * x, 1).normalize();
}

/** Rock relief in meters (outward from the base surface), from arc length u and height y. */
export function cliffRelief(u: number, y: number): number {
  // Bedding: warped horizontal bands ~3.4 m thick. Each band leans back toward
  // its top and steps out sharply at its base, so every band casts a ledge
  // shadow; how pronounced the bedding is varies along the coast.
  const yw = y + fbm2(u / 45, y / 45, 2, SEED + 3) * 4.5;
  const band = yw / 3.4;
  const f = band - Math.floor(band);
  const strataAmt = 0.5 + 0.5 * smoothstep(-0.2, 0.4, fbm2(u / 140, 0.5, 2, SEED + 4));
  const strata = (1 - f) * (1 - f) * 1.1 * strataAmt;
  // Broad bulges and buttresses (vertical ribs tens of meters apart).
  const big = fbm2(u / 90, y / 60, 3, SEED) * 2.8;
  const butt = (ridged2(u / 26, y / 110, 3, SEED + 1) - 0.35) * 5.5;
  // Columnar joints: narrow vertical prisms.
  const cols = ridged2(u / 3.1, y / 34, 2, SEED + 2) * 0.9;
  // Fractured blocks: each (column, bed) block sits at its own depth, so the
  // wall breaks into stepped faces with sharp joints between them.
  const bu = Math.floor(u / (4.5 + 2 * hash2(Math.floor(band), 7, SEED)));
  const block = (hash2(bu, Math.floor(band), SEED + 5) - 0.5) * 1.1;
  return big + butt + cols + strata + block;
}

export interface CliffBuild {
  geometry: THREE.BufferGeometry;
  /** Columns that carry a real wall (for tests and scatter). */
  wallColumns: number;
}

export function buildCliff(xMax = 900): CliffBuild {
  // Columns along the coast: 0.8 m apart near the stadium, coarser far away.
  const xs: number[] = [];
  for (let x = -xMax; x <= xMax; ) {
    xs.push(x);
    x += 0.8 + smoothstep(220, 700, Math.abs(x)) * 2.2;
  }
  const cols = xs.length;
  const pos = new Float32Array(cols * ROWS * 3);
  const uvs = new Float32Array(cols * ROWS * 2);
  let u = 0;
  let prev: THREE.Vector2 | null = null;
  let wallColumns = 0;
  const S0 = -70;
  const S1 = 90;
  const prof = new Float32Array(S1 - S0 + 1);
  for (let c = 0; c < cols; c++) {
    const x0 = xs[c]!;
    const base = new THREE.Vector2(x0, coastZ(x0));
    const n = coastNormal(x0);
    if (prev) u += base.distanceTo(prev);
    prev = base;
    // Terrain profile along the normal, 1 m steps, landward → seaward.
    for (let s = S0; s <= S1; s++) prof[s - S0] = terrainHeight(base.x + n.x * s, base.y + n.y * s);
    // The wall: from where the drop first steepens past ~40° to where it eases off.
    let top = -1;
    let bot = -1;
    for (let i = 1; i < prof.length; i++) {
      const drop = prof[i - 1]! - prof[i]!;
      if (drop > 0.85) {
        if (top < 0) top = i - 1;
        bot = i;
      }
    }
    const hasWall = top >= 0 && prof[top]! - prof[bot]! > 4;
    if (hasWall) wallColumns++;
    const yTop = hasWall ? prof[top]! + 0.4 : 0;
    const yBot = hasWall ? prof[bot]! - 2 : 0;
    // s at which the profile crosses height y (linear between samples).
    const crossing = (y: number): number => {
      for (let i = Math.max(1, top); i < prof.length; i++) {
        if (prof[i]! <= y) {
          const a = prof[i - 1]!;
          const b = prof[i]!;
          return S0 + i - 1 + clamp((a - y) / Math.max(a - b, 1e-4), 0, 1);
        }
      }
      return S1;
    };
    for (let r = 0; r < ROWS; r++) {
      const k = c * ROWS + r;
      const t = r / (ROWS - 1);
      const y = yBot + (yTop - yBot) * t;
      let px = base.x;
      let pz = base.y;
      if (hasWall) {
        const s = crossing(y);
        // Relief fades out into the lip and into the talus so the curtain
        // meets the heightfield without a seam.
        const h = yTop - yBot;
        const taper = smoothstep(0, 3.5, (1 - t) * h) * smoothstep(0, 3, t * h);
        const out = 0.35 + Math.max(0, 2.2 + cliffRelief(u, y)) * taper;
        px = base.x + n.x * (s + out);
        pz = base.y + n.y * (s + out);
      }
      pos[k * 3] = px;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = pz;
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = y;
    }
  }
  const idx: number[] = [];
  for (let c = 0; c < cols - 1; c++) {
    for (let r = 0; r < ROWS - 1; r++) {
      const a = c * ROWS + r;
      const b = a + ROWS;
      // Faces point seaward (outward normal, +z at the tip).
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, wallColumns };
}
