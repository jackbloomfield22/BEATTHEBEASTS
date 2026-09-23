// nflverse augmentation layer (data/augment/*.json, built by tools/augment/build.ts).
// Runs offline against the committed JSON only; never downloads anything.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFENSE, OL_UNITS, PLAYERS } from '@data/legacy';

const dir = fileURLToPath(new URL('../data/augment/', import.meta.url));
const load = <T>(file: string): T => JSON.parse(readFileSync(dir + file, 'utf8')) as T;

type Conf = 'verified' | 'reference' | 'estimated';
interface Sourced {
  src: string;
  conf: Conf;
}
interface PersonRec {
  personId: string;
  gsisId?: string;
  pfrId?: string;
  method: 'name+team+season' | 'alias' | 'name-only' | 'unmatched';
  conf: Conf;
  nvName?: string;
  flags?: string[];
}
interface EntryRec {
  personId: string;
  seasons?: Sourced & { list: number[]; games?: Record<string, number> };
  physical?: Sourced & { heightIn?: number; weightLb?: number; birthDate?: string };
  combine?: Sourced & { year: number; forty?: number };
  stats?: Sourced & {
    seasons: number[];
    complete: boolean;
    games: number;
    targets?: number;
    targetsSeasons?: number[];
    targetedReceptions?: number;
    receptions?: number;
    [k: string]: unknown;
  };
}
interface OlUnitRec extends Sourced {
  team: string;
  decade: string;
  linemen: { personId: string; name: string; count: number; seasons: number[]; inKeyList: number[] | false }[];
}
interface Suggestion {
  id: string;
  field: string;
  old: unknown;
  new: unknown;
  reason: string;
  source: string;
  conf: Conf;
  kind: string;
}

const people = load<{ entries: Record<string, PersonRec> }>('people.json').entries;
const entries = load<{ entries: Record<string, EntryRec> }>('nflverse_entries.json').entries;
const ol = load<{ units: Record<string, OlUnitRec> }>('ol_rosters.json').units;
const eras = load<{ _meta: { missingInSource: Record<string, number[]> }; seasons: Record<string, Sourced & Record<string, number | string | undefined>> }>('era_baselines_1999plus.json');
const suggestions = load<{ corrections: Suggestion[] }>('suggested_corrections.json').corrections;
const sources = load<{ files: { file: string; url: string; bytes: number; sha256: string; fetched: string }[] }>('sources.json').files;

const CONFS = ['verified', 'reference', 'estimated'];
const expectSourced = (x: Sourced | undefined, where: string) => {
  expect(x, where).toBeDefined();
  expect(x!.src, where).toMatch(/^nflverse:/);
  expect(CONFS, where).toContain(x!.conf);
};

describe('augment: schema and provenance', () => {
  it('covers every legacy entry and every OL key-list name', () => {
    for (const e of [...PLAYERS, ...DEFENSE]) {
      expect(people[e.id], e.id).toBeDefined();
      expect(entries[e.id], e.id).toBeDefined();
    }
    const keyNames = OL_UNITS.reduce((n, u) => n + u.key.split(' · ').length, 0);
    expect(Object.keys(people).filter((k) => k.startsWith('ol-key:')).length).toBe(keyNames);
    for (const u of OL_UNITS) expect(ol[u.id], u.id).toBeDefined();
  });

  it('every person record has a method, conf and a well-formed id', () => {
    for (const [id, p] of Object.entries(people)) {
      expect(['name+team+season', 'alias', 'name-only', 'unmatched'], id).toContain(p.method);
      expect(CONFS, id).toContain(p.conf);
      if (p.method === 'unmatched') expect(p.personId, id).toMatch(/^unmatched:/);
      else expect(p.personId, id).toMatch(/^(00-\d{7}|[A-Za-z.'-]+\d\d|[A-Z]{3}\d{6}|nv:.+)$/);
      if (p.gsisId) expect(p.personId === p.gsisId || !/^00-/.test(p.gsisId), id).toBe(true);
    }
  });

  it('every augmented group carries src and conf', () => {
    for (const [id, e] of Object.entries(entries)) {
      if (e.seasons) expectSourced(e.seasons, `${id}.seasons`);
      if (e.physical) expectSourced(e.physical, `${id}.physical`);
      if (e.combine) expectSourced(e.combine, `${id}.combine`);
      if (e.stats) expectSourced(e.stats, `${id}.stats`);
    }
    for (const [id, u] of Object.entries(ol)) expectSourced(u, id);
    for (const [y, s] of Object.entries(eras.seasons)) expectSourced(s, y);
  });

  it('suggested corrections have the corrections-layer shape', () => {
    for (const s of suggestions) {
      expect(s.id).toBeTypeOf('string');
      expect(s.field).toBeTypeOf('string');
      expect(s.reason.length).toBeGreaterThan(10);
      expect(s.source).toMatch(/^nflverse:/);
      expect('old' in s && 'new' in s).toBe(true);
    }
  });

  it('records a manifest with hashes for every source file', () => {
    expect(sources.length).toBeGreaterThanOrEqual(90);
    for (const f of sources) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.url).toMatch(/^https:\/\/github\.com\/nflverse\/nflverse-data\/releases\/download\//);
      expect(f.bytes).toBeGreaterThan(0);
    }
  });

  it('seasons stay inside the stint decade', () => {
    for (const e of [...PLAYERS, ...DEFENSE]) {
      const from = Number(e.d.slice(0, 4));
      for (const y of entries[e.id]!.seasons?.list ?? []) {
        expect(y, e.id).toBeGreaterThanOrEqual(from);
        expect(y, e.id).toBeLessThanOrEqual(from + 9);
      }
    }
  });
});

describe('augment: known facts', () => {
  it('Jerry Rice, SF 1980s', () => {
    const e = entries['players:jerry-rice:SF:1980s']!;
    expect(e.seasons!.list).toEqual([1985, 1986, 1987, 1988, 1989]);
    expect(e.physical!.heightIn).toBe(74);
    expect(e.physical!.weightLb).toBeGreaterThanOrEqual(195);
    expect(e.physical!.weightLb).toBeLessThanOrEqual(205);
    expect(e.physical!.birthDate).toBe('1962-10-13');
  });

  it('Joe Montana, SF 1980s (the 1979 roster season belongs to the 1970s)', () => {
    expect(entries['players:joe-montana:SF:1980s']!.seasons!.list).toEqual([1980, 1981, 1982, 1983, 1984, 1985, 1986, 1987, 1988, 1989]);
  });

  it('Barry Sanders, DET 1990s', () => {
    expect(entries['players:barry-sanders:DET:1990s']!.seasons!.list).toEqual([1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998]);
  });

  it('Deacon Jones, LAR 1960s', () => {
    const list = entries['defense:deacon-jones:LAR:1960s']!.seasons!.list;
    expect(list.length).toBeGreaterThanOrEqual(8);
    for (const y of list) expect(y >= 1961 && y <= 1969).toBe(true);
  });

  it('the Mike Williams entries are several different people', () => {
    const ids = PLAYERS.filter((p) => p.n === 'Mike Williams').map((p) => people[p.id]!.personId);
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBeGreaterThanOrEqual(3);
    // TB 2010s (drafted 2010), LAC 2010s/2020s (drafted 2017) and DET 2000s (2005 draft) are three people.
    const pid = (id: string) => people[id]!.personId;
    expect(pid('players:mike-williams:TB:2010s')).not.toBe(pid('players:mike-williams:LAC:2010s'));
    expect(pid('players:mike-williams:DET:2000s')).not.toBe(pid('players:mike-williams:TB:2010s'));
    expect(pid('players:mike-williams:LAC:2010s')).toBe(pid('players:mike-williams:LAC:2020s'));
    expect(pid('players:mike-williams:LAC:2020s')).toBe(pid('players:mike-williams:NYJ:2020s'));
  });

  it('homonyms at different positions resolve to different people', () => {
    const pid = (id: string) => people[id]!.personId;
    expect(pid('players:alex-smith:SF:2000s')).toBe(pid('players:alex-smith:KC:2010s'));
    expect(pid('players:alex-smith:TB:2000s')).not.toBe(pid('players:alex-smith:SF:2000s'));
    expect(pid('players:josh-allen:BUF:2020s')).not.toBe(pid('defense:josh-allen:JAX:2020s'));
    expect(pid('players:roy-williams:DET:2000s')).not.toBe(pid('defense:roy-williams:DAL:2000s'));
  });

  it('the same person across stints shares one id (Tom Brady NE 2000s and 2010s)', () => {
    const a = people['players:tom-brady:NE:2000s']!;
    const b = people['players:tom-brady:NE:2010s']!;
    expect(a.personId).toBe(b.personId);
    expect(a.method).toBe('name+team+season');
  });

  it('mid-season trades split by team (Randy Moss 2010: MIN, NE, TEN)', () => {
    const g = (id: string) => entries[id]!.seasons!.games?.['2010'];
    expect(g('players:randy-moss:TEN:2010s')).toBe(5);
    expect(g('players:randy-moss:NE:2000s')).toBeUndefined();
  });

  it('the OL key-list alias pair resolves to one person', () => {
    const chi = OL_UNITS.find((u) => u.t === 'CHI' && u.d === '1980s')!;
    const names = chi.key.split(' · ');
    const a = names.indexOf('Jimbo Covert');
    const b = names.indexOf('Jim Covert');
    expect(people[`ol-key:${chi.id}:${a}`]!.personId).toBe(people[`ol-key:${chi.id}:${b}`]!.personId);
  });

  it('match rate for 2000s–2020s offensive entries is at least 95%', () => {
    const modern = PLAYERS.filter((p) => ['2000s', '2010s', '2020s'].includes(p.d));
    const ok = modern.filter((p) => ['name+team+season', 'alias'].includes(people[p.id]!.method));
    expect(ok.length / modern.length).toBeGreaterThanOrEqual(0.95);
  });

  it('OL rosters list key-list linemen first, with plausible bodies', () => {
    for (const u of Object.values(ol)) {
      expect(u.linemen.length).toBeGreaterThanOrEqual(5);
      let seenOther = false;
      for (const l of u.linemen) {
        if (l.inKeyList === false) seenOther = true;
        else expect(seenOther).toBe(false);
      }
    }
    const pit = ol['ol-units:pittsburgh-steelers:PIT:1970s']!;
    expect(pit.linemen.find((l) => l.name === 'Mike Webster')?.inKeyList).toEqual([0]);
  });
});

describe('augment: stats and baselines', () => {
  it('stints fully in 2000+ have stats; catch % uses target seasons only', () => {
    const chase = entries["players:ja-marr-chase:CIN:2020s"]!.stats!;
    expect(chase.complete).toBe(true);
    expect(chase.targetsSeasons).toEqual(chase.seasons);
    const pct = (100 * chase.targetedReceptions!) / chase.targets!;
    expect(pct).toBeGreaterThan(55);
    expect(pct).toBeLessThan(80);
    // Targets are missing in the source for 2003–2008.
    const fitz = entries['players:larry-fitzgerald:ARI:2000s']!.stats!;
    for (const y of fitz.targetsSeasons ?? []) expect(y < 2003 || y > 2008).toBe(true);
  });

  it('league catch rate and yards per target are sane wherever targets exist', () => {
    const missing = eras._meta.missingInSource.targets ?? [];
    expect(missing).toEqual([2003, 2004, 2005, 2006, 2007, 2008]);
    for (const [y, s] of Object.entries(eras.seasons)) {
      if (missing.includes(Number(y))) {
        expect(s.catchRate, y).toBeUndefined();
        expect(s.yardsPerTarget, y).toBeUndefined();
        continue;
      }
      expect(s.catchRate, y).toBeGreaterThanOrEqual(50);
      expect(s.catchRate, y).toBeLessThanOrEqual(75);
      expect(s.yardsPerTarget, y).toBeGreaterThanOrEqual(5);
      expect(s.yardsPerTarget, y).toBeLessThanOrEqual(9.5);
    }
  });

  it('league baselines are in plausible ranges for every season 1999–2025', () => {
    const years = Object.keys(eras.seasons).map(Number);
    expect(years[0]).toBe(1999);
    expect(years[years.length - 1]).toBeGreaterThanOrEqual(2024);
    for (const [y, s] of Object.entries(eras.seasons)) {
      const n = (k: string) => s[k] as number;
      expect(n('teams'), y).toBeGreaterThanOrEqual(31);
      expect(n('cmpPct'), y).toBeGreaterThan(55);
      expect(n('cmpPct'), y).toBeLessThan(70);
      expect(n('passerRating'), y).toBeGreaterThan(75);
      expect(n('passerRating'), y).toBeLessThan(95);
      expect(n('ypa'), y).toBeGreaterThan(6.3);
      expect(n('ypa'), y).toBeLessThan(7.6);
      expect(n('ypc'), y).toBeGreaterThan(3.7);
      expect(n('ypc'), y).toBeLessThan(4.7);
      expect(n('sackPct'), y).toBeGreaterThan(5);
      expect(n('sackPct'), y).toBeLessThan(8.5);
      expect(n('pointsPerTeamGame'), y).toBeGreaterThan(19);
      expect(n('pointsPerTeamGame'), y).toBeLessThan(25);
    }
  });
});

describe('augment: suggested corrections', () => {
  it('fixes the seven 2020s WR catch % values that hold a count', () => {
    const cc = suggestions.filter((s) => s.kind === 'catch-pct-count');
    expect(cc.map((s) => s.id).sort()).toEqual([
      'players:amon-ra-st-brown:DET:2020s',
      'players:chris-olave:NO:2020s',
      'players:george-pickens:DAL:2020s',
      'players:ja-marr-chase:CIN:2020s',
      'players:jaxon-smith-njigba:SEA:2020s',
      'players:puka-nacua:LAR:2020s',
      'players:zay-flowers:BAL:2020s',
    ]);
    for (const s of cc) {
      const p = PLAYERS.find((x) => x.id === s.id)!;
      expect(s.field).toBe('s.c');
      expect(s.old).toBe(p.s.c);
      expect(s.new as number).toBeGreaterThanOrEqual(55);
      expect(s.new as number).toBeLessThanOrEqual(80);
    }
  });

  it('flags stints that never happened, and old values match legacy', () => {
    const byId = new Map(suggestions.map((s) => [`${s.id}|${s.field}`, s]));
    expect(byId.get('players:randy-moss:TEN:2000s|exclude')).toBeDefined();
    expect(byId.get('players:randy-moss:TEN:2010s|exclude')).toBeUndefined();
    expect(byId.get('defense:mike-haynes:LAR:1980s|t')?.new).toBe('LV');
    for (const s of suggestions) {
      if (s.field === 's.c' || s.field === 's.y') {
        const p = PLAYERS.find((x) => x.id === s.id)!;
        expect(s.old, s.id).toBe(s.field === 's.c' ? p.s.c : p.s.y);
      }
    }
  });
});
