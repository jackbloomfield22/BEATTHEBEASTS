import { OVR_WEIGHTS } from './ovrWeights';
import { IMP_MAX_SHARE, MISSING_REWEIGHT, PHYSICAL_BY_POS, SKILL_ATTRS, type SkillAttrDef } from './attributes';
import { computePhysicals, type PhysicalResult } from './physical';
import { composeFromZ, CONF_WEIGHT, confLabel, normInv, POOL_BEST_RATING, poolScale, shrink, zToRating } from './scale';
import { SIGNALS, type PhysicalSnapshot, type SignalValue } from './signals';
import { deriveAllTraits, type OlUnitTraits } from './traits';
import type { AttributeResult, Contribution, RatedEntry, RatedPos, RatingInputs } from './types';

// The rating pass (TECH_PLAN §7):
//   1. pool statistics of every non-physical signal, per position
//   2. physical attributes per person, aged per stint
//   3. pool statistics of the physical signals
//   4. every skill attribute from its declarative definition
//   5. OVR from the position weights, standardized within the position pool
//   6. pool calibration of the curated defensive pools
//   7. traits: percentile tables per position pool, then gates, combinations
//      and the four-trait cap (traits/derive.ts); OL unit traits

/** Standardized scores are clipped here so one freak value can't swamp an attribute. */
const Z_CLIP = 4.5;

/**
 * Share of the final score that comes from the player's rank in the pool
 * (normal scores) rather than his distance from the mean in standard
 * deviations. Honors and volume stats are right-skewed, so pure SD scores pile
 * players up at 99; the rank half guarantees one expected best per pool while
 * the SD half keeps how far ahead a dominant player was.
 */
const RANK_BLEND = 0.6;

/** Rank-based normal score of each value in a pool (ties share the mean rank). */
function normalScores(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]![1]] = normInv((r - 0.5) / xs.length);
    i = j + 1;
  }
  return out;
}

/** Final pool z: blend of SD-standardized and rank-based scores, both on the pool-size scale. */
function blendZ(zSd: number, zRank: number, n: number): number {
  const ps = poolScale(n);
  return (1 - RANK_BLEND) * zSd * ps + RANK_BLEND * zRank * ps;
}

export interface Moments {
  mean: number;
  sd: number;
  n: number;
}

function moments(xs: number[]): Moments {
  const n = xs.length;
  if (!n) return { mean: 0, sd: 1, n: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1);
  return { mean, sd: Math.sqrt(v) || 1, n };
}

const PHYS_SIGNALS = new Set(['p_speed', 'p_agility', 'p_strength', 'p_jump', 'p_weight', 'p_light', 'p_height']);

export interface RateOptions {
  /** Entries excluded from pools and output (corrections `exclude`). */
  excluded?: ReadonlySet<string>;
}

export interface RatingRun {
  entries: RatedEntry[];
  /** Pool moments per position and signal, for the explorer's "league" context. */
  pools: Record<string, Record<string, Moments>>;
  /** Pool moments of each attribute composite (before standardization). */
  composites: Record<string, Record<string, Moments>>;
  /** Body per entry: listed height/weight and the era-translated weight used for physics. */
  bodies: Record<string, { heightIn: number; weightLb: number; weightEq: number }>;
  /** Pool calibration per position (see calibratePools). */
  calibration: Record<string, { medianHonors: number; center: number }>;
  /** OL units: the five linemen, the unit aggregates and the unit traits. */
  olUnits: Record<string, OlUnitTraits>;
  /** Every trait each entry passes the gates for, before combinations and the four-trait cap. */
  traitsEarned: Record<string, RatedEntry['traits']>;
}

type PoolKey = `${RatedPos}|${string}`;

export function rateAll(inputs: readonly RatingInputs[], opts: RateOptions = {}): RatingRun {
  const all = inputs.filter((e) => !opts.excluded?.has(e.id));
  const byPos = new Map<RatedPos, RatingInputs[]>();
  for (const e of all) (byPos.get(e.pos) ?? byPos.set(e.pos, []).get(e.pos)!).push(e);

  const noPhys: PhysicalSnapshot = { speed: 0, acceleration: 0, agility: 0, strength: 0, jumping: 0, heightIn: 0, weightLb: 0, realHeightIn: 0, realWeightLb: 0, conf: 'prior' };
  const raw = new Map<string, Map<string, SignalValue | undefined>>();
  const rawOf = (e: RatingInputs, key: string, phys: PhysicalSnapshot): SignalValue | undefined => {
    let m = raw.get(e.id);
    if (!m) raw.set(e.id, (m = new Map()));
    if (!m.has(key)) m.set(key, SIGNALS[key]!.get(e, phys));
    return m.get(key);
  };

  // 1. Non-physical signal pools.
  const pools = new Map<PoolKey, Moments>();
  const signalKeys = Object.keys(SIGNALS).filter((k) => !PHYS_SIGNALS.has(k));
  for (const [pos, list] of byPos) {
    for (const key of signalKeys) {
      const xs: number[] = [];
      for (const e of list) {
        const v = rawOf(e, key, noPhys);
        if (v && Number.isFinite(v.x)) xs.push(v.x);
      }
      if (xs.length >= 3) pools.set(`${pos}|${key}`, moments(xs));
    }
  }

  const zFrom = (e: RatingInputs, key: string, v: SignalValue | undefined): number | undefined => {
    if (!v || !Number.isFinite(v.x)) return undefined;
    const def = SIGNALS[key]!;
    // Already on the z scale (signals.ts `absolute`): not standardized in the pool.
    if (def.absolute) return Math.max(-Z_CLIP, Math.min(Z_CLIP, def.dir * v.x)) * shrink(v.games, def.k);
    const m = pools.get(`${e.pos}|${key}`);
    if (!m) return undefined;
    const z = Math.max(-Z_CLIP, Math.min(Z_CLIP, (def.dir * (v.x - m.mean)) / m.sd));
    return z * shrink(v.games, def.k);
  };

  // 2. Physicals.
  const physicals = computePhysicals(all, (e, key) => zFrom(e, key, rawOf(e, key, noPhys)));
  const snap = (e: RatingInputs): PhysicalSnapshot => {
    const p = physicals.get(e.id)!;
    return {
      speed: p.attrs.speed.value,
      acceleration: p.attrs.acceleration.value,
      agility: p.attrs.agility.value,
      strength: p.attrs.strength.value,
      jumping: p.attrs.jumping.value,
      heightIn: p.heightEq,
      weightLb: p.weightEq,
      realHeightIn: p.heightIn,
      realWeightLb: p.weightLb,
      conf: p.conf,
    };
  };
  const physSig = new Map<string, Map<string, SignalValue>>();
  for (const e of all) {
    const s = snap(e);
    const m = new Map<string, SignalValue>();
    for (const key of PHYS_SIGNALS) m.set(key, SIGNALS[key]!.get(e, s)!);
    physSig.set(e.id, m);
  }

  // 3. Physical signal pools.
  for (const [pos, list] of byPos) {
    for (const key of PHYS_SIGNALS) pools.set(`${pos}|${key}`, moments(list.map((e) => physSig.get(e.id)!.get(key)!.x)));
  }
  const signal = (e: RatingInputs, key: string): SignalValue | undefined => (PHYS_SIGNALS.has(key) ? physSig.get(e.id)!.get(key) : rawOf(e, key, noPhys));

  // 4. Skill attributes: terms, then pool spread of the composite.
  interface Term {
    label: string;
    z: number;
    kind: Contribution['kind'];
    input?: string;
    conf: RatingInputs['games']['conf'];
    src?: string;
    weight: number;
  }
  const termsOf = (e: RatingInputs, def: SkillAttrDef): Term[] => {
    const wSum = def.terms.reduce((a, t) => a + t.w, 0);
    const raw = def.terms.map((t) => {
      const keys = typeof t.s === 'string' ? [t.s] : t.s;
      for (const key of keys) {
        const v = signal(e, key);
        const z = zFrom(e, key, v);
        if (v && z !== undefined) {
          const sd = SIGNALS[key]!;
          const kind: Contribution['kind'] = sd.kind === 'unit' ? 'unit' : sd.kind;
          return { key, label: sd.label, z, kind, input: v.input, conf: v.conf, src: v.src, weight: t.w / wSum, present: true };
        }
      }
      const sd = SIGNALS[keys[0]!]!;
      return { key: keys[0]!, label: `${sd.label} (no data: position average)`, z: 0, kind: 'prior' as const, conf: 'prior' as const, src: undefined, input: undefined, weight: t.w / wSum, present: false };
    });
    // Partly move missing evidence weight onto the present evidence (stats,
    // honors, sourced scouting grades, unit results; types.ts MISSING_REWEIGHT). Body, physical and
    // reputation terms are priors, not evidence of the skill, so they are
    // never scaled up to stand in for missing stats.
    const isEvidence = (key: string) => {
      const k = SIGNALS[key]!.kind;
      return k === 'stat' || k === 'accolade' || k === 'scouting' || k === 'unit';
    };
    const ev = raw.filter((t) => isEvidence(t.key));
    const wAll = ev.reduce((a, t) => a + t.weight, 0);
    const wHave = ev.filter((t) => t.present).reduce((a, t) => a + t.weight, 0);
    const boost = wHave > 0 && wHave < wAll ? (wAll / wHave) ** MISSING_REWEIGHT : 1;
    const out = raw.map((t) => ({ key: t.key, label: t.label, z: t.weight * t.z * (isEvidence(t.key) && t.present ? boost : 1), kind: t.kind, input: t.input, conf: t.conf, src: t.src, weight: t.weight }));
    // BRIEF: imp is "worth no more than 20% of any attribute", for every
    // player. Reputation may only amplify what the other inputs say, by at
    // most a quarter of the evidence pointing the same way (so ≤ 20% of the
    // total); it can't create a rating on its own or overturn the evidence.
    // Counting only same-direction evidence keeps the cap monotone: better
    // stats never shrink a positive imp term or grow a negative one.
    const imp = out.find((t) => t.key === 'imp');
    if (imp) {
      const dir = Math.sign(imp.z);
      const others = out.reduce((a, t) => a + (t === imp ? 0 : Math.max(0, dir * t.z)), 0);
      const cap = (IMP_MAX_SHARE / (1 - IMP_MAX_SHARE)) * others;
      if (Math.abs(imp.z) > cap) {
        imp.z = Math.sign(imp.z) * cap;
        imp.label = `${imp.label} (capped at 20%)`;
      }
    }
    return out.map(({ key: _key, ...t }) => t);
  };

  const composites = new Map<PoolKey, Moments>();
  const termCache = new Map<string, Term[]>();
  const rankZ = new Map<string, number>();
  for (const [pos, list] of byPos) {
    for (const def of SKILL_ATTRS[pos]) {
      const cs: number[] = [];
      for (const e of list) {
        const ts = termsOf(e, def);
        termCache.set(`${e.id}|${def.key}`, ts);
        cs.push(ts.reduce((a, t) => a + t.z, 0));
      }
      composites.set(`${pos}|${def.key}`, moments(cs));
      normalScores(cs).forEach((z, i) => rankZ.set(`${list[i]!.id}|${def.key}`, z));
    }
  }
  /** Contribution that moves an SD-based rating to the blended one (see RANK_BLEND). */
  const shapeAdjust = (spread: number, zSdScaled: number, zFinal: number): Contribution[] => {
    const d = (zToRating(zFinal) - zToRating(zSdScaled)) * spread;
    return Math.abs(d) > 1e-9 ? [{ label: 'Pool-shape adjustment (rank blend)', delta: d, kind: 'prior' }] : [];
  };

  const entries: RatedEntry[] = [];
  const attrsById = new Map<string, Record<string, AttributeResult>>();
  for (const e of all) {
    const phys: PhysicalResult = physicals.get(e.id)!;
    const attrs: Record<string, AttributeResult> = {};
    for (const k of PHYSICAL_BY_POS[e.pos]) attrs[k] = phys.attrs[k as keyof typeof phys.attrs];
    for (const def of SKILL_ATTRS[e.pos]) {
      const m = composites.get(`${e.pos}|${def.key}`)!;
      const ts = termCache.get(`${e.id}|${def.key}`)!;
      // Standardize by the pool spread of the composite (mean is ~0 by
      // construction), then rescale for pool size (scale.ts poolScale).
      const spread = def.top !== undefined ? (def.top - def.base) / (POOL_BEST_RATING - 72) : 1;
      const zSd = ts.reduce((a, t) => a + t.z, 0) / m.sd;
      const zFinal = blendZ(zSd, rankZ.get(`${e.id}|${def.key}`)!, m.n);
      attrs[def.key] = composeFromZ(def.base, ts, poolScale(m.n) / m.sd, shapeAdjust(spread, zSd * poolScale(m.n), zFinal), spread);
    }
    attrsById.set(e.id, attrs);
  }

  // 5. OVR.
  const ovrMoments = new Map<RatedPos, { raw: Moments; attr: Map<string, Moments> }>();
  const ovrRankZ = new Map<string, number>();
  for (const [pos, list] of byPos) {
    const w = OVR_WEIGHTS[pos];
    const rawScores = list.map((e) => Object.entries(w).reduce((a, [k, wt]) => a + wt * attrsById.get(e.id)![k]!.value, 0));
    const attr = new Map<string, Moments>();
    for (const k of Object.keys(w)) attr.set(k, moments(list.map((e) => attrsById.get(e.id)![k]!.value)));
    ovrMoments.set(pos, { raw: moments(rawScores), attr });
    normalScores(rawScores).forEach((z, i) => ovrRankZ.set(list[i]!.id, z));
  }
  for (const e of all) {
    const attrs = attrsById.get(e.id)!;
    const { raw: rm, attr } = ovrMoments.get(e.pos)!;
    const w = OVR_WEIGHTS[e.pos];
    const terms = Object.entries(w).map(([k, wt]) => {
      const a = attrs[k]!;
      return { label: labelOf(e.pos, k), z: (wt * (a.value - attr.get(k)!.mean)) / rm.sd, kind: 'stat' as const, input: a.value.toFixed(0), conf: undefined, weight: wt, confScore: a.confScore };
    });
    const zSd = terms.reduce((a, t) => a + t.z, 0);
    const zFinal = blendZ(zSd, ovrRankZ.get(e.id)!, rm.n);
    const ovr = composeFromZ(72, terms, poolScale(rm.n), shapeAdjust(1, zSd * poolScale(rm.n), zFinal));
    // OVR confidence is the weighted confidence of its attributes.
    ovr.confScore = terms.reduce((a, t) => a + t.weight * t.confScore, 0);
    ovr.conf = confLabel(ovr.confScore);
    entries.push({ id: e.id, personId: e.personId, name: e.name, pos: e.pos, team: e.team, decade: e.decade, imp: e.imp, attrs, ovr, traits: [], inputs: e });
  }

  // 6. Pool calibration: re-center curated elite pools on the shared scale.
  const calibration = calibratePools(entries, byPos);

  // 7. Traits (after calibration: gates read final values). Percentile
  // tables of every metric are built per position pool first, then each
  // entry's traits are derived against them.
  const traitRun = deriveAllTraits(entries, {
    z: (e, key) => zFrom(e.inputs, key, signal(e.inputs, key)),
    sig: (e, key) => signal(e.inputs, key),
    phys: (e) => physicals.get(e.id)!,
  });
  for (const r of entries) r.traits = traitRun.byEntry.get(r.id) ?? [];

  const poolsOut: RatingRun['pools'] = {};
  for (const [k, m] of pools) {
    const [pos, key] = k.split('|') as [string, string];
    (poolsOut[pos] ??= {})[key] = m;
  }
  const compOut: RatingRun['composites'] = {};
  for (const [k, m] of composites) {
    const [pos, key] = k.split('|') as [string, string];
    (compOut[pos] ??= {})[key] = m;
  }
  const bodies: RatingRun['bodies'] = {};
  for (const [id, p] of physicals) bodies[id] = { heightIn: p.heightIn, weightLb: p.weightLb, weightEq: p.weightEq };
  return { entries, pools: poolsOut, composites: compOut, bodies, calibration, olUnits: traitRun.units, traitsEarned: Object.fromEntries(traitRun.earned) };
}

function labelOf(pos: RatedPos, key: string): string {
  return SKILL_ATTRS[pos].find((d) => d.key === key)?.label ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export { CONF_WEIGHT };

// ---------------------------------------------------------------------------
// Pool calibration.
//
// Every position is standardized within its own pool, so each pool's median
// lands at 72 ("solid starter"). That is right for the broad offensive pools
// (thousands of stints, median honors 0 per season), but the defensive pools
// are the curated Beasts candidates: about 90% of them have honors, with a
// median of ~0.5–0.75 honors per season. On the shared scale their median
// player is a Pro Bowl-level defender, not a solid starter.
//
// The offensive pools give the relation between honors per season and rating
// (median OVR by honors band). A pool whose median honors are well above zero
// is re-centered on the rating that honors level earns on offense, keeping
// the best ever at the top: values above 72 are compressed into
// [center, POOL_BEST_RATING], values below are shifted down by the same
// offset. Only the position's own skills (base 72) and OVR move; occasional
// skills keep their own [base, top] ranges.

const OFFENSE: readonly RatedPos[] = ['QB', 'RB', 'WR', 'TE'];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function calibratePools(entries: RatedEntry[], byPos: Map<RatedPos, RatingInputs[]>): RatingRun['calibration'] {
  const honors = (e: RatedEntry) => SIGNALS.acc!.get(e.inputs, undefined as never)?.x;
  // Honors → OVR on offense: zero-honors median, then eight equal-count bands.
  const off = entries.filter((e) => OFFENSE.includes(e.pos));
  const withH = off.map((e) => ({ h: honors(e), ovr: e.ovr.value })).filter((x): x is { h: number; ovr: number } => x.h !== undefined);
  const zero = withH.filter((x) => x.h <= 0);
  const pos = withH.filter((x) => x.h > 0).sort((a, b) => a.h - b.h);
  const pts: [number, number][] = [[0, median(zero.map((x) => x.ovr))]];
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const band = pos.slice(Math.floor((i * pos.length) / bands), Math.floor(((i + 1) * pos.length) / bands));
    if (band.length) pts.push([median(band.map((x) => x.h)), median(band.map((x) => x.ovr))]);
  }
  const ovrAt = (h: number): number => {
    if (h <= pts[0]![0]) return pts[0]![1];
    for (let i = 1; i < pts.length; i++) {
      const [h1, r1] = pts[i]!;
      const [h0, r0] = pts[i - 1]!;
      if (h <= h1) return r0 + ((h - h0) / Math.max(1e-9, h1 - h0)) * (r1 - r0);
    }
    return pts[pts.length - 1]![1];
  };

  const out: RatingRun['calibration'] = {};
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const [p, list] of byPos) {
    const hs = list.map((e) => SIGNALS.acc!.get(e, undefined as never)?.x).filter((x): x is number => x !== undefined);
    const mh = median(hs);
    // Only pools whose typical member has honors (the curated defensive pools).
    if (OFFENSE.includes(p) || !(mh > 0.05) || hs.length < list.length / 2) continue;
    const center = Math.min(POOL_BEST_RATING - 4, ovrAt(mh));
    out[p] = { medianHonors: mh, center };
    const up = (POOL_BEST_RATING - center) / (POOL_BEST_RATING - 72);
    const adjust = (r: AttributeResult) => {
      const v = r.value;
      const next = v >= 72 ? center + (v - 72) * up : v + (center - 72);
      const d = Math.min(99, Math.max(1, next)) - v;
      if (Math.abs(d) < 1e-9) return;
      r.contributions.push({ label: `Pool calibration (elite pool: median ${mh.toFixed(2)} honors/season ≈ ${center.toFixed(0)} on offense)`, delta: d, kind: 'prior' });
      r.value = v + d;
    };
    const primary = new Set(SKILL_ATTRS[p].filter((d) => d.top === undefined && d.base === 72).map((d) => d.key));
    for (const inp of list) {
      const e = byId.get(inp.id)!;
      for (const k of primary) if (e.attrs[k]) adjust(e.attrs[k]!);
      adjust(e.ovr);
    }
  }
  return out;
}
