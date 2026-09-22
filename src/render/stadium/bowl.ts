import * as THREE from 'three';
import { STAND } from '../world/constants';

// Procedural stadium bowl (milestone 1 blockout at final proportions): a U of
// stands open to the south, swept from a stepped cross-section profile along
// the stand path. Separate geometries per material: seating (crowd shader),
// concrete, glass band, roof.

export interface PathSample {
  p: THREE.Vector2; // (x, z) on the front edge
  n: THREE.Vector2; // outward normal (away from the field)
  s: number; // arc length
}

/** The U: west sideline (south→north), NW corner, north end, NE corner, east sideline (north→south). */
export function standPath(step = 1.5): { samples: PathSample[]; length: number } {
  const { halfWidth: X, northZ: ZN, southZ: ZS, cornerRadius: R } = STAND;
  const segs: ((t: number) => { p: [number, number]; n: [number, number] })[] = [];
  const lens: number[] = [];
  // West straight: from (-X, ZS) to (-X, ZN + R)
  segs.push((t) => ({ p: [-X, ZS + (ZN + R - ZS) * t], n: [-1, 0] }));
  lens.push(ZS - (ZN + R));
  // NW corner: center (-X + R, ZN + R), angle π → 3π/2
  segs.push((t) => {
    const a = Math.PI + (Math.PI / 2) * t;
    return { p: [-X + R + Math.cos(a) * R, ZN + R + Math.sin(a) * R], n: [Math.cos(a), Math.sin(a)] };
  });
  lens.push((Math.PI / 2) * R);
  // North straight
  segs.push((t) => ({ p: [-X + R + (2 * X - 2 * R) * t, ZN], n: [0, -1] }));
  lens.push(2 * X - 2 * R);
  // NE corner: center (X - R, ZN + R), angle 3π/2 → 2π
  segs.push((t) => {
    const a = 1.5 * Math.PI + (Math.PI / 2) * t;
    return { p: [X - R + Math.cos(a) * R, ZN + R + Math.sin(a) * R], n: [Math.cos(a), Math.sin(a)] };
  });
  lens.push((Math.PI / 2) * R);
  // East straight
  segs.push((t) => ({ p: [X, ZN + R + (ZS - (ZN + R)) * t], n: [1, 0] }));
  lens.push(ZS - (ZN + R));

  const total = lens.reduce((a, b) => a + b, 0);
  const samples: PathSample[] = [];
  let acc = 0;
  segs.forEach((f, i) => {
    const L = lens[i]!;
    const n = Math.max(2, Math.ceil(L / step));
    for (let k = 0; k <= n; k++) {
      if (i > 0 && k === 0) continue; // shared joint
      const t = k / n;
      const r = f(t);
      samples.push({ p: new THREE.Vector2(r.p[0], r.p[1]), n: new THREE.Vector2(r.n[0], r.n[1]), s: acc + t * L });
    }
    acc += L;
  });
  return { samples, length: total };
}

/** Cross-section: distance back from the front edge (d) and height (h), meters. */
export interface Profile {
  seating: { d0: number; h0: number; rows: number; tread: number; riser: number; tier: number }[];
  concourse: { d0: number; d1: number; h: number; fasciaTop: number };
  backD: number;
  topH: number;
  roof: { dBack: number; hBack: number; dFront: number; hFront: number; thick: number };
}

export const PROFILE: Profile = {
  seating: [
    { d0: 0.6, h0: 2.3, rows: 26, tread: 0.86, riser: 0.43, tier: 0 },
    { d0: 26.4, h0: 17.2, rows: 30, tread: 0.8, riser: 0.54, tier: 1 },
  ],
  concourse: { d0: 22.96, d1: 26.4, h: 13.48, fasciaTop: 17.2 },
  backD: 50.8,
  topH: 36,
  roof: { dBack: 51.5, hBack: 43, dFront: 14, hFront: 47.5, thick: 1.6 },
};

interface GeoBuilder {
  pos: number[];
  nor: number[];
  uv: number[];
  aux: number[]; // x: row index (seating) / part id; y: tier; z: face (0 tread, 1 riser)
  idx: number[];
}
const newBuilder = (): GeoBuilder => ({ pos: [], nor: [], uv: [], aux: [], idx: [] });

function toGeometry(b: GeoBuilder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('aux', new THREE.Float32BufferAttribute(b.aux, 3));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

/** Sweep a polyline (in profile space) along the path as a ribbon of quads. */
function sweep(b: GeoBuilder, samples: PathSample[], line: [number, number][], auxFn: (seg: number) => [number, number, number], uvScaleV = 1): void {
  const base = b.pos.length / 3;
  const cols = line.length;
  // Cumulative distance along the profile line for the v coordinate.
  const vAcc: number[] = [0];
  for (let i = 1; i < cols; i++) vAcc.push(vAcc[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]));
  for (const smp of samples) {
    for (let i = 0; i < cols; i++) {
      const [d, h] = line[i]!;
      b.pos.push(smp.p.x + smp.n.x * d, h, smp.p.y + smp.n.y * d);
      // Profile tangent → normal (perpendicular in the d/h plane, pointing up/inward).
      const j0 = Math.max(0, i - 1);
      const j1 = Math.min(cols - 1, i + 1);
      const td = line[j1]![0] - line[j0]![0];
      const th = line[j1]![1] - line[j0]![1];
      const len = Math.hypot(td, th) || 1;
      const nd = -th / len; // outward component along the path normal
      const nh = td / len;
      b.nor.push(smp.n.x * nd, nh, smp.n.y * nd);
      b.uv.push(smp.s, vAcc[i]! * uvScaleV);
      b.aux.push(...auxFn(i));
    }
  }
  // Choose the triangle winding so front faces agree with the intended normals.
  let flip = false;
  if (samples.length > 1 && cols > 1) {
    const P = (k: number) => new THREE.Vector3(b.pos[k * 3], b.pos[k * 3 + 1], b.pos[k * 3 + 2]);
    const a0 = P(base);
    const e1 = P(base + 1).sub(a0);
    const e2 = P(base + cols).sub(a0);
    const geomN = e1.cross(e2);
    const want = new THREE.Vector3(b.nor[base * 3], b.nor[base * 3 + 1], b.nor[base * 3 + 2]);
    flip = geomN.dot(want) < 0;
  }
  for (let r = 0; r < samples.length - 1; r++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = base + r * cols + i;
      const c = a + cols;
      if (flip) b.idx.push(a, c, a + 1, a + 1, c, c + 1);
      else b.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
}

export interface BowlGeometries {
  seating: THREE.BufferGeometry;
  concrete: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  lightBanks: THREE.Matrix4[]; // instanced light fixtures under the roof lip
  pathLength: number;
}

export function buildBowl(): BowlGeometries {
  const { samples, length } = standPath(1.2);
  const seating = newBuilder();
  const concrete = newBuilder();
  const glass = newBuilder();
  const roof = newBuilder();

  // Seating: each row is a tread (flat) + riser (vertical) with its own quad
  // strip so each face gets flat normals and a row index for the crowd shader.
  for (const tier of PROFILE.seating) {
    for (let r = 0; r < tier.rows; r++) {
      const d = tier.d0 + r * tier.tread;
      const h = tier.h0 + r * tier.riser;
      // riser: from (d, h) up to (d, h + riser)
      sweepFlat(seating, samples, [d, h], [d, h + tier.riser], [r, tier.tier, 1]);
      // tread: from (d, h + riser) back to (d + tread, h + riser)
      sweepFlat(seating, samples, [d, h + tier.riser], [d + tier.tread, h + tier.riser], [r, tier.tier, 0]);
    }
  }

  // Concrete: pitch wall, concourse deck, club fascia, back wall, top parapet,
  // exterior facade and underside.
  const lower = PROFILE.seating[0]!;
  const upper = PROFILE.seating[1]!;
  const lowerTop = lower.h0 + lower.rows * lower.riser;
  const upperTopD = upper.d0 + upper.rows * upper.tread;
  const upperTopH = upper.h0 + upper.rows * upper.riser;
  sweepFlat(concrete, samples, [0, 0], [0, lower.h0], [0, 0, 2]); // padded pitch wall
  sweepFlat(concrete, samples, [0, lower.h0], [lower.d0, lower.h0], [0, 0, 2]);
  sweepFlat(concrete, samples, [PROFILE.concourse.d0, lowerTop], [PROFILE.concourse.d1, lowerTop], [0, 0, 3]);
  sweepFlat(concrete, samples, [upperTopD, upperTopH], [upperTopD + 0.4, upperTopH], [0, 0, 3]);
  sweepFlat(concrete, samples, [upperTopD + 0.4, upperTopH], [upperTopD + 0.4, PROFILE.topH], [0, 0, 4]);
  sweepFlat(concrete, samples, [upperTopD + 0.4, PROFILE.topH], [PROFILE.backD, PROFILE.topH], [0, 0, 3]);
  // Exterior facade (faces outward).
  sweepFlat(concrete, samples, [PROFILE.backD, PROFILE.topH], [PROFILE.backD, -2], [0, 0, 5]);
  // Glass club band (faces the field) between concourse and upper tier.
  sweepFlat(glass, samples, [PROFILE.concourse.d1 - 0.3, lowerTop], [PROFILE.concourse.d1 - 0.3, PROFILE.concourse.fasciaTop], [0, 0, 6]);

  // Roof: cantilevered canopy sloping up toward the field (top + underside + lip).
  const R = PROFILE.roof;
  sweepFlat(roof, samples, [R.dFront, R.hFront], [R.dBack, R.hBack], [0, 0, 7]);
  sweepFlat(roof, samples, [R.dBack, R.hBack - R.thick], [R.dFront, R.hFront - R.thick], [0, 0, 8]);
  sweepFlat(roof, samples, [R.dFront, R.hFront - R.thick], [R.dFront, R.hFront], [0, 0, 9]);
  // Roof back wall closing the gap to the stands.
  sweepFlat(concrete, samples, [PROFILE.backD, PROFILE.topH], [R.dBack, R.hBack - R.thick], [0, 0, 5]);

  // End caps at the open south ends of both sideline stands.
  addEndCap(concrete, samples[0]!, false);
  addEndCap(concrete, samples[samples.length - 1]!, true);

  // Light banks along the roof lip, every ~9 m.
  const lightBanks: THREE.Matrix4[] = [];
  for (let s = 6; s < length - 6; s += 9) {
    const smp = samples.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best));
    const pos = new THREE.Vector3(smp.p.x + smp.n.x * (R.dFront + 1.5), R.hFront - R.thick - 0.6, smp.p.y + smp.n.y * (R.dFront + 1.5));
    const yaw = Math.atan2(smp.n.x, smp.n.y);
    const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, yaw + Math.PI, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
    lightBanks.push(m);
  }

  return {
    seating: toGeometry(seating),
    concrete: toGeometry(concrete),
    glass: toGeometry(glass),
    roof: toGeometry(roof),
    lightBanks,
    pathLength: length,
  };
}

function sweepFlat(b: GeoBuilder, samples: PathSample[], a: [number, number], c: [number, number], aux: [number, number, number]): void {
  sweep(b, samples, [a, c], () => aux);
}

/** Solid end wall following the profile outline at a stand's south end. */
function addEndCap(b: GeoBuilder, smp: PathSample, flip: boolean): void {
  const pts: [number, number][] = [[0, -2], [0, PROFILE.seating[0]!.h0]];
  for (const tier of PROFILE.seating) {
    for (let r = 0; r < tier.rows; r++) {
      const d = tier.d0 + r * tier.tread;
      const h = tier.h0 + r * tier.riser;
      pts.push([d, h + tier.riser], [d + tier.tread, h + tier.riser]);
    }
  }
  pts.push([PROFILE.backD, PROFILE.topH], [PROFILE.backD, -2]);
  const shape = new THREE.Shape(pts.map(([d, h]) => new THREE.Vector2(d, h)));
  const geo = new THREE.ShapeGeometry(shape);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const base = b.pos.length / 3;
  // Wall normal: along the path tangent (pointing south, out of the stand).
  const tangent = new THREE.Vector2(-smp.n.y, smp.n.x).multiplyScalar(flip ? -1 : 1);
  const nx = flip ? -tangent.x : tangent.x;
  const nz = flip ? -tangent.y : tangent.y;
  for (let i = 0; i < p.count; i++) {
    const d = p.getX(i);
    const h = p.getY(i);
    b.pos.push(smp.p.x + smp.n.x * d, h, smp.p.y + smp.n.y * d);
    b.nor.push(-nx, 0, -nz);
    b.uv.push(d, h);
    b.aux.push(0, 0, 10);
  }
  const index = geo.index!.array;
  for (let i = 0; i < index.length; i += 3) {
    if (flip) b.idx.push(base + index[i]!, base + index[i + 1]!, base + index[i + 2]!);
    else b.idx.push(base + index[i]!, base + index[i + 2]!, base + index[i + 1]!);
  }
  geo.dispose();
}
