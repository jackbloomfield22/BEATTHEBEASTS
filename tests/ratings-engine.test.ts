// Structural tests of the ratings engine: definitions, the imp cap, the
// curve, contributions, and the corrections loader.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFENSE, OL_UNITS, PLAYERS } from '@data/legacy';
import { applyCorrections, validateCorrectionsFile, type CorrectionsFile } from '@/engine/data/corrections';
import { IMP_MAX_SHARE, SKILL_ATTRS } from '@/engine/ratings/attributes';
import { OVR_WEIGHTS } from '@/engine/ratings/ovrWeights';
import { composeFromZ, normInv, poolScale, sumContributions, zToRating } from '@/engine/ratings/scale';
import { SIGNALS } from '@/engine/ratings/signals';
import { gamesPerSeason, passerRating, pickFive, type OlRosterLineman } from '@/engine/ratings/inputs';
import type { RatedPos } from '@/engine/ratings/types';

const POSITIONS = Object.keys(SKILL_ATTRS) as RatedPos[];

describe('attribute definitions', () => {
  for (const pos of POSITIONS) {
    for (const def of SKILL_ATTRS[pos]) {
      it(`${pos} ${def.key}: weights sum to 1, known signals, imp ≤ ${IMP_MAX_SHARE * 100}%`, () => {
        const total = def.terms.reduce((a, t) => a + t.w, 0);
        expect(total).toBeCloseTo(1, 9);
        for (const t of def.terms) for (const s of typeof t.s === 'string' ? [t.s] : t.s) expect(SIGNALS[s], `${def.key} uses unknown signal ${s}`).toBeDefined();
        const imp = def.terms.filter((t) => (typeof t.s === 'string' ? [t.s] : t.s).includes('imp')).reduce((a, t) => a + t.w, 0);
        expect(imp / total).toBeLessThanOrEqual(IMP_MAX_SHARE + 1e-12);
        expect(def.terms.filter((t) => (typeof t.s === 'string' ? [t.s] : t.s).includes('imp')).length).toBeLessThanOrEqual(1);
      });
    }
  }

  it('attribute keys are unique per position', () => {
    for (const pos of POSITIONS) {
      const keys = SKILL_ATTRS[pos].map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('OVR weights sum to 1 and name real attributes', () => {
    const physical = ['speed', 'acceleration', 'agility', 'strength', 'stamina', 'jumping'];
    for (const pos of POSITIONS) {
      const w = OVR_WEIGHTS[pos];
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      for (const k of Object.keys(w)) expect(SKILL_ATTRS[pos].some((d) => d.key === k) || physical.includes(k), `${pos} OVR uses ${k}`).toBe(true);
    }
  });
});

describe('scale', () => {
  it('the curve is monotone and bounded', () => {
    let prev = -Infinity;
    for (let z = -6; z <= 6; z += 0.01) {
      const r = zToRating(z);
      expect(r).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(99.3);
      prev = r;
    }
    expect(zToRating(0)).toBe(72);
    expect(zToRating(1.64)).toBeCloseTo(90, 6);
  });

  it('normInv matches known quantiles', () => {
    expect(normInv(0.5)).toBeCloseTo(0, 9);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.0005)).toBeCloseTo(-3.290527, 5);
  });

  it('pool scale maps the expected pool best to the same place', () => {
    expect(poolScale(1000) * normInv(1 - 0.5 / 1000)).toBeCloseTo(3.3, 9);
    expect(poolScale(54)).toBeGreaterThan(poolScale(1000));
  });

  it('contributions sum exactly to the value, including the clamp', () => {
    const terms = [
      { label: 'a', z: 1.2, kind: 'stat' as const, weight: 0.5, conf: 'verified' as const },
      { label: 'b', z: -0.4, kind: 'stat' as const, weight: 0.3, conf: 'estimated' as const },
      { label: 'c', z: 0.9, kind: 'reputation' as const, weight: 0.2, conf: 'legacy' as const },
    ];
    for (const scale of [0.5, 1, 3, 12]) {
      const r = composeFromZ(72, terms, scale);
      expect(sumContributions(r)).toBeCloseTo(r.value, 9);
    }
    const low = composeFromZ(10, terms, -20);
    expect(low.value).toBe(1);
    expect(sumContributions(low)).toBeCloseTo(1, 9);
  });
});

describe('input helpers', () => {
  it('passer rating matches the NFL formula', () => {
    // Aaron Rodgers 2011: 343/502, 4643 yds, 45 TD, 6 INT = 122.5
    expect(passerRating(343, 502, 4643, 45, 6)).toBeCloseTo(122.5, 1);
  });

  it('season lengths', () => {
    expect(gamesPerSeason(1975)).toBe(14);
    expect(gamesPerSeason(1982)).toBe(9);
    expect(gamesPerSeason(1990)).toBe(16);
    expect(gamesPerSeason(2023)).toBe(17);
  });

  it('picks key-list linemen first and fills slots by position', () => {
    const l = (name: string, positions: string[], count: number, key: number[] | false = false): OlRosterLineman => ({ personId: name, name, positions, count, seasons: [], inKeyList: key });
    const five = pickFive([l('G1', ['G'], 9), l('T1', ['T'], 3, [0]), l('C1', ['C'], 8), l('T2', ['OT'], 7), l('G2', ['OG'], 6), l('X', ['G'], 1)]);
    expect(five.map((x) => x?.name)).toEqual(['T1', 'G1', 'C1', 'G2', 'T2']);
  });
});

describe('corrections loader', () => {
  const file = validateCorrectionsFile(JSON.parse(readFileSync('data/corrections.json', 'utf8')));

  it('every correction in data/corrections.json applies (old values match legacy)', () => {
    expect(() => applyCorrections(PLAYERS, file)).not.toThrow();
    expect(() => applyCorrections(DEFENSE, file)).not.toThrow();
    expect(() => applyCorrections(OL_UNITS, file)).not.toThrow();
  });

  it('refuses a correction whose old value does not match', () => {
    const bad: CorrectionsFile = {
      version: 1,
      corrections: [{ id: PLAYERS[0]!.id, op: 'set', field: 's.y', old: -1, new: 1, reason: 'test', source: 'test', conf: 'verified' }],
    };
    expect(() => applyCorrections(PLAYERS, bad)).toThrow(/expected old value/);
  });

  it('never mutates legacy objects', () => {
    const target = PLAYERS.find((p) => p.id === 'players:ja-marr-chase:CIN:2020s')!;
    const before = JSON.stringify(target);
    const { entries } = applyCorrections(PLAYERS, file);
    expect(JSON.stringify(target)).toBe(before);
    expect(entries.find((p) => p.id === target.id)!.s.c).toBeLessThan(80);
  });
});
