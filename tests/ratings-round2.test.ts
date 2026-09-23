// PR #3 round 2 (user-approved): added stints, era-adjusted Ball Security,
// cited 40 times. Structure and precedence checks; the report shows the
// before/after.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFENSE } from '@data/legacy';
import { applyAddedStints, type AddedStintsFile } from '@/engine/data/addedStints';
import { buildInputs } from '@/engine/ratings/inputs';
import { CITED_FORTY_CONF, fortyCorrection } from '@/engine/ratings/physical';
import { SIGNALS } from '@/engine/ratings/signals';
import { loadSources } from '../tools/ratings/sources';

const added = JSON.parse(readFileSync('data/augment/added_stints.json', 'utf8')) as AddedStintsFile;
const baselines = JSON.parse(readFileSync('data/era_baselines.json', 'utf8')) as { seasons: Record<string, { rbFumblesPerTouch?: number; afl?: { rbFumblesPerTouch?: number } }> };
const forty = JSON.parse(readFileSync('data/augment/forty_times.json', 'utf8')) as { people: Record<string, { kind: string; conf: string; forty: number }> };
const S = loadSources();
const { inputs } = buildInputs(S);

describe('added stints', () => {
  it('the committed file validates and adds Reggie White (PHI 1990s)', () => {
    const { entries } = applyAddedStints(added, DEFENSE);
    const w = entries.find((e) => e.id === 'defense:reggie-white:PHI:1990s')!;
    expect(w.s.sk).toBe(43);
    expect(w.imp).toBe(DEFENSE.find((d) => d.id === 'defense:reggie-white:PHI:1980s')!.imp);
    expect(inputs.some((i) => i.id === w.id)).toBe(true);
  });

  it('the loader refuses a bad record', () => {
    const base = added.stints[0]!;
    const bad = (patch: object) => () => applyAddedStints({ stints: [{ ...structuredClone(base), ...patch }] }, DEFENSE);
    expect(bad({ id: 'defense:reggie-white:PHI:1980s' })).toThrow(/already exists/);
    expect(bad({ totals: { ...base.totals, sk: 44 } })).toThrow(/total/);
    expect(bad({ personOf: 'defense:bruce-smith:BUF:1990s' })).toThrow(/name/);
    expect(bad({ seasons: [1989, 1990] })).toThrow(/decade|line/);
    expect(bad({ source: { ...base.source, permalink: '' } })).toThrow(/source/);
  });
});

describe('Ball Security era baseline', () => {
  it('every season has a league RB fumble rate, AFL rows too', () => {
    for (const [y, r] of Object.entries(baselines.seasons)) {
      expect(r.rbFumblesPerTouch, y).toBeGreaterThan(0);
      if (r.afl) expect(r.afl.rbFumblesPerTouch, `${y} AFL`).toBeGreaterThan(0);
    }
  });

  it('fumbles per touch is read against the league rate', () => {
    const e = inputs.find((i) => i.id === 'players:walter-payton:CHI:1970s')!;
    const v = SIGNALS.r_fum!.get(e, undefined as never)!;
    expect(e.baseline.fumblesPerTouch).toBeGreaterThan(0.02);
    expect(v.input).toContain('vs league');
    expect(v.x).toBeCloseTo(Math.log((e.stats.fumblesPerTouch!.v + 0.002) / (e.baseline.fumblesPerTouch! + 0.002)), 9);
  });
});

describe('cited 40 times', () => {
  it('a cited time never replaces a measured one, and is used where there is none', () => {
    const byPerson = new Map<string, (typeof inputs)[number][]>();
    for (const i of inputs) (byPerson.get(i.personId) ?? byPerson.set(i.personId, []).get(i.personId)!).push(i);
    let cited = 0;
    for (const [pid, r] of Object.entries(forty.people)) {
      for (const i of byPerson.get(pid) ?? []) {
        const f = i.measurables.forty!;
        expect(f, i.id).toBeDefined();
        if (r.kind === 'cited') {
          expect(['verified', 'reference', 'estimated'], i.id).toContain(f.conf);
          if (f.conf === 'estimated') {
            expect(f.src, i.id).toContain('[cited');
            cited++;
          }
        }
      }
    }
    expect(cited).toBeGreaterThan(20);
  });

  it('cited confidence sits between the body prior and a measured time; timing sets the correction', () => {
    expect(CITED_FORTY_CONF).toBeGreaterThan(0.4);
    expect(CITED_FORTY_CONF).toBeLessThan(0.9);
    expect(fortyCorrection({ conf: 'estimated', src: 'cited40:x [cited, hand]' })).toBeCloseTo(0.06, 9);
    expect(fortyCorrection({ conf: 'estimated', src: 'cited40:x [cited, pro day]' })).toBeCloseTo(0.05, 9);
    expect(fortyCorrection({ conf: 'estimated', src: 'cited40:x [cited, combine]' })).toBeCloseTo(0.03, 9);
  });
});
