// Added stints (user-approved, PR #3 round 2): stints the legacy data never
// had, kept in data/augment/added_stints.json (built and source-checked by
// tools/augment/added-stints.ts). Legacy data stays byte-identical (CLAUDE.md
// rule 1); this layer validates each record and turns it into the same shapes
// the rating inputs read. A record that fails validation refuses the load.

import type { Decade, Defender } from '@data/legacy/types';

export interface AddedStintRecord {
  id: string;
  personOf: string;
  impFrom: string;
  entry: { n: string; p: Defender['p']; t: string; d: Decade };
  seasons: number[];
  bySeason: Record<string, { games: number; sk?: number; int?: number; fr?: number; td?: number }>;
  totals: { games: number; sk: number; int: number; fr: number; td: number };
  source: { title: string; url: string; permalink: string; retrieved: string };
  conf: 'verified' | 'reference' | 'estimated';
  why: string;
}

export interface AddedStintsFile {
  stints: AddedStintRecord[];
}

const DECADE_START: Record<Decade, number> = { '1960s': 1960, '1970s': 1970, '1980s': 1980, '1990s': 1990, '2000s': 2000, '2010s': 2010, '2020s': 2020 };

/**
 * Validate the file against the legacy defenders and build the new entries.
 * Only defensive stints are supported (the one kind the rule has needed).
 */
export function applyAddedStints(file: AddedStintsFile, defense: readonly Defender[]): { entries: Defender[]; records: AddedStintRecord[] } {
  const byId = new Map(defense.map((d) => [d.id, d]));
  const entries: Defender[] = [];
  const seen = new Set<string>();
  for (const r of file.stints ?? []) {
    const fail = (m: string): never => {
      throw new Error(`added stint ${r.id}: ${m}`);
    };
    if (!r.id.startsWith('defense:')) fail('only defensive stints are supported');
    if (byId.has(r.id) || seen.has(r.id)) fail('id already exists');
    seen.add(r.id);
    const [, slug, team, decade] = r.id.split(':');
    if (team !== r.entry.t || decade !== r.entry.d) fail('id does not match team/decade');
    const person = byId.get(r.personOf) ?? fail(`personOf ${r.personOf} is not a legacy entry`);
    const impSrc = byId.get(r.impFrom) ?? fail(`impFrom ${r.impFrom} is not a legacy entry`);
    if (person.n !== r.entry.n || impSrc.n !== r.entry.n) fail('personOf/impFrom name differs');
    if (!person.id.startsWith(`defense:${slug}:`)) fail('personOf has a different slug');
    const d0 = DECADE_START[r.entry.d];
    if (!r.seasons.length || r.seasons.some((y) => y < d0 || y > d0 + 9)) fail('seasons outside the decade');
    const lines = r.seasons.map((y) => r.bySeason[String(y)] ?? fail(`no line for ${y}`));
    const sum = (f: 'games' | 'sk' | 'int' | 'fr' | 'td') => lines.reduce((a, l) => a + (l[f] ?? 0), 0);
    for (const f of ['games', 'sk', 'int', 'fr', 'td'] as const) if (Math.abs(sum(f) - r.totals[f]) > 1e-9) fail(`${f} total ${r.totals[f]} ≠ season lines ${sum(f)}`);
    if (!r.source?.url || !r.source.permalink || !r.conf) fail('missing source');
    entries.push({
      id: r.id,
      // Not in the legacy array: legacy code never sees this entry.
      legacyIndex: -1,
      n: r.entry.n,
      p: r.entry.p,
      t: r.entry.t,
      d: r.entry.d,
      // Honors come from the cited accolades (data/augment/accolades.json); ap/pb/dpoy here are unused.
      s: { sk: r.totals.sk, int: r.totals.int, fr: r.totals.fr, td: r.totals.td, ap: 0, pb: 0 },
      imp: impSrc.imp,
    });
  }
  return { entries, records: file.stints ?? [] };
}
