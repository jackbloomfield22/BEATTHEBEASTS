// League fumble rates per season → data/augment/league_fumbles.json, the era
// baseline for Ball Security (fumbles per touch), like every other rate stat.
//
//   node --experimental-strip-types tools/augment/fumbles.ts [--fetch]
//
//   --fetch   download the cited page if it is not cached yet
//             (tools/augment/cache/refs/). Without it the run is offline.
//
// Definition (the same as the cited source): running backs with at least 100
// touches (carries + receptions) in the season; the league rate is their total
// fumbles ÷ their total touches. Player Ball Security reads fumbles per touch
// the same way (inputs.ts: rushing + receiving fumbles ÷ carries + receptions).
//
//   1999–2025  nflverse weekly player stats (REG), position RB/FB, conf verified
//   1970–1998  Fantasy Index, "Fumbles have almost become a non-issue in the
//              NFL" (2020-06-23), table "FUMBLE RATES, LAST 50 YEARS" (RBs with
//              100+ touches, 1970–2019), parsed from the cached page and checked
//              row by row; conf reference. 1999–2019 of the same table are kept
//              as a cross-check against nflverse.
//   1960–1969  not covered by any source we hold: held at the mean of the
//              earliest three cited seasons (1970–72), conf estimated.
//
// A missing page, a changed definition sentence or a table that doesn't parse
// to 50 seasons refuses the build.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { num, readCsv } from './csv.ts';
import { CACHE_DIR, FIRST_STATS_SEASON, LAST_SEASON, ROOT } from './fetch-nflverse.ts';
import { writeMarkedSection } from './report-sections.ts';
import { normText, USER_AGENT } from './wiki.ts';

const OUT = join(ROOT, 'data', 'augment', 'league_fumbles.json');
const REPORT = join(ROOT, 'docs', 'AUGMENT_REPORT.md');
const TOOL = 'tools/augment/fumbles.ts';

export const FI_URL = 'https://fantasyindex.com/2020/06/23/factoid/running-back-fumbles';
const FI_TITLE = 'Fantasy Index: "Fumbles have almost become a non-issue in the NFL" (2020-06-23)';
const FI_FILE = join(CACHE_DIR, 'refs', 'fantasyindex-rb-fumbles-2020.html');
/** The source's own definition, quoted; the build refuses if the cached page no longer says it. */
const FI_DEFINITION = 'I looked at all running backs who had at least 100 touches in each of those seasons.';
/** Same threshold for the nflverse seasons, so both parts measure the same thing. */
const MIN_TOUCHES = 100;
/** Seasons the 1960s estimate is anchored on (the earliest the source covers). */
const ANCHOR_1960S = [1970, 1971, 1972];

interface SeasonRow {
  rate: number;
  touches: number;
  fumbles: number;
  src: string;
  conf: 'verified' | 'reference' | 'estimated';
}

function sourceTable(fetch: boolean): { rows: Map<number, { touches: number; fumbles: number; pct: number }>; retrieved: string } {
  if (!existsSync(FI_FILE)) {
    if (!fetch) throw new Error(`${FI_URL} is not cached (${FI_FILE}); rerun with --fetch`);
    mkdirSync(join(CACHE_DIR, 'refs'), { recursive: true });
    execFileSync('curl', ['-sSL', '--fail', '-A', USER_AGENT, '-o', FI_FILE, FI_URL]);
  }
  const html = readFileSync(FI_FILE, 'utf8');
  const text = normText(html.replace(/<[^>]*>/g, ' ').replace(/&#8217;|&rsquo;/g, "'"));
  if (!text.includes(normText(FI_DEFINITION))) throw new Error(`definition sentence not found in the cached ${FI_URL}`);
  if (!/FUMBLE RATES, LAST 50 YEARS/.test(html)) throw new Error('table "FUMBLE RATES, LAST 50 YEARS" not found');
  const rows = new Map<number, { touches: number; fumbles: number; pct: number }>();
  // Cells may carry inline markup (the 2019 row is bold): strip tags inside each row.
  const re = /^(\d{4})\|([\d,]+)\|(\d+)\|([.\d]+)%$/;
  const cells = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]!.replace(/<[^>]*>/g, '').trim()).join('|'));
  for (const row of cells) {
    const m = re.exec(row);
    if (!m) continue;
    const touches = Number(m[2]!.replace(/,/g, ''));
    const fumbles = Number(m[3]);
    const pct = Number(m[4]);
    // Each row must be self-consistent: the printed percent is fumbles ÷ touches.
    if (Math.abs((100 * fumbles) / touches - pct) > 0.006) throw new Error(`source row ${m[1]} is inconsistent: ${fumbles}/${touches} vs ${pct}%`);
    rows.set(Number(m[1]), { touches, fumbles, pct });
  }
  for (let y = 1970; y <= 2019; y++) if (!rows.has(y)) throw new Error(`source table has no ${y} row`);
  return { rows, retrieved: statSync(FI_FILE).mtime.toISOString().slice(0, 10) };
}

function nflverseSeason(season: number): { touches: number; fumbles: number } {
  const csv = readCsv(join(CACHE_DIR, 'stats_player', `stats_player_week_${season}.csv`));
  const [pid, pos, st, car, rec, rf, cf] = ['player_id', 'position', 'season_type', 'carries', 'receptions', 'rushing_fumbles', 'receiving_fumbles'].map((c) => csv.col(c));
  const per = new Map<string, { t: number; f: number }>();
  for (const r of csv.rows) {
    if (r[st!] !== 'REG' || !(r[pos!] === 'RB' || r[pos!] === 'FB')) continue;
    const a = per.get(r[pid!]!) ?? { t: 0, f: 0 };
    a.t += (num(r[car!]) ?? 0) + (num(r[rec!]) ?? 0);
    a.f += (num(r[rf!]) ?? 0) + (num(r[cf!]) ?? 0);
    per.set(r[pid!]!, a);
  }
  let touches = 0;
  let fumbles = 0;
  for (const a of per.values()) {
    if (a.t < MIN_TOUCHES) continue;
    touches += a.t;
    fumbles += a.f;
  }
  return { touches, fumbles };
}

function main(): void {
  const fetch = process.argv.includes('--fetch');
  const fi = sourceTable(fetch);
  const seasons: Record<string, SeasonRow> = {};
  const cross: { season: number; nflverse: number; source: number }[] = [];
  for (let y = FIRST_STATS_SEASON; y <= LAST_SEASON; y++) {
    const s = nflverseSeason(y);
    const rate = s.fumbles / s.touches;
    seasons[String(y)] = { rate: +rate.toFixed(5), touches: s.touches, fumbles: s.fumbles, src: `nflverse:stats_player_week ${y} (REG, RB/FB with ${MIN_TOUCHES}+ touches)`, conf: 'verified' };
    const f = fi.rows.get(y);
    if (f) cross.push({ season: y, nflverse: 100 * rate, source: f.pct });
  }
  for (let y = 1970; y < FIRST_STATS_SEASON; y++) {
    const f = fi.rows.get(y)!;
    seasons[String(y)] = { rate: +(f.fumbles / f.touches).toFixed(5), touches: f.touches, fumbles: f.fumbles, src: `fantasyindex:rb-fumbles-2020 (${y} row: ${f.fumbles} fumbles / ${f.touches.toLocaleString('en-US')} touches)`, conf: 'reference' };
  }
  const anchor = ANCHOR_1960S.map((y) => seasons[String(y)]!);
  const rate60 = anchor.reduce((a, r) => a + r.fumbles, 0) / anchor.reduce((a, r) => a + r.touches, 0);
  for (let y = 1960; y < 1970; y++) seasons[String(y)] = { rate: +rate60.toFixed(5), touches: 0, fumbles: 0, src: `estimate: held at the pooled ${ANCHOR_1960S[0]}–${ANCHOR_1960S[2]} rate (no cited 1960s figure)`, conf: 'estimated' };

  const meanGap = cross.reduce((a, c) => a + (c.nflverse - c.source), 0) / cross.length;
  const out = {
    _meta: {
      what: 'League fumble rate per season: fumbles ÷ touches (carries + receptions) of running backs with 100+ touches. The era baseline for Ball Security.',
      generatedBy: TOOL,
      sources: {
        '1999+': 'nflverse weekly player stats (CC-BY-4.0), REG weeks, position RB/FB, rushing_fumbles + receiving_fumbles',
        '1970–1998': `${FI_TITLE}, ${FI_URL} (retrieved ${fi.retrieved}); table "FUMBLE RATES, LAST 50 YEARS"; definition quoted: "${FI_DEFINITION}"`,
        '1960–1969': `estimated: the pooled ${ANCHOR_1960S.join(', ')} rate (${(100 * rate60).toFixed(2)}%)`,
      },
      crossCheck: { seasons: `${cross[0]!.season}–${cross[cross.length - 1]!.season}`, meanGapPts: +meanGap.toFixed(3), note: 'nflverse minus the cited table, percentage points, same definition' },
    },
    seasons,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote ${OUT} (${Object.keys(seasons).length} seasons; nflverse vs source 1999–2019 mean gap ${meanGap.toFixed(3)} pts)`);

  const L: string[] = [];
  const pct = (r: number) => `${(100 * r).toFixed(2)}%`;
  L.push('## League fumble rates (`data/augment/league_fumbles.json`)', '');
  L.push(`Generated by \`${TOOL}\`. The era baseline for Ball Security (user-approved, PR #3 round 2: "era-adjust Ball Security against the league rate for its season, like every other rate stat"). Rate = fumbles ÷ touches (carries + receptions) of running backs with ${MIN_TOUCHES}+ touches in the season, the same definition as the cited source; a player's fumbles per touch is divided by the games-weighted league rate over his stint.`, '');
  L.push(`- **1999–${LAST_SEASON}** (\`verified\`): nflverse weekly stats, REG weeks, RB/FB, rushing + receiving fumbles.`);
  L.push(`- **1970–1998** (\`reference\`): [${FI_TITLE}](${FI_URL}), table "FUMBLE RATES, LAST 50 YEARS", parsed from the cached page; each row is checked (fumbles ÷ touches = the printed percent) and the build refuses if the page, the table or the definition sentence is missing. The source defines it: "${FI_DEFINITION}"`);
  L.push(`- **1960–1969** (\`estimated\`): no cited figure; held at the pooled 1970–72 rate (${pct(rate60)}).`);
  L.push(`- **Cross-check, 1999–2019** (both sources): nflverse minus the cited table averages ${meanGap >= 0 ? '+' : ''}${meanGap.toFixed(2)} points (per season: ${cross.filter((_, i) => i % 5 === 0).map((c) => `${c.season} ${c.nflverse.toFixed(2)} vs ${c.source.toFixed(2)}`).join(', ')}).`, '');
  L.push('| Decade | Seasons | League rate (pooled) | Source |', '|---|---|---:|---|');
  for (const d of [1960, 1970, 1980, 1990, 2000, 2010, 2020]) {
    const ys = Object.keys(seasons).map(Number).filter((y) => y >= d && y < d + 10);
    const rs = ys.map((y) => seasons[String(y)]!);
    const withT = rs.filter((r) => r.touches > 0);
    const rate = withT.length ? withT.reduce((a, r) => a + r.fumbles, 0) / withT.reduce((a, r) => a + r.touches, 0) : rs[0]!.rate;
    L.push(`| ${d}s | ${ys[0]}–${ys[ys.length - 1]} | ${pct(rate)} | ${[...new Set(rs.map((r) => r.conf))].join(' + ')} |`);
  }
  L.push('');
  writeMarkedSection(REPORT, TOOL, L);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
