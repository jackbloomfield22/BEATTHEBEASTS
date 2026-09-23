// Checks the pre-1999 estimated statistics layer
// (data/augment/estimated_stats_pre1999.json, method in
// tools/reference/estimated_stats_notes.md). Offline: it reads only the JSON
// and the generated legacy data.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFENSE, PLAYERS } from '@data/legacy';

interface Estimate {
  readonly name: string;
  readonly seasons: readonly [number, number];
  readonly games: number;
  readonly src: string;
  readonly conf: string;
  readonly certainty: 'high' | 'med' | 'low';
  readonly note: string;
  readonly cmpPct?: number;
  readonly ypa?: number;
  readonly tdPct?: number;
  readonly intPct?: number;
  readonly sackPct?: number;
  readonly sackPctConf?: string;
  readonly attemptsPerGame?: number;
  readonly rushAttPerGame?: number;
  readonly carriesPerGame?: number;
  readonly recPerGame?: number;
  readonly fumbles?: number;
  readonly fumblesPerTouch?: number;
  readonly fumblesConf?: string;
  readonly yardsPerRec?: number;
}

const PATH = new URL('../data/augment/estimated_stats_pre1999.json', import.meta.url);
const raw = JSON.parse(readFileSync(PATH, 'utf8')) as Record<string, unknown>;
const entries = Object.entries(raw).filter(([k]) => !k.startsWith('_')) as [string, Estimate][];
const byId = new Map<string, { n: string; p: string; d: string }>();
for (const e of [...PLAYERS, ...DEFENSE]) byId.set(e.id, e);

const get = (id: string): Estimate => {
  const e = raw[id] as Estimate | undefined;
  if (!e) throw new Error(`missing estimate ${id}`);
  return e;
};

const inRange = (id: string, field: string, v: number | undefined, lo: number, hi: number) => {
  expect(v, `${id} ${field}`).toBeTypeOf('number');
  expect(v!, `${id} ${field}=${v}`).toBeGreaterThanOrEqual(lo);
  expect(v!, `${id} ${field}=${v}`).toBeLessThanOrEqual(hi);
};

describe('estimated pre-1999 stats', () => {
  it('has a meaningful number of entries', () => {
    expect(entries.length).toBeGreaterThan(400);
  });

  it('every key is a real legacy entry id and the name matches', () => {
    for (const [id, e] of entries) {
      const legacy = byId.get(id);
      expect(legacy, id).toBeDefined();
      expect(e.name, id).toBe(legacy!.n);
    }
  });

  it('every value is flagged as an estimate', () => {
    for (const [id, e] of entries) {
      expect(e.src, id).toBe('estimate:knowledge');
      expect(e.conf, id).toBe('estimated');
      expect(['high', 'med', 'low'], id).toContain(e.certainty);
      expect(typeof e.note, id).toBe('string');
    }
  });

  it('seasons fall inside the entry decade, before 1999, and games fit the seasons', () => {
    for (const [id, e] of entries) {
      const decadeStart = Number(byId.get(id)!.d.slice(0, 4));
      const [first, last] = e.seasons;
      expect(Number.isInteger(first) && Number.isInteger(last), id).toBe(true);
      expect(first, id).toBeGreaterThanOrEqual(decadeStart);
      expect(last, id).toBeLessThanOrEqual(Math.min(decadeStart + 9, 1998));
      expect(first, id).toBeLessThanOrEqual(last);
      expect(Number.isInteger(e.games) && e.games > 0, id).toBe(true);
      // No season before 1978 had more than 14 games; none had more than 16.
      expect(e.games, id).toBeLessThanOrEqual((last - first + 1) * 16);
    }
  });

  it('only covers the in-scope eras', () => {
    for (const [id] of entries) {
      const { d } = byId.get(id)!;
      const allowed = id.startsWith('defense:') ? ['1960s', '1970s', '1980s', '1990s'] : ['1970s', '1980s', '1990s'];
      expect(allowed, id).toContain(d);
    }
  });

  it('position fields are present and in sane ranges', () => {
    for (const [id, e] of entries) {
      const pos = byId.get(id)!.p;
      if (id.startsWith('defense:')) {
        expect(e.cmpPct ?? e.carriesPerGame ?? e.recPerGame, id).toBeUndefined();
        continue;
      }
      if (pos === 'QB') {
        inRange(id, 'cmpPct', e.cmpPct, 35, 72);
        inRange(id, 'ypa', e.ypa, 5, 10);
        inRange(id, 'tdPct', e.tdPct, 1, 10);
        inRange(id, 'intPct', e.intPct, 0.5, 8);
        inRange(id, 'sackPct', e.sackPct, 1, 13);
        inRange(id, 'attemptsPerGame', e.attemptsPerGame, 10, 45);
        inRange(id, 'rushAttPerGame', e.rushAttPerGame, 0, 8);
        // Sacks became official in 1982.
        if (e.seasons[0] < 1982) expect(e.sackPctConf, id).toBe('low');
      } else if (pos === 'RB') {
        inRange(id, 'carriesPerGame', e.carriesPerGame, 2, 30);
        // Some pure runners (George Rogers WAS) caught < 0.5 per game, so the
        // RB floor is lower than the WR/TE one.
        inRange(id, 'recPerGame', e.recPerGame, 0.2, 7);
        inRange(id, 'fumblesPerTouch', e.fumblesPerTouch, 0.002, 0.04);
        expect(e.fumblesConf, id).toBe('low');
      } else {
        inRange(id, 'recPerGame', e.recPerGame, 0.5, 9.5);
        inRange(id, 'yardsPerRec', e.yardsPerRec, 6, 25);
      }
    }
  });

  it('spot values match well-known careers', () => {
    expect(get('players:dan-marino:MIA:1980s').sackPct!).toBeLessThan(3);
    expect(get('players:joe-montana:SF:1980s').cmpPct!).toBeGreaterThan(62);
    expect(get('players:walter-payton:CHI:1980s').carriesPerGame!).toBeGreaterThan(18);
    expect(get('players:steve-young:SF:1990s').ypa!).toBeGreaterThan(8);
    expect(get('players:randall-cunningham:PHI:1980s').sackPct!).toBeGreaterThan(10);
    expect(get('players:jerry-rice:SF:1990s').recPerGame!).toBeGreaterThan(5.5);
    expect(get('defense:deion-sanders:ATL:1980s').seasons).toEqual([1989, 1989]);
  });
});
