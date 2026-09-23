// Arm-strength inputs for QB Throw Power (data/augment/arm_strength.json, built
// by tools/augment/arm.ts). Runs offline against the committed JSON only.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLAYERS } from '@data/legacy';

interface AirYardsRec {
  name: string;
  personId: string;
  seasons: number[];
  stintSeasons: number;
  partial: boolean;
  attempts: number;
  completions: number;
  airYards: number;
  intendedAirYardsPerAtt: number;
  completedAirYardsPerCmp: number | null;
  league: { intendedAirYardsPerAtt: number; completedAirYardsPerCmp: number | null };
  iayRatio: number;
  bySeason: Record<string, [number, number]>;
  src: string;
  conf: string;
}

interface LeagueRec {
  attempts: number;
  airYards: number;
  intendedAirYardsPerAtt: number;
  completions: number;
  completedAirYards: number;
  completedAirYardsPerCmp: number;
}

interface BigArmRec {
  name: string;
  entryIds: string[];
  grade: string;
  evidence: string;
  basis: string;
  scope?: string;
  sources: { title: string; url: string; note: string; kind: string; quoteVerified: boolean; retrieved: string }[];
  src: string;
  conf: string;
}

interface ArmFile {
  _meta: {
    coverage: {
      seasonsWithAirYards: number[];
      seasonsMissingAirYards: { season: number }[];
      belowMinAttempts: Record<string, number>;
      airYardsEntries: number;
    };
  };
  league: Record<string, LeagueRec>;
  airYards: Record<string, AirYardsRec>;
  bigArm: BigArmRec[];
}

const file = fileURLToPath(new URL('../data/augment/arm_strength.json', import.meta.url));
const data = JSON.parse(readFileSync(file, 'utf8')) as ArmFile;
const byId = new Map(PLAYERS.map((p) => [p.id, p]));
const isQb = (id: string): boolean => byId.get(id)?.p === 'QB';

/**
 * Real outliers above 12 intended air yards per attempt, checked against the
 * weekly rows: Tim Tebow's Denver 2010–11 (82 att at 12.3, 271 att at 12.9),
 * a famously all-or-nothing deep passing game.
 */
const OUTLIERS = new Set(['players:tim-tebow:DEN:2010s']);

describe('arm_strength.json: air yards (nflverse, 2006+)', () => {
  const recs = Object.entries(data.airYards);

  it('covers a meaningful share of the 2006+ QB stints', () => {
    expect(recs.length).toBeGreaterThan(200);
    expect(data._meta.coverage.airYardsEntries).toBe(recs.length);
  });

  it('keys are legacy QB entries and names match', () => {
    for (const [id, r] of recs) {
      expect(isQb(id), id).toBe(true);
      expect(r.name).toBe(byId.get(id)?.n);
    }
  });

  it('rates are in a plausible range with at least 50 attempts', () => {
    for (const [id, r] of recs) {
      expect(r.attempts, id).toBeGreaterThanOrEqual(50);
      expect(r.intendedAirYardsPerAtt, id).toBeGreaterThanOrEqual(4);
      expect(r.intendedAirYardsPerAtt, id).toBeLessThanOrEqual(OUTLIERS.has(id) ? 13 : 12);
      expect(r.intendedAirYardsPerAtt, id).toBeCloseTo(r.airYards / r.attempts, 3);
      if (r.completedAirYardsPerCmp !== null) {
        expect(r.completedAirYardsPerCmp, id).toBeGreaterThan(2);
        expect(r.completedAirYardsPerCmp, id).toBeLessThan(12);
      }
      expect(r.iayRatio, id).toBeCloseTo(r.intendedAirYardsPerAtt / r.league.intendedAirYardsPerAtt, 2);
      expect(r.src).toBe('nflverse:stats_player_week');
      expect(r.conf).toBe('verified');
    }
  });

  it('only covers seasons that have air yards, and bySeason adds up', () => {
    const have = new Set(data._meta.coverage.seasonsWithAirYards);
    for (const [id, r] of recs) {
      expect(r.seasons.length, id).toBeGreaterThan(0);
      let att = 0;
      let air = 0;
      for (const y of r.seasons) {
        expect(have.has(y), `${id} ${y}`).toBe(true);
        expect(y, id).toBeGreaterThanOrEqual(2006);
        const s = r.bySeason[String(y)];
        expect(s, `${id} ${y}`).toBeDefined();
        att += s![0];
        air += s![1];
      }
      expect(att, id).toBe(r.attempts);
      expect(air, id).toBeCloseTo(r.airYards, 6);
      expect(r.partial, id).toBe(r.seasons.length < r.stintSeasons);
    }
  });

  it('has a league average for every covered season, and the per-entry baseline sits within them', () => {
    for (const y of data._meta.coverage.seasonsWithAirYards) {
      const L = data.league[String(y)];
      expect(L, String(y)).toBeDefined();
      expect(L!.intendedAirYardsPerAtt).toBeGreaterThan(7);
      expect(L!.intendedAirYardsPerAtt).toBeLessThan(10);
      expect(L!.intendedAirYardsPerAtt).toBeCloseTo(L!.airYards / L!.attempts, 3);
      expect(L!.completedAirYardsPerCmp).toBeGreaterThan(5);
      expect(L!.completedAirYardsPerCmp).toBeLessThan(8);
    }
    for (const [id, r] of recs) {
      const lg = r.seasons.map((y) => data.league[String(y)]!.intendedAirYardsPerAtt);
      expect(r.league.intendedAirYardsPerAtt, id).toBeGreaterThanOrEqual(Math.min(...lg) - 1e-3);
      expect(r.league.intendedAirYardsPerAtt, id).toBeLessThanOrEqual(Math.max(...lg) + 1e-3);
    }
  });

  it('reports the seasons nflverse has no air yards for (1999–2005)', () => {
    expect(data._meta.coverage.seasonsMissingAirYards.map((m) => m.season)).toEqual([1999, 2000, 2001, 2002, 2003, 2004, 2005]);
    expect(data._meta.coverage.seasonsWithAirYards[0]).toBe(2006);
  });

  it('left-out low-volume stints are legacy QBs below 50 attempts', () => {
    for (const [id, att] of Object.entries(data._meta.coverage.belowMinAttempts)) {
      expect(isQb(id), id).toBe(true);
      expect(att).toBeLessThan(50);
      expect(data.airYards[id]).toBeUndefined();
    }
  });
});

describe('arm_strength.json: big-arm list (estimated, cited)', () => {
  it('has 40–80 QBs, each once', () => {
    expect(data.bigArm.length).toBeGreaterThanOrEqual(40);
    expect(data.bigArm.length).toBeLessThanOrEqual(80);
    expect(new Set(data.bigArm.map((r) => r.name)).size).toBe(data.bigArm.length);
  });

  it('every record points at legacy QB entries of that player', () => {
    for (const r of data.bigArm) {
      expect(r.entryIds.length, r.name).toBeGreaterThan(0);
      for (const id of r.entryIds) {
        expect(isQb(id), `${r.name} ${id}`).toBe(true);
        expect(byId.get(id)?.n).toBe(r.name);
      }
    }
  });

  it('every record has a grade, evidence, a basis, ≥ 1 verified source and conf estimated', () => {
    for (const r of data.bigArm) {
      expect(['cannon', 'strong', 'average', 'weak'], r.name).toContain(r.grade);
      expect(['pro', 'pre-pro', 'comparison'], r.name).toContain(r.evidence);
      expect(r.basis.length, r.name).toBeGreaterThan(10);
      expect(r.sources.length, r.name).toBeGreaterThanOrEqual(1);
      for (const s of r.sources) {
        expect(s.title.length, r.name).toBeGreaterThan(0);
        expect(s.url, r.name).toMatch(/^https:\/\//);
        expect(s.note.split(/\s+/).length, r.name).toBeLessThanOrEqual(20);
        expect(s.quoteVerified, `${r.name}: ${s.note}`).toBe(true);
        expect(['wikipedia', 'wikipedia-ref', 'pfhof']).toContain(s.kind);
      }
      expect(r.src).toBe('estimate:knowledge+cited');
      expect(r.conf).toBe('estimated');
    }
  });

  it('covers the pre-2006 anchors that have a citable description', () => {
    const names = new Set(data.bigArm.map((r) => r.name));
    for (const n of ['Dan Marino', 'Brett Favre', 'John Elway', 'Terry Bradshaw', 'Daryle Lamonica', 'Jim Kelly', 'Warren Moon', 'Dan Fouts', 'Troy Aikman', 'Kerry Collins']) {
      expect(names.has(n), n).toBe(true);
    }
    const grade = (n: string): string | undefined => data.bigArm.find((r) => r.name === n)?.grade;
    expect(grade('Dan Marino')).toBe('cannon');
    expect(grade('Terry Bradshaw')).toBe('cannon');
    expect(grade('Chad Pennington')).toBe('weak');
  });
});
