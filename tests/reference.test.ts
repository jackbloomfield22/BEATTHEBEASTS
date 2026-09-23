// Offline checks on the reference/estimated augmentation layer (data/augment/),
// built by tools/reference/*.py. Reads only committed JSON; no network.
//
// Pins the provenance contract (every value has src + conf; reference values
// carry url + retrieved), a few well-known facts as parser canaries, and the
// internal consistency of the pre-1999 era baselines.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = <T>(rel: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../data/augment/${rel}`, import.meta.url)), 'utf8')) as T;

type Conf = 'reference' | 'estimated' | 'missing';

interface Person {
  name: string;
  entries: string[];
  src: string;
  conf: Conf;
  url?: string;
  retrieved?: string;
  note?: string;
  page?: string;
  proBowl: number[];
  allPro1: number[];
  allPro2: number[];
  mvp: number[];
  opoy: number[];
  dpoy: number[];
  [k: string]: unknown;
}

interface Accolades {
  _meta: { coverage: Record<string, Record<string, Record<string, number>>> };
  people: Record<string, Person>;
}

interface FieldConf {
  conf: Conf;
  src: string;
  note: string;
}

interface FortyRow {
  name: string;
  entries: string[];
  forty?: number;
  tenSplit?: number;
  vertical?: number;
  broad?: number;
  shuttle?: number;
  cone?: number;
  bench?: number;
  fieldConf?: Record<string, FieldConf>;
  src: string;
  conf: Conf;
  note: string;
  url?: string;
  retrieved?: string;
}

interface Physical {
  people: Record<string, FortyRow>;
}

interface Season {
  season: number;
  src: string;
  conf: Conf;
  note: string;
  gamesPerTeam: number;
  compPct: number;
  ypa: number;
  tdPct: number;
  intPct: number;
  sackPct: number;
  passerRating: number;
  ypc: number;
  pointsPerTeamGame: number;
  passAttPerTeamGame: number;
  passCmpPerTeamGame: number;
  passYdsPerTeamGame: number;
  passTdPerTeamGame: number;
  intPerTeamGame: number;
  sacksPerTeamGame: number;
  rushAttPerTeamGame: number;
  rushYdsPerTeamGame: number;
  rushTdPerTeamGame: number;
  yardsPerReception: number;
  afl?: Season;
  combined?: Season;
}

interface Baselines {
  seasons: Record<string, Season>;
}

const acc = read<Accolades>('accolades.json');
const phys = read<Physical>('estimated_physical.json');
const base = read<Baselines>('era_baselines_pre1999.json');

const people = Object.values(acc.people);
const byName = (name: string, entryPart?: string): Person => {
  const hits = people.filter((p) => p.name === name && (!entryPart || p.entries.some((e) => e.includes(entryPart))));
  expect(hits, `${name} ${entryPart ?? ''}`).toHaveLength(1);
  return hits[0]!;
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

describe('accolades.json provenance', () => {
  it('has a src and conf on every person, and url + retrieved on every reference', () => {
    expect(people.length).toBeGreaterThan(1000);
    for (const p of people) {
      expect(typeof p.src, p.name).toBe('string');
      expect(['reference', 'estimated', 'missing'], p.name).toContain(p.conf);
      if (p.conf === 'reference') {
        expect(p.src.startsWith('wikipedia:'), p.name).toBe(true);
        expect(p.url, p.name).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
        expect(p.retrieved, p.name).toMatch(ISO);
      } else {
        expect(p.note, `${p.name} needs a note`).toBeTruthy();
      }
      expect(p.entries.length, p.name).toBeGreaterThan(0);
    }
  });

  it('keys people as name|group|firstDecade and never assigns an entry to two people', () => {
    const seen = new Map<string, string>();
    for (const [key, p] of Object.entries(acc.people)) {
      expect(key).toMatch(/^[^|]+\|(QB|RB|WR|TE|OL|DL|LB|DB)\|(19|20)\d0s(#\d+)?$/);
      for (const e of p.entries) {
        expect(seen.get(e), `${e} in ${key} and ${seen.get(e)}`).toBeUndefined();
        seen.set(e, key);
      }
    }
  });

  it('stores honors as sorted, unique, plausible seasons', () => {
    for (const p of people) {
      for (const f of ['proBowl', 'allPro1', 'allPro2', 'mvp', 'opoy', 'dpoy'] as const) {
        const v = p[f];
        expect(Array.isArray(v), `${p.name}.${f}`).toBe(true);
        expect([...new Set(v)].sort((a, b) => a - b), `${p.name}.${f}`).toEqual(v);
        for (const y of v) expect(y >= 1950 && y <= 2026, `${p.name}.${f} ${y}`).toBe(true);
      }
    }
  });

  it('covers at least 90% of the imp >= 85 entries with reference data', () => {
    const all = acc._meta.coverage.entries_imp85!.ALL!;
    const total = Object.values(all).reduce((a, b) => a + b, 0);
    expect((all.reference ?? 0) / total).toBeGreaterThanOrEqual(0.9);
  });
});

describe('accolades.json spot facts', () => {
  it('Jerry Rice: 13 Pro Bowls, 10 first-team All-Pros', () => {
    const rice = byName('Jerry Rice');
    expect(rice.conf).toBe('reference');
    expect(rice.proBowl).toHaveLength(13);
    expect(rice.allPro1).toHaveLength(10);
    expect(rice.entries).toContain('players:jerry-rice:SF:1980s');
  });

  it('Lawrence Taylor: 1986 MVP', () => {
    expect(byName('Lawrence Taylor').mvp).toContain(1986);
  });

  it('Reggie White: DPOY 1987 and 1998', () => {
    const rw = byName('Reggie White');
    expect(rw.dpoy).toEqual(expect.arrayContaining([1987, 1998]));
    expect(rw.entries).toEqual(expect.arrayContaining(['defense:reggie-white:PHI:1980s', 'defense:reggie-white:GB:1990s']));
  });

  it('Deion Sanders: DPOY 1994', () => {
    expect(byName('Deion Sanders').dpoy).toEqual([1994]);
  });

  it('splits homonyms by team and era', () => {
    const lac = byName('Mike Williams', 'players:mike-williams:LAC:2010s');
    const det = byName('Mike Williams', 'players:mike-williams:DET:2000s');
    expect(lac.page).not.toBe(det.page);
    const qb = byName('Alex Smith', 'players:alex-smith:KC:2010s');
    const te = byName('Alex Smith', 'players:alex-smith:TB:2000s');
    expect(qb.page).not.toBe(te.page);
  });

  it('never counts conference or rookie awards as NFL awards', () => {
    // Alex Smith (QB) was the 2004 Mountain West Offensive Player of the Year in college.
    expect(byName('Alex Smith', 'players:alex-smith:KC:2010s').opoy).toEqual([]);
    for (const p of people) for (const y of p.dpoy) expect(y, `${p.name} dpoy`).toBeGreaterThanOrEqual(1966);
  });
});

describe('estimated_physical.json', () => {
  const rows = Object.values(phys.people);

  it('has src, conf and a note on every row, sources on references, plausible values', () => {
    expect(rows.length).toBeGreaterThan(50);
    const ranges = {
      forty: [4.1, 5.9], tenSplit: [1.3, 2.0], vertical: [15, 48], broad: [70, 150], shuttle: [3.7, 5.5], cone: [6.2, 9.0], bench: [0, 50],
    } as const;
    for (const r of rows) {
      expect(['reference', 'estimated'], r.name).toContain(r.conf);
      expect(r.src, r.name).toBeTruthy();
      expect(r.note, r.name).toBeTruthy();
      expect(r.entries.length, r.name).toBeGreaterThan(0);
      let fields = 0;
      for (const [f, [lo, hi]] of Object.entries(ranges)) {
        const v = r[f as keyof typeof ranges];
        if (v === undefined) continue;
        fields++;
        expect(v >= lo && v <= hi, `${r.name} ${f} ${v}`).toBe(true);
      }
      expect(fields, r.name).toBeGreaterThan(0);
      if (r.conf === 'reference') {
        expect(r.url, r.name).toMatch(/^https:\/\//);
        expect(r.retrieved, r.name).toMatch(ISO);
      } else {
        // only the 40 is ever estimated
        expect(Object.keys(r).filter((k) => k in ranges && k !== 'forty'), r.name).toEqual([]);
      }
      for (const [f, fc] of Object.entries(r.fieldConf ?? {})) {
        expect(f, r.name).toBe('forty');
        expect(fc.conf, r.name).toBe('estimated');
        expect(fc.note, r.name).toBeTruthy();
      }
    }
  });

  it('includes the brief anchors with speed bands', () => {
    const names = new Set(rows.map((r) => r.name));
    for (const n of ['Bo Jackson', 'Deion Sanders', 'Randy Moss', 'Tyreek Hill', 'Michael Vick', 'Lamar Jackson', 'Barry Sanders', 'Jerry Rice', 'Eric Dickerson']) {
      expect(names.has(n), n).toBe(true);
    }
    const t = (n: string) => rows.find((r) => r.name === n)!.forty!;
    expect(t('Jerry Rice')).toBeGreaterThan(t('Randy Moss'));
    expect(t('Deion Sanders')).toBeLessThan(4.35);
  });
});

describe('era_baselines_pre1999.json', () => {
  const rating = (s: Pick<Season, 'compPct' | 'ypa' | 'tdPct' | 'intPct'>): number => {
    const c = (v: number) => Math.max(0, Math.min(2.375, v));
    return ((c((s.compPct - 30) * 0.05) + c((s.ypa - 3) * 0.25) + c(s.tdPct * 0.2) + c(2.375 - s.intPct * 0.25)) / 6) * 100;
  };

  it('has every season 1960-1998 with src and conf', () => {
    for (let y = 1960; y <= 1998; y++) {
      const s = base.seasons[String(y)];
      expect(s, String(y)).toBeDefined();
      expect(s!.season).toBe(y);
      expect(s!.src).toBeTruthy();
      expect(s!.conf).toBe('estimated');
      expect(s!.note).toBeTruthy();
    }
    expect(base.seasons['1999']).toBeUndefined();
  });

  it('keeps passer rating consistent with its components within 0.5', () => {
    for (const s of Object.values(base.seasons)) {
      for (const b of [s, s.afl, s.combined]) {
        if (!b) continue;
        expect(Math.abs(rating(b) - b.passerRating), `${s.season}`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('keeps per-team-game volumes consistent with the rates', () => {
    for (const s of Object.values(base.seasons)) {
      expect(Math.abs(s.passAttPerTeamGame * s.ypa - s.passYdsPerTeamGame)).toBeLessThan(1);
      expect(Math.abs((100 * s.passCmpPerTeamGame) / s.passAttPerTeamGame - s.compPct)).toBeLessThan(0.1);
      expect(Math.abs(s.rushAttPerTeamGame * s.ypc - s.rushYdsPerTeamGame)).toBeLessThan(1);
      expect(Math.abs(s.passYdsPerTeamGame / s.passCmpPerTeamGame - s.yardsPerReception)).toBeLessThan(0.05);
      const sackPct = (100 * s.sacksPerTeamGame) / (s.sacksPerTeamGame + s.passAttPerTeamGame);
      expect(Math.abs(sackPct - s.sackPct)).toBeLessThan(0.1);
    }
  });

  it('has the right schedule lengths', () => {
    const g = (y: number) => base.seasons[String(y)]!.gamesPerTeam;
    expect(g(1960)).toBe(12);
    expect(g(1970)).toBe(14);
    expect(g(1977)).toBe(14);
    expect(g(1978)).toBe(16);
    expect(g(1982)).toBe(9);
    expect(g(1987)).toBe(15);
    expect(g(1998)).toBe(16);
  });

  it('shows the dead-ball low in 1977 and the 1978-79 passing jump', () => {
    const r = (y: number) => base.seasons[String(y)]!.passerRating;
    for (let y = 1970; y <= 1998; y++) if (y !== 1977) expect(r(1977)).toBeLessThan(r(y));
    expect(r(1979)).toBeGreaterThan(r(1977) + 5);
  });
});
