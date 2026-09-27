// Stint completeness audit (M6.6, PLAYTEST-1 decision 6) → a marked section
// of docs/m66/DATA_AUDIT.md. Reads only; it never adds a stint (additions go
// through tools/augment/added-stints.ts, each with its source).
//
//   node --experimental-strip-types tools/augment/stint-audit.ts
//
// A stint is one person on one franchise in one decade. The audit takes every
// person who already has a rated stint (legacy, or added), walks the nflverse
// rosters (1960–2025) and weekly stats (1999–2025) for every franchise and
// decade he played in, and lists the franchise-decades that have no stint of
// his while he did something notable there:
//   - a cited honor in one of those seasons (first- or second-team All-Pro,
//     Pro Bowl; data/augment/accolades.json), any era; or
//   - 1999+ production over the marks below (nflverse, verified).
// Before 1999 nflverse has rosters but no stats, so older gaps are found by
// honors only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFdIndex, stintSeasons } from './build.ts';
import { FIRST_STATS_SEASON, LAST_SEASON, ROOT } from './fetch-nflverse.ts';
import { addLine, emptyLine, loadAll, type StatLine } from './load.ts';
import { writeMarkedSection } from './report-sections.ts';

const REPORT = join(ROOT, 'docs', 'm66', 'DATA_AUDIT.md');
const TOOL = 'tools/augment/stint-audit.ts';

/**
 * Production marks (ours, for the audit only; no rating reads them). A season
 * mark is the conventional "big season" line (1,000 rushing or receiving
 * yards, 4,000 passing yards, double-digit sacks, 6+ interceptions: roughly a
 * top-15 season at the position in the 2000s–2020s); a stint mark is about
 * two good seasons' worth, so a short stint of a very good player shows up
 * as well as one great season.
 */
const MARKS = {
  QB: { season: { passing_yards: 4000 }, stint: { passing_yards: 7000 } },
  RB: { season: { rushing_yards: 1000 }, stint: { rushing_yards: 2000 } },
  WR: { season: { receiving_yards: 1000 }, stint: { receiving_yards: 2000 } },
  // A 1,000-yard season is rarer for a tight end; 800 is the TE equivalent (about the 10th-best TE season in a typical 2010s year).
  TE: { season: { receiving_yards: 800 }, stint: { receiving_yards: 1600 } },
  DE: { season: { def_sacks: 10 }, stint: { def_sacks: 20 } },
  DT: { season: { def_sacks: 8 }, stint: { def_sacks: 16 } },
  LB: { season: { def_sacks: 10, def_interceptions: 5 }, stint: { def_sacks: 20, def_interceptions: 8 } },
  CB: { season: { def_interceptions: 6 }, stint: { def_interceptions: 10 } },
  S: { season: { def_interceptions: 6 }, stint: { def_interceptions: 10 } },
} as const satisfies Record<string, { season: Partial<Record<keyof StatLine, number>>; stint: Partial<Record<keyof StatLine, number>> }>;
type Pos = keyof typeof MARKS;

interface Accolade {
  name: string;
  entries?: string[];
  proBowl?: number[];
  allPro1?: number[];
  allPro2?: number[];
  allProUnspecified?: number[];
  aflAllStar?: number[];
  allAFL1?: number[];
  allAFL2?: number[];
}

interface Gap {
  name: string;
  pos: Pos;
  team: string;
  decade: string;
  seasons: number[];
  honors: string[];
  line: string;
  why: string[];
  rated: string[];
  score: number;
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1));
const span = (ys: readonly number[]) => (ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : `${ys[0]}`);

function main(): void {
  const people = (JSON.parse(readFileSync(join(ROOT, 'data', 'augment', 'people.json'), 'utf8')) as { entries: Record<string, { personId: string }> }).entries;
  const added = (JSON.parse(readFileSync(join(ROOT, 'data', 'augment', 'added_stints.json'), 'utf8')) as { stints: { id: string; personOf: string }[] }).stints;
  const corrections = (JSON.parse(readFileSync(join(ROOT, 'data', 'corrections.json'), 'utf8')) as { corrections: { id: string; op: string }[] }).corrections;
  const accolades = (JSON.parse(readFileSync(join(ROOT, 'data', 'augment', 'accolades.json'), 'utf8')) as { people: Record<string, Accolade> }).people;
  const excluded = new Set(corrections.filter((c) => c.op === 'exclude').map((c) => c.id));

  // Rated stints per person: legacy entries (minus exclusions) plus added ones.
  const stintIds = new Map<string, string[]>();
  const posOf = new Map<string, Pos>();
  const nameOf = new Map<string, string>();
  const note = (id: string, personId: string) => {
    const [kind, , team, decade] = id.split(':');
    if (kind !== 'players' && kind !== 'defense') return;
    (stintIds.get(personId) ?? stintIds.set(personId, []).get(personId)!).push(`${team}|${decade}`);
  };
  for (const [id, p] of Object.entries(people)) if (!excluded.has(id)) note(id, p.personId);
  for (const a of added) if (people[a.personOf]) note(a.id, people[a.personOf]!.personId);

  // Position and name per person: from the legacy entry itself.
  const legacyPos = new Map<string, string>();
  for (const file of ['players.ts', 'defense.ts']) {
    const text = readFileSync(join(ROOT, 'data', 'legacy', file), 'utf8');
    for (const m of text.matchAll(/id: "([^"]+)", legacyIndex: \d+, n: "([^"]+)", p: "([A-Z]+)"/g)) legacyPos.set(m[1]!, `${m[3]}|${m[2]}`);
  }
  for (const [id, p] of Object.entries(people)) {
    const lp = legacyPos.get(id);
    if (!lp || excluded.has(id)) continue;
    const [pos, name] = lp.split('|') as [Pos, string];
    if (!posOf.has(p.personId)) posOf.set(p.personId, pos);
    nameOf.set(p.personId, name);
  }
  // Honors by person (an accolade record lists the legacy entries it covers).
  const honorsOf = new Map<string, Accolade>();
  for (const r of Object.values(accolades)) {
    const pid = r?.entries?.map((e) => people[e]?.personId).find(Boolean);
    if (pid) honorsOf.set(pid, r);
  }

  console.log('loading nflverse cache (rosters, weekly stats)…');
  const data = loadAll();
  const fd = buildFdIndex(data);
  const gaps: Gap[] = [];
  for (const [key, byPerson] of fd) {
    const [team, decade] = key.split('|') as [string, string];
    for (const [pid, st] of byPerson) {
      const have = stintIds.get(pid);
      const pos = posOf.get(pid);
      if (!have || !pos || have.includes(key)) continue;
      const seasons = stintSeasons(st);
      if (!seasons.length) continue;
      const h = honorsOf.get(pid);
      const inStint = (l?: number[]) => (l ?? []).filter((y) => seasons.includes(y));
      const honors = [
        ...inStint(h?.allPro1).map((y) => `All-Pro ${y}`),
        ...inStint(h?.allPro2).map((y) => `2nd-team All-Pro ${y}`),
        ...inStint(h?.allAFL1).map((y) => `All-AFL ${y}`),
        ...inStint(h?.proBowl).map((y) => `Pro Bowl ${y}`),
        ...inStint(h?.aflAllStar).map((y) => `AFL All-Star ${y}`),
      ];
      const why: string[] = [];
      const total = emptyLine();
      for (const [y, l] of st.stats) if (y >= FIRST_STATS_SEASON) addLine(total, l);
      const marks = MARKS[pos];
      for (const [f, v] of Object.entries(marks.season) as [keyof StatLine, number][]) {
        const big = [...st.stats].filter(([, l]) => l[f] >= v).map(([y]) => y);
        if (big.length) why.push(`${f.replace(/_/g, ' ')} ≥ ${fmt(v)} in ${big.sort().join(', ')}`);
      }
      for (const [f, v] of Object.entries(marks.stint) as [keyof StatLine, number][]) if (total[f] >= v) why.push(`${fmt(total[f])} ${f.replace(/_/g, ' ')} in the stint`);
      if (honors.length) why.push('honors');
      if (!why.length) continue;
      const line =
        total.games === 0
          ? seasons[0]! < FIRST_STATS_SEASON
            ? 'no stats before 1999'
            : '–'
          : pos === 'QB'
            ? `${total.games} G, ${fmt(total.passing_yards)} pass yds, ${total.passing_tds} TD, ${total.interceptions} INT`
            : pos === 'RB'
              ? `${total.games} G, ${fmt(total.rushing_yards)} rush yds, ${total.rushing_tds} TD; ${total.receptions} rec, ${fmt(total.receiving_yards)} yds`
              : pos === 'WR' || pos === 'TE'
                ? `${total.games} G, ${total.receptions} rec, ${fmt(total.receiving_yards)} yds, ${total.receiving_tds} TD`
                : `${total.games} G, ${fmt(total.def_sacks)} sk, ${total.def_interceptions} INT`;
      const score = honors.filter((x) => x.startsWith('All-Pro')).length * 3 + honors.filter((x) => x.startsWith('2nd')).length * 1.5 + honors.filter((x) => x.startsWith('Pro Bowl')).length + why.filter((w) => w !== 'honors').length;
      gaps.push({ name: nameOf.get(pid) ?? st.person.id, pos, team, decade, seasons, honors, line, why, rated: have.map((k) => k.replace('|', ' ')), score });
    }
  }
  gaps.sort((a, b) => a.decade.localeCompare(b.decade) || b.score - a.score || a.name.localeCompare(b.name));

  const L: string[] = [];
  L.push(`## Completeness audit (generated by \`${TOOL}\`)`, '');
  L.push(
    `Every person with a rated stint, walked through the nflverse rosters (1960–${LAST_SEASON}) and weekly stats (${FIRST_STATS_SEASON}–${LAST_SEASON}): franchise-decades where he played, has no stint, and did something notable there. Notable = a cited honor in one of those seasons (All-Pro, second-team All-Pro, Pro Bowl; \`data/augment/accolades.json\`), or ${FIRST_STATS_SEASON}+ production over the audit marks (a 1,000-yard rushing or receiving season, 800 for a TE, 4,000 passing yards, 10 sacks (8 for a DT), 6 interceptions (5 for a LB), or about two such seasons over the stint; \`MARKS\` in the tool). Before ${FIRST_STATS_SEASON} only honors can flag a gap. A stint added in this milestone no longer appears here. People with no stint at all are out of scope (the added-stints path needs an existing stint of the same person for body, honors and \`imp\`).`,
    '',
  );
  const decades = [...new Set(gaps.map((g) => g.decade))];
  L.push(`**${gaps.length} gaps** (${decades.map((d) => `${d}: ${gaps.filter((g) => g.decade === d).length}`).join(', ')}).`, '');
  for (const d of decades) {
    L.push(`### ${d}`, '', '| Player | Pos | Team | Seasons | Line (nflverse, REG) | Honors in the stint | Flagged by | Rated stints |', '|---|---|---|---|---|---|---|---|');
    for (const g of gaps.filter((x) => x.decade === d)) L.push(`| ${g.name} | ${g.pos} | ${g.team} | ${span(g.seasons)} | ${g.line} | ${g.honors.join(', ') || '–'} | ${g.why.filter((w) => w !== 'honors').join('; ') || 'honors'} | ${g.rated.join(', ')} |`);
    L.push('');
  }
  writeMarkedSection(REPORT, TOOL, L);
  console.log(`${gaps.length} gaps → ${REPORT}`);
}

main();
