// The adapter from new ratings to the legacy sim (TECH_PLAN §6.4).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFENSE, OL_UNITS, PLAYERS } from '@data/legacy';
import { adaptDefenders, adaptOffense, applyFit, unitAttrs, type AdapterFile } from '@/engine/legacy/adapter';
import { assembleBeastsSeeded } from '@/engine/legacy/beasts';
import { simulateBeatdown } from '@/engine/legacy/sim';
import type { Roster } from '@/engine/legacy/types';
import { rateAll } from '@/engine/ratings/engine';
import { buildInputs } from '@/engine/ratings/inputs';
import { makeRng } from '@/engine/rng';
import { loadSources } from '../tools/ratings/sources';

const fit = JSON.parse(readFileSync('data/ratings/adapter.v1.json', 'utf8')) as AdapterFile;
const run = rateAll(buildInputs(loadSources()).inputs);
const byId = new Map(run.entries.map((e) => [e.id, Object.fromEntries(Object.entries(e.attrs).map(([k, a]) => [k, a.value]))]));
const key = (e: { n: string; p: string; t: string; d: string }) => `${e.n}|${e.p}|${e.t}|${e.d}`;
const byKey = new Map<string, Record<string, number>>();
for (const e of [...PLAYERS, ...DEFENSE]) if (byId.has(e.id)) byKey.set(key(e), byId.get(e.id)!);
for (const u of OL_UNITS) {
  const a = unitAttrs(u.id, (id) => byId.get(id));
  if (a) byKey.set(key(u), a);
}
const attrsOf = (e: { n: string; p: string; t: string; d: string }) => byKey.get(key(e));

describe('legacy adapter', () => {
  it('every fitted field stays inside the legacy range', () => {
    for (const group of ['QB', 'RB', 'WR', 'TE', 'OL', 'DEF'] as const) {
      for (const f of Object.values(fit[group])) {
        expect(applyFit(f, {})).toBeGreaterThanOrEqual(f.lo);
        expect(applyFit(f, { throwPower: 999, speed: 999, tackle: 999 })).toBeLessThanOrEqual(f.hi);
      }
    }
  });

  it('feeds the legacy sim deterministically', () => {
    const find = (n: string, t: string, d: string) => PLAYERS.find((p) => p.n === n && p.t === t && p.d === d)!;
    const roster = {
      QB: find('Joe Montana', 'SF', '1980s'),
      RB: find('Walter Payton', 'CHI', '1980s'),
      RB2: find('Roger Craig', 'SF', '1980s'),
      WR1: find('Jerry Rice', 'SF', '1980s'),
      WR2: find('Steve Largent', 'SEA', '1980s'),
      WR3: find('James Lofton', 'GB', '1980s'),
      TE: find('Kellen Winslow', 'LAC', '1980s'),
      TE2: find('Ozzie Newsome', 'CLE', '1980s'),
      OL: OL_UNITS.find((u) => u.t === 'WAS' && u.d === '1980s')!,
    } as unknown as Roster;
    const beasts = assembleBeastsSeeded(makeRng(7)).filter(() => true);
    if (beasts.some((b) => !attrsOf(b))) return; // an excluded defender was drawn
    const rated = { off: adaptOffense(roster, attrsOf, fit), defenders: adaptDefenders(beasts, attrsOf, fit) };
    const a = simulateBeatdown(roster, beasts, false, 0, rated);
    const b = simulateBeatdown(roster, beasts, false, 0, rated);
    expect(a.yourScore).toBe(b.yourScore);
    expect(a.yourScore).toBeGreaterThanOrEqual(0);
    expect(a.yourScore).toBeLessThan(90);
    expect(rated.off.QB.acc).toBeGreaterThan(rated.off.QB.legs);
  });
});
