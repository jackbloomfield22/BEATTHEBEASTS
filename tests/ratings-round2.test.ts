// PR #3 round 2 (user-approved): added stints, era-adjusted Ball Security,
// cited 40 times. Structure and precedence checks; the report shows the
// before/after.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFENSE, PLAYERS } from '@data/legacy';
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
    const { entries } = applyAddedStints(added, DEFENSE, PLAYERS);
    const w = entries.find((e) => e.id === 'defense:reggie-white:PHI:1990s')!;
    expect(w.s.sk).toBe(43);
    expect(w.imp).toBe(DEFENSE.find((d) => d.id === 'defense:reggie-white:PHI:1980s')!.imp);
    expect(inputs.some((i) => i.id === w.id)).toBe(true);
  });

  it('adds the four M4.5 stints the user named, with imp from impFrom and 1999+ stats from nflverse', () => {
    const { entries, offense } = applyAddedStints(added, DEFENSE, PLAYERS);
    const ids = [...entries, ...offense].map((e) => e.id);
    for (const id of ['defense:deion-sanders:ATL:1990s', 'defense:deion-sanders:SF:1990s', 'players:randy-moss:MIN:2000s', 'players:terrell-owens:SF:2000s', 'defense:charles-woodson:LV:1990s', 'defense:charles-woodson:LV:2000s']) {
      expect(ids, id).toContain(id);
      const r = added.stints.find((x) => x.id === id)!;
      const e = [...entries, ...offense].find((x) => x.id === id)!;
      expect(e.imp, id).toBe([...DEFENSE, ...PLAYERS].find((d) => d.id === r.impFrom)!.imp);
      const inp = inputs.find((i) => i.id === id)!;
      expect(inp, id).toBeDefined();
      if (r.seasons.every((y) => y >= 1999)) expect(inp.games.conf, id).toBe('verified');
    }
    expect(offense.find((e) => e.id === 'players:randy-moss:MIN:2000s')!.s.y).toBeCloseTo(6416 / 77, 1);
    const moss = inputs.find((i) => i.id === 'players:randy-moss:MIN:2000s')!;
    expect(moss.stats.recYdsPerGame!.conf).toBe('verified');
    expect(moss.seasons.v).toEqual([2000, 2001, 2002, 2003, 2004]);
  });

  it('adds the M6.6 stints (the four the user named, and the audit\'s All-Pro seasons), each in its position\'s legacy line shape', () => {
    const { offense } = applyAddedStints(added, DEFENSE, PLAYERS);
    const m66 = ['players:stefon-diggs:NE:2020s', 'players:a-j-brown:TEN:2020s', 'players:davante-adams:GB:2020s', 'players:derrick-henry:TEN:2010s', 'players:dan-fouts:LAC:1980s', 'players:barry-sanders:DET:1980s', 'players:john-jefferson:LAC:1980s', 'players:joe-montana:SF:1990s', 'players:kurt-warner:LAR:1990s', 'players:tyreek-hill:KC:2020s'];
    for (const id of m66) {
      const e = offense.find((x) => x.id === id);
      expect(e, id).toBeDefined();
      expect(inputs.some((i) => i.id === id), id).toBe(true);
      // The legacy schema of the position (data/legacy/types.ts).
      const keys = Object.keys(e!.s).sort().join(',');
      if (e!.p === 'QB') expect(keys, id).toBe('i,r,ry,t,y');
      else if (e!.p === 'RB') expect(keys, id).toBe('c,r,t,y');
      else expect(e!.s.y, id).toBeGreaterThan(0);
    }
    // Barry Sanders 1989: 1,470 rushing yards on 280 carries in 15 games (cited table).
    const barry = offense.find((x) => x.id === 'players:barry-sanders:DET:1980s')!;
    expect(barry.s.y).toBeCloseTo(1470 / 15, 1);
    expect(barry.s.c).toBeCloseTo(1470 / 280, 1);
    // Dan Fouts 1980–87: the estimated-stats slot carries his passing rates from the cited lines.
    const fouts = S.estStats['players:dan-fouts:LAC:1980s']!;
    expect(fouts.attemptsPerGame).toBeCloseTo(3599 / 101, 6);
    expect(fouts.cmpPct).toBeCloseTo((100 * 2156) / 3599, 6);
    // Kurt Warner 1999: nflverse misses the Rams' week-1 game; the ratings read nflverse's 15 games.
    const warner = added.stints.find((x) => x.id === 'players:kurt-warner:LAR:1990s')!;
    expect(warner.nflverse!.games['1999']).toBe(15);
    expect(warner.bySeason['1999']!.games).toBe(16);
  });

  it('the loader refuses a bad record', () => {
    const base = added.stints[0]!;
    const bad = (patch: object) => () => applyAddedStints({ stints: [{ ...structuredClone(base), ...patch }] }, DEFENSE);
    expect(bad({ id: 'defense:reggie-white:PHI:1980s' })).toThrow(/already exists/);
    expect(bad({ totals: { ...base.totals, sk: 44 } })).toThrow(/total/);
    expect(bad({ personOf: 'defense:bruce-smith:BUF:1990s' })).toThrow(/name/);
    expect(bad({ seasons: [1989, 1990] })).toThrow(/decade|line/);
    expect(bad({ source: { ...base.source, permalink: '' } })).toThrow(/source/);
    const moss = added.stints.find((x) => x.id === 'players:randy-moss:MIN:2000s')!;
    expect(() => applyAddedStints({ stints: [{ ...structuredClone(moss), nflverse: undefined }] }, DEFENSE, PLAYERS)).toThrow(/nflverse/);
    expect(() => applyAddedStints({ stints: [{ ...structuredClone(moss), impFrom: 'players:terrell-owens:SF:1990s' }] }, DEFENSE, PLAYERS)).toThrow(/name/);
    // A quarterback's record needs the passing line.
    const fouts = structuredClone(added.stints.find((x) => x.id === 'players:dan-fouts:LAC:1980s')!);
    delete fouts.totals.passTd;
    expect(() => applyAddedStints({ stints: [fouts] }, DEFENSE, PLAYERS)).toThrow(/passTd/);
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
