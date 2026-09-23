import type { PhysicalKey } from './attributes/types';
import { exp } from '../math/detmath';
import { CONF_WEIGHT, composeDirect } from './scale';
import type { AttributeResult, Conf, Contribution, RatedPos, RatingInputs } from './types';

// Physical attributes (BRIEF "Physical attributes" and "The time-machine
// rule"). They are on one absolute scale for every position, because they
// feed physics directly (top speed, acceleration, mass in collisions).
//
// Order of evidence:
//   1. Measured data (combine 40, bench, vertical, broad, cone, shuttle).
//   2. Otherwise a position prior adjusted by body (weight relative to the
//      player's own era and position, translated to the modern scale) and by
//      production signatures (yards per catch for receiver speed, rushing for
//      QB speed, ...). These are flagged `estimated`.
//
// Physical values are computed once per person at his peak and then aged for
// each stint with a position-specific curve, so the same player's physicals
// differ between stints only by age (BRIEF "Aging across stints").

/** Mean weight of a notable modern (2010s–2020s) player at the position; fallback when the pool has no data. */
const MODERN_WEIGHT_FALLBACK: Record<RatedPos, number> = { QB: 222, RB: 215, WR: 198, TE: 252, OL: 312, DE: 268, DT: 305, LB: 240, CB: 193, S: 206 };
const HEIGHT_FALLBACK: Record<RatedPos, number> = { QB: 75, RB: 70.5, WR: 72.5, TE: 76.5, OL: 76.5, DE: 76, DT: 75, LB: 74, CB: 71.5, S: 72.5 };

/** Typical 40 time of a notable player at the position (sets the speed prior). */
const FORTY_PRIOR: Record<RatedPos, number> = { QB: 4.8, RB: 4.5, WR: 4.48, TE: 4.72, OL: 5.25, DE: 4.78, DT: 5.02, LB: 4.68, CB: 4.46, S: 4.54 };
const AGILITY_PRIOR: Record<RatedPos, number> = { QB: 70, RB: 84, WR: 84, TE: 72, OL: 55, DE: 70, DT: 60, LB: 74, CB: 86, S: 82 };
const JUMP_PRIOR: Record<RatedPos, number> = { QB: 68, RB: 80, WR: 84, TE: 76, OL: 56, DE: 74, DT: 62, LB: 76, CB: 84, S: 82 };
const STAMINA_PRIOR: Record<RatedPos, number> = { QB: 78, RB: 80, WR: 80, TE: 78, OL: 76, DE: 76, DT: 74, LB: 78, CB: 80, S: 80 };

/** Production signatures that nudge an unmeasured physical, in rating points per standardized z. */
const SPEED_SIG: Partial<Record<RatedPos, [string, number][]>> = {
  QB: [['q_rush', 3]],
  RB: [['r_ypc', 1.5], ['r_rec', 0.5]],
  WR: [['w_ypr', 2]],
  TE: [['w_ypr', 1.5]],
  DE: [['d_sack', 1.5]],
  DT: [['d_sack', 1]],
  LB: [['d_sack', 0.5], ['d_int', 0.5]],
  CB: [['d_int', 0.5]],
  S: [['d_int', 0.5]],
};
const AGILITY_SIG: Partial<Record<RatedPos, [string, number][]>> = {
  QB: [['q_rush', 2]],
  RB: [['r_ypc', 2.5], ['r_recn', 0.5]],
  WR: [['w_recn', 1]],
  TE: [['w_recn', 1]],
  DE: [['d_sack', 1]],
  LB: [['d_pd', 0.5]],
  CB: [['d_pd', 1]],
  S: [['d_pd', 1]],
};
const JUMP_SIG: Partial<Record<RatedPos, [string, number][]>> = {
  WR: [['w_tdrate', 1], ['w_ypr', 1]],
  TE: [['w_tdrate', 1]],
  CB: [['d_int', 1]],
  S: [['d_int', 1]],
};
const STAMINA_SIG: Partial<Record<RatedPos, [string, number][]>> = {
  QB: [['q_yds', 1]],
  RB: [['r_car', 3]],
  WR: [['w_recn', 1.5]],
  TE: [['w_recn', 1]],
  DE: [['d_tkl', 1.5]],
  DT: [['d_tkl', 1.5]],
  LB: [['d_tkl', 2]],
  CB: [['d_tkl', 1]],
  S: [['d_tkl', 1.5]],
};

// Measured-data scales. Anchors: a 4.30 40 is 99 speed and every 0.1 s costs
// 4.5 points (so 4.50 = 90, 4.80 = 76.5, 5.20 = 58.5), which puts linemen in
// the 50s–60s as the brief's speed mapping expects.
export const fortyToSpeed = (t: number): number => 99 - (t - 4.3) * 45;
// Cone 6.45 s / shuttle 3.90 s are elite (≈ best 1–2% of combine results).
const coneToAgility = (t: number): number => 99 - (t - 6.45) * 36;
const shuttleToAgility = (t: number): number => 99 - (t - 3.9) * 32;
// Vertical 42" / broad 136" ≈ the top of the combine distribution.
const verticalToJump = (v: number): number => 99 - (42 - v) * 2.2;
const broadToJump = (b: number): number => 99 - (136 - b) * 0.9;
/** Strength from mass: 180 lb → 45, 250 lb → 66, 315 lb → 85.5, 345 lb → 94.5 (bench reps move it from there). */
const weightToStrength = (w: number): number => 45 + 0.3 * (w - 180);
/** Typical combine bench reps (225 lb) at a body weight. */
const expectedBench = (w: number): number => 12 + 0.12 * (w - 180);

/**
 * Hand-timed 40s read about 0.1–0.2 s faster than electronic timing, and pro
 * day tracks run fast. Partial corrections by source (seconds added):
 *   nflverse combine (electronic)                    0
 *   Wikipedia measurables table, NFL Combine          0.03 (older combines mixed hand and electronic)
 *   Wikipedia measurables table, pro day or unstated  0.05
 *   commonly cited time (estimated; usually hand)     0.06
 *   inferred estimate (already a typical electronic)  0
 */
export function fortyCorrection(f: { conf: Conf; src: string }): number {
  if (f.conf === 'verified') return 0;
  const s = f.src.toLowerCase();
  if (f.conf === 'reference') return s.includes('combine') && !s.includes('pro day') ? 0.03 : 0.05;
  return s.includes('commonly cited') ? 0.06 : 0;
}

/**
 * Soft top for measured and prior-based physicals: identity up to 94, then
 * compressing toward 100, so a 4.30 40 reads 97.4 and only the very fastest
 * ever measured (about 4.22) reach 99. Avoids pileups at the cap.
 */
export const SOFT_KNEE = 94;
const SOFT_SPAN = 6;
export function softTop(r: number): number {
  return r <= SOFT_KNEE ? r : SOFT_KNEE + SOFT_SPAN * (1 - exp(-(r - SOFT_KNEE) / SOFT_SPAN));
}

// Aging: the last age of full physical peak, then yearly decline (points)
// for the first four years past it and after that.
const PEAK_END: Record<RatedPos, number> = { QB: 29, RB: 26, WR: 27, TE: 28, OL: 30, DE: 28, DT: 29, LB: 28, CB: 27, S: 28 };
const FAST_DECLINE = new Set<RatedPos>(['RB', 'CB']);

export function agingDelta(pos: RatedPos, age: number | undefined, attr: PhysicalKey): number {
  if (age === undefined) return 0;
  if (attr === 'stamina') return -0.6 * Math.max(0, age - 30);
  if (attr === 'strength') return -0.5 * Math.max(0, age - (PEAK_END[pos] + 3));
  const past = Math.max(0, age - PEAK_END[pos]);
  const [r1, r2] = FAST_DECLINE.has(pos) ? [1.1, 1.7] : [0.8, 1.3];
  const d = Math.min(past, 4) * r1 + Math.max(0, past - 4) * r2;
  return -(attr === 'agility' ? d * 0.8 : d);
}

export interface PhysicalResult {
  attrs: Record<PhysicalKey, AttributeResult>;
  heightIn: number;
  weightLb: number;
  /** Weight translated to the modern game: same standing among era peers at the position. */
  weightEq: number;
  heightEq: number;
  conf: Conf;
}

type ZOf = (inp: RatingInputs, key: string) => number | undefined;

interface BodyNorms {
  weight: Map<string, number>; // `${pos}|${decade}` → mean
  height: Map<string, number>;
  modernWeight: Map<RatedPos, number>;
  modernHeight: Map<RatedPos, number>;
}

function mean(xs: number[]): number | undefined {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}

function bodyNorms(all: readonly RatingInputs[]): BodyNorms {
  const w = new Map<string, number[]>();
  const h = new Map<string, number[]>();
  for (const e of all) {
    const k = `${e.pos}|${e.decade}`;
    if (e.weightLb) (w.get(k) ?? w.set(k, []).get(k)!).push(e.weightLb.v);
    if (e.heightIn) (h.get(k) ?? h.set(k, []).get(k)!).push(e.heightIn.v);
  }
  const norms: BodyNorms = { weight: new Map(), height: new Map(), modernWeight: new Map(), modernHeight: new Map() };
  for (const [k, xs] of w) if (xs.length >= 5) norms.weight.set(k, mean(xs)!);
  for (const [k, xs] of h) if (xs.length >= 5) norms.height.set(k, mean(xs)!);
  for (const pos of Object.keys(MODERN_WEIGHT_FALLBACK) as RatedPos[]) {
    const mw = mean(['2010s', '2020s'].flatMap((d) => w.get(`${pos}|${d}`) ?? []));
    const mh = mean(['2010s', '2020s'].flatMap((d) => h.get(`${pos}|${d}`) ?? []));
    norms.modernWeight.set(pos, mw ?? MODERN_WEIGHT_FALLBACK[pos]);
    norms.modernHeight.set(pos, mh ?? HEIGHT_FALLBACK[pos]);
  }
  return norms;
}

/** Games-weighted mean of a signature over a person's stints, in rating points. */
function signature(stints: readonly RatingInputs[], sig: [string, number][] | undefined, zOf: ZOf): { pts: number; parts: string[] } {
  if (!sig) return { pts: 0, parts: [] };
  let pts = 0;
  const parts: string[] = [];
  for (const [key, per] of sig) {
    let sw = 0;
    let sz = 0;
    for (const s of stints) {
      const z = zOf(s, key);
      if (z === undefined) continue;
      const wgt = Math.max(1, s.games.v);
      sw += wgt;
      sz += wgt * z;
    }
    if (sw > 0) {
      const d = (sz / sw) * per;
      pts += d;
      parts.push(`${key} ${d >= 0 ? '+' : ''}${d.toFixed(1)}`);
    }
  }
  return { pts, parts };
}

const conf3 = (c: Conf): number => CONF_WEIGHT[c];

/**
 * Compute physical attributes for every stint. Stints are grouped by person
 * (personId), the peak values are computed once per person, then aged.
 */
export function computePhysicals(all: readonly RatingInputs[], zOf: ZOf): Map<string, PhysicalResult> {
  const norms = bodyNorms(all);
  const byPerson = new Map<string, RatingInputs[]>();
  for (const e of all) (byPerson.get(e.personId) ?? byPerson.set(e.personId, []).get(e.personId)!).push(e);
  const out = new Map<string, PhysicalResult>();

  for (const stints of byPerson.values()) {
    // A person can appear at different positions (rare: e.g. a TE listed as
    // WR elsewhere); physical peaks are computed per position group.
    const byPos = new Map<RatedPos, RatingInputs[]>();
    for (const s of stints) (byPos.get(s.pos) ?? byPos.set(s.pos, []).get(s.pos)!).push(s);
    for (const [pos, group] of byPos) {
      for (const s of group) out.set(s.id, physicalFor(s, group, pos, norms, zOf));
    }
  }
  return out;
}

function physicalFor(s: RatingInputs, group: readonly RatingInputs[], pos: RatedPos, norms: BodyNorms, zOf: ZOf): PhysicalResult {
  const modernW = norms.modernWeight.get(pos)!;
  const modernH = norms.modernHeight.get(pos)!;
  const eraW = (e: RatingInputs) => norms.weight.get(`${pos}|${e.decade}`) ?? modernW;
  const eraH = (e: RatingInputs) => norms.height.get(`${pos}|${e.decade}`) ?? modernH;
  // This stint's listed body (for the character model and contact mass).
  const wSrc = s.weightLb ?? group.find((g) => g.weightLb)?.weightLb;
  const hSrc = s.heightIn ?? group.find((g) => g.heightIn)?.heightIn;
  const weightLb = wSrc?.v ?? eraW(s);
  const heightIn = hSrc?.v ?? eraH(s);
  const weightEq = weightLb - eraW(s) + modernW;
  const heightEq = heightIn - eraH(s) + modernH;
  // The person's frame for physical attributes: era-translated weight
  // averaged over his stints (games-weighted), so physicals don't drift
  // between stints except by aging.
  const withW = group.filter((g) => g.weightLb);
  const gw = (g: RatingInputs) => Math.max(1, g.games.v);
  const personWEq = withW.length ? withW.reduce((a, g) => a + gw(g) * (g.weightLb!.v - eraW(g) + modernW), 0) / withW.reduce((a, g) => a + gw(g), 0) : weightEq;
  const personW = withW.length ? withW.reduce((a, g) => a + gw(g) * g.weightLb!.v, 0) / withW.reduce((a, g) => a + gw(g), 0) : weightLb;
  const bodyConf: Conf = wSrc?.conf ?? 'prior';
  const age = s.age?.v;
  const m = group.map((g) => g.measurables).find((x) => x.forty || x.cone || x.vertical || x.bench) ?? s.measurables;
  const heavier = personWEq - modernW;
  const frame = `Frame: ${Math.round(personW)} lb` + (Math.abs(personWEq - personW) >= 2 ? ` (≈${Math.round(personWEq)} in today's game)` : '');

  const aged = (key: PhysicalKey, parts: Contribution[], soft = true): Contribution[] => {
    const peak = parts.reduce((a, p) => a + p.delta, 0);
    if (soft && peak > SOFT_KNEE) parts.push({ label: `Soft top above ${SOFT_KNEE}`, delta: softTop(peak) - peak, kind: 'prior' });
    const d = agingDelta(pos, age, key);
    if (Math.abs(d) > 1e-9) parts.push({ label: `Aging (age ${age!.toFixed(1)})`, delta: d, kind: 'aging', input: `${age!.toFixed(1)}`, conf: s.age!.conf, src: s.age!.src });
    return parts;
  };

  // ---- Speed
  let speedParts: Contribution[];
  let speedConf: Conf;
  if (m.forty) {
    const corr = fortyCorrection(m.forty);
    const t = m.forty.v + corr;
    speedParts = [{ label: `40-yard dash ${m.forty.v.toFixed(2)}${corr ? ` (+${corr.toFixed(2)} hand-time correction)` : ''}`, delta: fortyToSpeed(t), kind: 'physical', input: `${m.forty.v.toFixed(2)} s`, conf: m.forty.conf, src: m.forty.src }];
    speedConf = m.forty.conf;
  } else {
    const sig = signature(group, SPEED_SIG[pos], zOf);
    speedParts = [
      { label: `${pos} prior (typical 40 of ${FORTY_PRIOR[pos].toFixed(2)})`, delta: fortyToSpeed(FORTY_PRIOR[pos]), kind: 'prior' },
      { label: frame, delta: -0.25 * heavier, kind: 'body', input: `${Math.round(weightLb)} lb`, conf: bodyConf, src: wSrc?.src },
    ];
    if (sig.parts.length) speedParts.push({ label: `Production signature (${sig.parts.join(', ')})`, delta: sig.pts, kind: 'stat', conf: 'estimated' });
    speedConf = sig.parts.length ? 'estimated' : 'prior';
  }
  const speedPeak = speedParts.reduce((a, p) => a + p.delta, 0);
  const speed = composeDirect(aged('speed', speedParts), conf3(speedConf));

  // ---- Agility
  let agParts: Contribution[];
  let agConf: Conf;
  const drills = [m.cone && coneToAgility(m.cone.v), m.shuttle && shuttleToAgility(m.shuttle.v)].filter((x): x is number => typeof x === 'number');
  if (drills.length) {
    const src = m.cone ?? m.shuttle!;
    const label = [m.cone && `3-cone ${m.cone.v.toFixed(2)}`, m.shuttle && `shuttle ${m.shuttle.v.toFixed(2)}`].filter(Boolean).join(', ');
    agParts = [{ label: `Agility drills: ${label}`, delta: drills.reduce((a, b) => a + b, 0) / drills.length, kind: 'physical', conf: src.conf, src: src.src }];
    agConf = src.conf;
  } else {
    const sig = signature(group, AGILITY_SIG[pos], zOf);
    agParts = [
      { label: `${pos} prior`, delta: AGILITY_PRIOR[pos], kind: 'prior' },
      { label: frame, delta: -0.12 * heavier, kind: 'body', conf: bodyConf, src: wSrc?.src },
    ];
    if (m.forty) agParts.push({ label: 'Measured speed', delta: 0.25 * (speedPeak - fortyToSpeed(FORTY_PRIOR[pos])), kind: 'physical', conf: m.forty.conf, src: m.forty.src });
    if (sig.parts.length) agParts.push({ label: `Production signature (${sig.parts.join(', ')})`, delta: sig.pts, kind: 'stat', conf: 'estimated' });
    agConf = sig.parts.length || m.forty ? 'estimated' : 'prior';
  }
  const agPeak = agParts.reduce((a, p) => a + p.delta, 0);
  const agility = composeDirect(aged('agility', agParts), conf3(agConf));

  // ---- Acceleration: mostly speed, some agility, lighter frames get going faster.
  const accParts: Contribution[] = [
    { label: 'From speed (70%)', delta: 0.7 * speedPeak, kind: 'physical', conf: speedConf },
    { label: 'From agility (30%)', delta: 0.3 * agPeak, kind: 'physical', conf: agConf },
    { label: frame, delta: -0.06 * heavier, kind: 'body', conf: bodyConf, src: wSrc?.src },
  ];
  const acceleration = composeDirect(aged('acceleration', accParts), (conf3(speedConf) * 0.7 + conf3(agConf) * 0.3));

  // ---- Strength
  const strParts: Contribution[] = [{ label: `Mass: ${frame.slice(7)}`, delta: weightToStrength(personWEq), kind: 'body', input: `${Math.round(personW)} lb`, conf: bodyConf, src: wSrc?.src }];
  if (m.bench) strParts.push({ label: `Bench press: ${m.bench.v} reps (expected ${expectedBench(personW).toFixed(0)} at that weight)`, delta: 1.0 * (m.bench.v - expectedBench(personW)), kind: 'physical', conf: m.bench.conf, src: m.bench.src });
  const strength = composeDirect(aged('strength', strParts), m.bench ? conf3(m.bench.conf) : conf3(bodyConf) * 0.6);

  // ---- Jumping
  let jParts: Contribution[];
  let jConf: Conf;
  const jumps = [m.vertical && verticalToJump(m.vertical.v), m.broad && broadToJump(m.broad.v)].filter((x): x is number => typeof x === 'number');
  if (jumps.length) {
    const src = m.vertical ?? m.broad!;
    const label = [m.vertical && `vertical ${m.vertical.v}"`, m.broad && `broad ${m.broad.v}"`].filter(Boolean).join(', ');
    jParts = [{ label: `Jumps: ${label}`, delta: jumps.reduce((a, b) => a + b, 0) / jumps.length, kind: 'physical', conf: src.conf, src: src.src }];
    jConf = src.conf;
  } else {
    const sig = signature(group, JUMP_SIG[pos], zOf);
    jParts = [
      { label: `${pos} prior`, delta: JUMP_PRIOR[pos], kind: 'prior' },
      { label: frame, delta: -0.08 * heavier, kind: 'body', conf: bodyConf, src: wSrc?.src },
      { label: 'Speed (explosiveness)', delta: 0.3 * (speedPeak - fortyToSpeed(FORTY_PRIOR[pos])), kind: 'physical', conf: speedConf },
    ];
    if (sig.parts.length) jParts.push({ label: `Production signature (${sig.parts.join(', ')})`, delta: sig.pts, kind: 'stat', conf: 'estimated' });
    jConf = sig.parts.length || m.forty ? 'estimated' : 'prior';
  }
  const jumping = composeDirect(aged('jumping', jParts), conf3(jConf));

  // ---- Stamina: position prior plus workload.
  const stSig = signature(group, STAMINA_SIG[pos], zOf);
  const stParts: Contribution[] = [{ label: `${pos} prior`, delta: STAMINA_PRIOR[pos], kind: 'prior' }];
  if (stSig.parts.length) stParts.push({ label: `Workload (${stSig.parts.join(', ')})`, delta: stSig.pts, kind: 'stat', conf: 'estimated' });
  const stamina = composeDirect(aged('stamina', stParts), stSig.parts.length ? conf3('estimated') : 0);

  return {
    attrs: { speed, acceleration, agility, strength, stamina, jumping },
    heightIn,
    weightLb,
    weightEq,
    heightEq,
    conf: speedConf,
  };
}
