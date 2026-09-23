// Added stints (user-approved: PR #3 round 2 and M4.5): stints the legacy
// data never had, kept in data/augment/added_stints.json (built and
// source-checked by tools/augment/added-stints.ts). Legacy data stays
// byte-identical (CLAUDE.md rule 1); this layer validates each record and
// turns it into the same shapes the rating inputs read. A record that fails
// validation refuses the load.

import type { Decade, Defender, Player } from '@data/legacy/types';

/** First season with nflverse weekly stats (tools/augment/fetch-nflverse.ts FIRST_STATS_SEASON). */
export const FIRST_NFLVERSE_STATS_SEASON = 1999;

export interface AddedStintRecord {
  id: string;
  personOf: string;
  impFrom: string;
  impWhy?: string;
  entry: { n: string; p: Defender['p'] | Player['p']; t: string; d: Decade };
  seasons: number[];
  /** Cited season lines. Defense: games, sk, int, fr, td. Offense: games, rec, yds, td, rushYds, rushTd, fum. */
  bySeason: Record<string, Record<string, number>>;
  totals: Record<string, number>;
  /** 1999+ seasons: nflverse games per season and stats in the nflverse_entries.json shape (verified). */
  nflverse?: { games: Record<string, number>; stats: { seasons: number[]; complete: boolean; games: number; src: string; conf: 'verified' } & Record<string, unknown> };
  source: { title: string; url: string; permalink: string; retrieved: string };
  conf: 'verified' | 'reference' | 'estimated';
  checks?: string[];
  why: string;
}

export interface AddedStintsFile {
  stints: AddedStintRecord[];
}

const DECADE_START: Record<Decade, number> = { '1960s': 1960, '1970s': 1970, '1980s': 1980, '1990s': 1990, '2000s': 2000, '2010s': 2010, '2020s': 2020 };
const REQUIRED = { defense: ['games', 'sk', 'int', 'fr', 'td'], players: ['games', 'rec', 'yds', 'td', 'rushTd'] } as const;

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Validate the file against the legacy entries and build the new entries:
 * defensive records become Defender entries, offensive (`players:`) records
 * Player entries.
 */
export function applyAddedStints(
  file: AddedStintsFile,
  defense: readonly Defender[],
  players: readonly Player[] = [],
): { entries: Defender[]; offense: Player[]; records: AddedStintRecord[] } {
  const byId = new Map<string, Defender | Player>([...defense, ...players].map((d) => [d.id, d]));
  const entries: Defender[] = [];
  const offense: Player[] = [];
  const seen = new Set<string>();
  for (const r of file.stints ?? []) {
    const fail = (m: string): never => {
      throw new Error(`added stint ${r.id}: ${m}`);
    };
    const [kind, slug, team, decade] = r.id.split(':');
    if (kind !== 'defense' && kind !== 'players') fail('only defense: and players: stints are supported');
    if (byId.has(r.id) || seen.has(r.id)) fail('id already exists');
    seen.add(r.id);
    if (team !== r.entry.t || decade !== r.entry.d) fail('id does not match team/decade');
    const person = byId.get(r.personOf) ?? fail(`personOf ${r.personOf} is not a legacy entry`);
    const impSrc = byId.get(r.impFrom) ?? fail(`impFrom ${r.impFrom} is not a legacy entry`);
    if (person.n !== r.entry.n || impSrc.n !== r.entry.n) fail('personOf/impFrom name differs');
    if (!person.id.startsWith(`${kind}:${slug}:`) || !impSrc.id.startsWith(`${kind}:${slug}:`)) fail('personOf/impFrom has a different slug or kind');
    const d0 = DECADE_START[r.entry.d];
    if (!r.seasons.length || r.seasons.some((y) => y < d0 || y > d0 + 9)) fail('seasons outside the decade');
    const lines = r.seasons.map((y) => r.bySeason[String(y)] ?? fail(`no line for ${y}`));
    for (const f of REQUIRED[kind as keyof typeof REQUIRED]) if (typeof r.totals[f] !== 'number') fail(`no ${f} total`);
    for (const [f, t] of Object.entries(r.totals)) {
      const s = lines.reduce((a, l) => a + (l[f] ?? 0), 0);
      if (Math.abs(s - t) > 1e-9) fail(`${f} total ${t} ≠ season lines ${s}`);
    }
    if (!r.source?.url || !r.source.permalink || !r.conf) fail('missing source');
    // 1999+ seasons are read from nflverse (verified), like every legacy stint.
    const post = r.seasons.filter((y) => y >= FIRST_NFLVERSE_STATS_SEASON);
    if (post.length) {
      const nv = r.nflverse ?? fail('1999+ seasons without nflverse stats');
      if (!nv.stats?.src || nv.stats.conf !== 'verified') fail('nflverse stats without source');
      if (JSON.stringify(nv.stats.seasons) !== JSON.stringify(post) || post.some((y) => typeof nv.games[String(y)] !== 'number')) fail('nflverse seasons differ from the 1999+ seasons');
      if (nv.stats.complete !== r.seasons.every((y) => y >= FIRST_NFLVERSE_STATS_SEASON)) fail('nflverse complete flag is wrong');
    } else if (r.nflverse) fail('nflverse stats on a pre-1999 stint');
    const t = r.totals;
    if (kind === 'defense') {
      entries.push({
        id: r.id,
        // Not in the legacy array: legacy code never sees this entry.
        legacyIndex: -1,
        n: r.entry.n,
        p: r.entry.p as Defender['p'],
        t: r.entry.t,
        d: r.entry.d,
        // Honors come from the cited accolades (data/augment/accolades.json); ap/pb/dpoy here are unused.
        s: { sk: t.sk, int: t.int!, fr: t.fr!, td: t.td, ap: 0, pb: 0 },
        imp: impSrc.imp,
      });
    } else {
      if (!('ea' in impSrc)) fail('impFrom is not an offensive entry');
      const g = Math.max(1, t.games!);
      // Legacy-shaped per-game line (what the legacy sim's rateOffense reads, and
      // the adapter fit's target): WR y rec yds/g, t TD/g, c catch %, p yds/target.
      // Catch % and yards per target only where nflverse has targets.
      const st = r.nflverse?.stats as Record<string, number> | undefined;
      const tgt = st?.targets ?? 0;
      offense.push({
        id: r.id,
        legacyIndex: -1,
        n: r.entry.n,
        p: r.entry.p as Player['p'],
        t: r.entry.t,
        d: r.entry.d,
        s: { y: r1(t.yds! / g), t: r2((t.td! + t.rushTd!) / g), ...(tgt > 0 ? { c: r1((100 * st!.targetedReceptions!) / tgt), p: r1(st!.targetedReceivingYards! / tgt) } : {}) },
        imp: impSrc.imp,
        // Legacy's era-adjusted rating is never read by legacy code; carried from impFrom like imp.
        ea: (impSrc as Player).ea,
      });
    }
  }
  return { entries, offense, records: file.stints ?? [] };
}
