// Validation of the ratings (BRIEF "Validation: prove the ratings are
// right"). Shared by tests/ratings-validation.test.ts and the report generator.

import type { RatingRun } from '../../src/engine/ratings/engine.ts';
import { OVR_WEIGHTS } from '../../src/engine/ratings/ovrWeights.ts';
import { agingDelta } from '../../src/engine/ratings/physical.ts';
import type { RatedEntry, RatedPos } from '../../src/engine/ratings/types.ts';
import { ANCHORS, type Anchor, type Check } from './anchors.ts';

type Entry = RatedEntry;

export function byPosition(run: RatingRun): Map<RatedPos, Entry[]> {
  const m = new Map<RatedPos, Entry[]>();
  for (const e of run.entries) (m.get(e.pos) ?? m.set(e.pos, []).get(e.pos)!).push(e);
  return m;
}

const val = (e: Entry, attr: string): number | undefined => (attr === 'ovr' ? e.ovr.value : attr === 'heightIn' ? e.inputs.heightIn?.v : e.attrs[attr]?.value);

/** Percentile of a value in a list (share of the pool strictly below, 0–100). */
export function percentile(list: readonly number[], v: number): number {
  const below = list.filter((x) => x < v).length;
  const equal = list.filter((x) => x === v).length;
  return (100 * (below + 0.5 * equal)) / list.length;
}

export function rankOf(list: readonly number[], v: number): number {
  return list.filter((x) => x > v + 1e-9).length + 1;
}

export interface CheckResult {
  id: string;
  check: Check;
  pass: boolean;
  actual: number | undefined;
  text: string;
}

export interface AnchorResult {
  label: string;
  anchor: Anchor;
  pass: boolean;
  results: CheckResult[];
}

export function evaluateAnchors(run: RatingRun, anchors: readonly Anchor[] = ANCHORS): AnchorResult[] {
  const byId = new Map(run.entries.map((e) => [e.id, e]));
  const pools = byPosition(run);
  return anchors.map((a) => {
    const results: CheckResult[] = [];
    for (const id of a.ids) {
      const e = byId.get(id);
      for (const c of a.checks) {
        if (!e) {
          results.push({ id, check: c, pass: false, actual: undefined, text: `${id}: not rated (excluded or missing)` });
          continue;
        }
        const v = val(e, c.attr);
        const pool = pools.get(e.pos)!.map((x) => val(x, c.attr)).filter((x): x is number => x !== undefined);
        let pass = false;
        let text: string;
        const stint = a.ids.length > 1 ? ` [${e.team} ${e.decade}]` : '';
        if (v === undefined) text = `${c.attr}: no value`;
        else if (c.op === '>=') {
          pass = v >= c.value - 0.5; // displayed values are rounded
          text = `${c.attr} ${v.toFixed(1)} (want ≥ ${c.value})`;
          // "99" means the best the position has produced. The scale keeps 99
          // for true outliers (no pileups), so a 99 band also passes at rank
          // 1–3 in the position pool.
          if (!pass && c.value >= 99) {
            const r = rankOf(pool, v);
            pass = r <= 3;
            text += `, rank ${r} of ${pool.length}`;
          }
        } else if (c.op === '<') {
          pass = v < c.value;
          text = `${c.attr} ${v.toFixed(1)} (want < ${c.value})`;
        } else if (c.op === 'pct<=') {
          const p = percentile(pool, v);
          pass = p <= c.value;
          text = `${c.attr} ${v.toFixed(1)}, percentile ${p.toFixed(0)} among ${pool.length} ${e.pos}s (want bottom ${c.value}%)`;
        } else {
          const r = rankOf(pool, v);
          pass = r <= c.value;
          text = `${c.attr} ${c.attr === 'heightIn' ? `${v}"` : v.toFixed(1)}, rank ${r} of ${pool.length} ${e.pos}s (want top ${c.value})`;
        }
        results.push({ id, check: c, pass, actual: v, text: text + stint });
      }
    }
    return { label: a.label, anchor: a, pass: results.every((r) => r.pass), results };
  });
}

// ---------------------------------------------------------------- era parity

export interface ParityRow {
  pos: RatedPos;
  overall: number;
  topN: number;
  decades: Record<string, { top10: number; delta: number; n: number }>;
  flagged: string[];
}

/**
 * Top-N average OVR per decade vs the all-decade average of those top-Ns;
 * flag gaps > 3. N is 10 (the brief) where every decade has at least 20
 * players; the defensive pools hold about 5–15 players per decade, so there
 * N is half the smallest decade (at least 3), the same N for every decade.
 */
export function eraParity(run: RatingRun, tolerance = 3): ParityRow[] {
  const rows: ParityRow[] = [];
  for (const [pos, list] of byPosition(run)) {
    const decs = new Map<string, number[]>();
    for (const e of list) (decs.get(e.decade) ?? decs.set(e.decade, []).get(e.decade)!).push(e.ovr.value);
    const sizes = [...decs.values()].map((x) => x.length).filter((n) => n >= 6);
    const topN = Math.min(10, Math.max(3, Math.floor(Math.min(...sizes) / 2)));
    const tops: Record<string, { top10: number; n: number }> = {};
    for (const [d, xs] of decs) {
      if (xs.length < 6) continue;
      const t = [...xs].sort((a, b) => b - a).slice(0, topN);
      tops[d] = { top10: t.reduce((a, b) => a + b, 0) / t.length, n: xs.length };
    }
    const vals = Object.values(tops).map((x) => x.top10);
    const overall = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const decades: ParityRow['decades'] = {};
    const flagged: string[] = [];
    for (const [d, t] of Object.entries(tops).sort()) {
      decades[d] = { ...t, delta: t.top10 - overall };
      if (Math.abs(t.top10 - overall) > tolerance) flagged.push(d);
    }
    rows.push({ pos, overall, topN, decades, flagged });
  }
  return rows;
}

// ---------------------------------------------------------------- pileups

export interface PileupRow {
  pos: RatedPos;
  attr: string;
  at99: number;
  at95plus: number;
  n: number;
}

/** Players whose displayed value is 99 (≥ 98.5), per position and attribute. */
export function capPileups(run: RatingRun): PileupRow[] {
  const rows: PileupRow[] = [];
  for (const [pos, list] of byPosition(run)) {
    const keys = new Set(list.flatMap((e) => Object.keys(e.attrs)));
    keys.add('ovr');
    for (const attr of keys) {
      const xs = list.map((e) => val(e, attr)).filter((x): x is number => x !== undefined);
      rows.push({ pos, attr, at99: xs.filter((x) => x >= 98.5).length, at95plus: xs.filter((x) => x >= 94.5).length, n: xs.length });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- cross-stint

/** Physical attributes minus the aging curve must match across a person's stints (same position). */
export function crossStintViolations(run: RatingRun, tol = 0.05): string[] {
  const byPerson = new Map<string, Entry[]>();
  for (const e of run.entries) {
    const k = `${e.personId}|${e.pos}`;
    (byPerson.get(k) ?? byPerson.set(k, []).get(k)!).push(e);
  }
  const out: string[] = [];
  for (const stints of byPerson.values()) {
    if (stints.length < 2) continue;
    for (const attr of ['speed', 'agility', 'acceleration', 'strength', 'jumping'] as const) {
      const peaks = stints
        .filter((s) => s.attrs[attr])
        .map((s) => {
          const a = s.attrs[attr]!;
          // Skip clamped values: the clamp breaks the exact identity.
          if (a.contributions.some((c) => c.label.startsWith('Clamped'))) return undefined;
          return a.value - agingDelta(s.pos, s.inputs.age?.v, attr) * (attr === 'acceleration' ? 1 : 1);
        })
        .filter((x): x is number => x !== undefined);
      if (peaks.length < 2) continue;
      const spread = Math.max(...peaks) - Math.min(...peaks);
      if (spread > tol) out.push(`${stints[0]!.name} (${stints[0]!.pos}) ${attr}: peak values differ by ${spread.toFixed(2)} across ${stints.map((s) => `${s.team} ${s.decade}`).join(', ')}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- legacy comparison

function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

export function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

export function legacyCorrelation(run: RatingRun): { overall: number; byPos: Record<string, number> } {
  const byPos: Record<string, number> = {};
  for (const [pos, list] of byPosition(run)) byPos[pos] = spearman(list.map((e) => e.ovr.value), list.map((e) => e.imp));
  // Overall: within-position percentiles, so positions with different imp scales mix fairly.
  const pa: number[] = [];
  const pb: number[] = [];
  for (const list of byPosition(run).values()) {
    const ovr = list.map((e) => e.ovr.value);
    const imp = list.map((e) => e.imp);
    for (const e of list) {
      pa.push(percentile(ovr, e.ovr.value));
      pb.push(percentile(imp, e.imp));
    }
  }
  return { overall: spearman(pa, pb), byPos };
}

export interface Mover {
  entry: Entry;
  ovrPct: number;
  impPct: number;
  delta: number;
  reason: string;
}

/**
 * Biggest movers vs legacy: percentile of OVR minus percentile of imp within
 * the position. The reason names the inputs that moved OVR most, aggregated
 * over the attributes by their OVR weights.
 */
export function movers(run: RatingRun, n = 50): { up: Mover[]; down: Mover[] } {
  const all: Mover[] = [];
  for (const list of byPosition(run).values()) {
    const ovr = list.map((e) => e.ovr.value);
    const imp = list.map((e) => e.imp);
    for (const e of list) {
      const ovrPct = percentile(ovr, e.ovr.value);
      const impPct = percentile(imp, e.imp);
      all.push({ entry: e, ovrPct, impPct, delta: ovrPct - impPct, reason: reasonFor(e, Math.sign(ovrPct - impPct)) });
    }
  }
  all.sort((a, b) => b.delta - a.delta);
  return { up: all.slice(0, n), down: all.slice(-n).reverse() };
}

export function reasonFor(e: Entry, sign: number): string {
  const w = OVR_WEIGHTS[e.pos];
  const agg = new Map<string, { d: number; input?: string }>();
  for (const [attr, wt] of Object.entries(w)) {
    const a = e.attrs[attr];
    if (!a) continue;
    for (const c of a.contributions) {
      if (c.kind === 'base') continue;
      const key = c.label;
      const x = agg.get(key) ?? { d: 0, input: c.input };
      x.d += wt * c.delta;
      agg.set(key, x);
    }
  }
  const top = [...agg.entries()]
    .filter(([, x]) => Math.sign(x.d) === sign || sign === 0)
    .sort((a, b) => Math.abs(b[1].d) - Math.abs(a[1].d))
    .slice(0, 3);
  return top.map(([label, x]) => `${label}${x.input ? ` (${x.input})` : ''} ${x.d >= 0 ? '+' : ''}${x.d.toFixed(1)}`).join('; ');
}
