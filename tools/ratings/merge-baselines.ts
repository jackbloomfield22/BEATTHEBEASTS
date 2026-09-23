// Merge the per-season league baselines into data/era_baselines.json.
//
//   node --experimental-strip-types tools/ratings/merge-baselines.ts [--check]
//
// Inputs (BRIEF "Era baselines come from real league-wide averages by
// season"):
//   data/augment/era_baselines_1999plus.json  nflverse, verified
//   data/augment/era_baselines_pre1999.json   estimated from published league averages (flagged)
//
// Output: one row per season 1960–latest with the same field names, plus an
// `afl` row for 1960–1969 (AFL franchises are compared to the AFL). Receiving
// targets were first tracked in 1992; for 1992–1998 the league catch rate and
// yards per target are derived from completion % and yards per attempt using
// the average 1999–2002 and 2009 gap between them (flagged `estimated`).

import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

interface Row {
  [k: string]: unknown;
}

const post = read('data/augment/era_baselines_1999plus.json') as { _meta: Row; seasons: Record<string, Row> };
const pre = read('data/augment/era_baselines_pre1999.json') as { _meta: Row; seasons: Record<string, Row> };
// League RB fumble rate per season (tools/augment/fumbles.ts): the Ball Security baseline.
const fumbles = read('data/augment/league_fumbles.json') as { seasons: Record<string, { rate: number; src: string; conf: string }> };
const fumbleFields = (y: string): Row => {
  const f = fumbles.seasons[y];
  if (!f) throw new Error(`league_fumbles.json has no ${y}`);
  return { rbFumblesPerTouch: f.rate, fumbleSrc: `${f.src} [${f.conf}]` };
};

const FIELDS = [
  'cmpPct',
  'ypa',
  'tdPct',
  'intPct',
  'sackPct',
  'passerRating',
  'ypc',
  'pointsPerTeamGame',
  'passAttPerTeamGame',
  'passCmpPerTeamGame',
  'passYdsPerTeamGame',
  'passTdPerTeamGame',
  'intPerTeamGame',
  'sacksPerTeamGame',
  'rushAttPerTeamGame',
  'rushYdsPerTeamGame',
  'rushTdPerTeamGame',
  'yardsPerReception',
  'yardsPerTarget',
  'catchRate',
  'passDefendedPerTeamGame',
  'tacklesPerTeamGame',
] as const;

function norm(r: Row): Row {
  const o: Row = {};
  for (const f of FIELDS) {
    const v = f === 'cmpPct' ? (r.cmpPct ?? r.compPct) : r[f];
    if (typeof v === 'number') o[f] = +v.toFixed(4);
  }
  return o;
}

const num = (r: Row | undefined, k: string): number => {
  const v = r?.[k];
  if (typeof v !== 'number') throw new Error(`baseline missing ${k}`);
  return v;
};

// The 1999–2002 + 2009 gap (nflverse has no targets 2003–2008) between catch rate and completion %, and yards per target and Y/A.
const gapYears = ['1999', '2000', '2001', '2002', '2009'];
const catchGap = gapYears.reduce((a, y) => a + num(post.seasons[y], 'catchRate') - num(post.seasons[y], 'cmpPct'), 0) / gapYears.length;
const yptGap = gapYears.reduce((a, y) => a + num(post.seasons[y], 'yardsPerTarget') - num(post.seasons[y], 'ypa'), 0) / gapYears.length;

const seasons: Record<string, Row> = {};
for (const [y, r] of Object.entries(pre.seasons)) {
  const season = Number(y);
  if (season >= 1999) continue;
  const row: Row = {
    season,
    league: season < 1970 ? 'NFL' : 'NFL (merged)',
    gamesPerTeam: r.gamesPerTeam,
    sacksOfficial: r.sacksOfficial ?? season >= 1982,
    ...norm(r),
    src: 'estimate:knowledge (data/augment/era_baselines_pre1999.json)',
    conf: 'estimated',
  };
  if (season >= 1992) {
    row.catchRate = +(num(row, 'cmpPct') + catchGap).toFixed(2);
    row.yardsPerTarget = +(num(row, 'ypa') + yptGap).toFixed(3);
    row.targetsNote = `catchRate and yardsPerTarget derived from cmpPct/ypa with the 1999–2002 and 2009 gaps (+${catchGap.toFixed(2)} pts, +${yptGap.toFixed(3)} yds)`;
  }
  Object.assign(row, fumbleFields(y));
  const afl = r.afl as Row | undefined;
  // No separate AFL fumble figure exists; the AFL row uses the same league-wide estimate.
  if (afl) row.afl = { ...norm(afl), gamesPerTeam: afl.gamesPerTeam, ...fumbleFields(y), src: row.src, conf: 'estimated' };
  seasons[y] = row;
}
for (const [y, r] of Object.entries(post.seasons)) {
  const season = Number(y);
  seasons[y] = {
    season,
    league: 'NFL',
    gamesPerTeam: Math.round(num(r, 'teamGames') / num(r, 'teams')),
    sacksOfficial: true,
    ...norm(r),
    ...fumbleFields(y),
    src: String(r.src ?? 'nflverse'),
    conf: 'verified',
  };
}

const out = {
  version: 1,
  _meta: {
    generatedBy: 'tools/ratings/merge-baselines.ts',
    doc: 'League-wide per-season averages. Percentages are 0–100. *PerTeamGame = league total / team games. 1960–1969 rows are the NFL; `afl` holds the AFL. 1970+ is the merged NFL.',
    sources: {
      '1960–1998': 'data/augment/era_baselines_pre1999.json (estimated from knowledge of published league averages; flagged, verify)',
      '1999+': 'data/augment/era_baselines_1999plus.json (computed from nflverse player stats, CC-BY-4.0)',
      rbFumblesPerTouch: 'data/augment/league_fumbles.json (tools/augment/fumbles.ts): RBs with 100+ touches; nflverse 1999+, Fantasy Index table 1970–1998, estimated 1960s; per-season source in fumbleSrc',
    },
    targetsGap: { catchRate: +catchGap.toFixed(3), yardsPerTarget: +yptGap.toFixed(4) },
  },
  seasons,
};

const text = JSON.stringify(out, null, 1) + '\n';
const dest = new URL('data/era_baselines.json', ROOT);
if (process.argv.includes('--check')) {
  const cur = readFileSync(dest, 'utf8');
  if (cur !== text) {
    console.error('data/era_baselines.json is stale: run node --experimental-strip-types tools/ratings/merge-baselines.ts');
    process.exit(1);
  }
} else {
  writeFileSync(dest, text);
  console.log(`wrote data/era_baselines.json (${Object.keys(seasons).length} seasons)`);
}
