import { PHYSICAL_BY_POS, SKILL_ATTRS, attrLabel } from '@/engine/ratings/attributes';
import type { RatingRun } from '@/engine/ratings/engine';
import { CARD_ATTRS } from '@/engine/ratings/ovrWeights';
import type { RatedEntry, RatedPos } from '@/engine/ratings/types';

// View model for the Ratings Explorer: percentiles and column sets.

export const POSITIONS: RatedPos[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DE', 'DT', 'LB', 'CB', 'S'];
export const DECADES = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

export function attrKeys(pos: RatedPos): string[] {
  return [...PHYSICAL_BY_POS[pos], ...SKILL_ATTRS[pos].map((d) => d.key)];
}

export function attrNote(pos: RatedPos, key: string): string | undefined {
  return SKILL_ATTRS[pos].find((d) => d.key === key)?.note;
}

export { attrLabel, CARD_ATTRS };

export interface Model {
  run: RatingRun;
  byId: Map<string, RatedEntry>;
  /** Sorted values per `${pos}|${attr}` and `${pos}|${decade}|${attr}` (attr 'ovr' included). */
  sorted: Map<string, number[]>;
}

export function buildModel(run: RatingRun): Model {
  const sorted = new Map<string, number[]>();
  const push = (k: string, v: number) => (sorted.get(k) ?? sorted.set(k, []).get(k)!).push(v);
  for (const e of run.entries) {
    push(`${e.pos}|ovr`, e.ovr.value);
    push(`${e.pos}|${e.decade}|ovr`, e.ovr.value);
    for (const [k, a] of Object.entries(e.attrs)) {
      push(`${e.pos}|${k}`, a.value);
      push(`${e.pos}|${e.decade}|${k}`, a.value);
    }
  }
  for (const xs of sorted.values()) xs.sort((a, b) => a - b);
  return { run, byId: new Map(run.entries.map((e) => [e.id, e])), sorted };
}

/** Percentile (0–100) of v in a sorted list: share below plus half the ties. */
export function pct(sorted: readonly number[] | undefined, v: number): number {
  if (!sorted || !sorted.length) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m]! < v) lo = m + 1;
    else hi = m;
  }
  let eq = lo;
  while (eq < sorted.length && sorted[eq] === v) eq++;
  return (100 * (lo + 0.5 * (eq - lo))) / sorted.length;
}

export function valueOf(e: RatedEntry, key: string): number | undefined {
  if (key === 'ovr') return e.ovr.value;
  if (key === 'imp') return e.imp;
  return e.attrs[key]?.value;
}

export function toCsv(list: readonly RatedEntry[]): string {
  const keys = new Set<string>();
  for (const e of list) for (const k of Object.keys(e.attrs)) keys.add(k);
  const cols = [...keys];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ['id', 'name', 'pos', 'team', 'decade', 'imp', 'ovr', 'ovr_conf', ...cols, 'traits', 'games', 'seasons', 'height_in', 'weight_lb'];
  const rows = list.map((e) =>
    [
      e.id,
      e.name,
      e.pos,
      e.team,
      e.decade,
      String(e.imp),
      e.ovr.value.toFixed(1),
      e.ovr.conf,
      ...cols.map((k) => (e.attrs[k] ? e.attrs[k]!.value.toFixed(1) : '')),
      e.traits.map((t) => t.id).join(' '),
      String(e.inputs.games.v),
      e.inputs.seasons.v.join(' '),
      e.inputs.heightIn ? String(e.inputs.heightIn.v) : '',
      e.inputs.weightLb ? String(e.inputs.weightLb.v) : '',
    ]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...rows].join('\n') + '\n';
}
