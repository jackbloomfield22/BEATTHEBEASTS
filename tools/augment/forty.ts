// 40-yard times for players with no measured time → data/augment/forty_times.json
// (user-approved, PR #3 round 2: "estimated speed for legends").
//
//   node tools/run-ts.mjs tools/augment/forty.ts [--fetch]
//
//   --fetch   allow Wikipedia API requests for pages missing from the cache
//             (tools/augment/cache/wiki/). Without it the run is offline and
//             fails if a page it needs is not cached.
//
// Targets: the top 50 players by OVR at each of the ten positions (distinct
// people, best stint) with no measured 40 in the base data (nflverse combine
// or a Wikipedia pre-draft table in estimated_physical.json), rated without
// this file. For each target, in order:
//   1. nflverse combine (OL only: the OL pool never read measurables before;
//      gsis id → PFR id via nflverse players, then the combine file)  verified
//   2. the "Pre-draft measurables" table ({{NFL predraft}}) of his Wikipedia
//      article                                                        reference
//   3. a quoted, cited time from tools/augment/forty-sources.ts, checked
//      verbatim against the cached article prose                      estimated
//   4. nothing: his Speed stays the body prior (listed in the report)
// Every OL starter with an nflverse combine 40 gets it (1), target or not.
// A curated quote that is not on the cached page, or whose time is not in the
// quote, refuses the build.

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rateAll } from '../../src/engine/ratings/engine.ts';
import { buildInputs } from '../../src/engine/ratings/inputs.ts';
import type { RatedPos } from '../../src/engine/ratings/types.ts';
import { loadSources } from '../ratings/sources.ts';
import { num, readCsv } from './csv.ts';
import { CACHE_DIR, ROOT } from './fetch-nflverse.ts';
import { FORTY_SOURCES } from './forty-sources.ts';
import { writeMarkedSection } from './report-sections.ts';
import { normText, pageUrl, permalink, WikiClient, wikiPlain, type WikiPage } from './wiki.ts';

const OUT = join(ROOT, 'data', 'augment', 'forty_times.json');
const REPORT = join(ROOT, 'docs', 'AUGMENT_REPORT.md');
const TOOL = 'tools/augment/forty.ts';
const POSITIONS: RatedPos[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DE', 'DT', 'LB', 'CB', 'S'];
/** Targets per position (the user's "at least the top 50 ... at EACH position"). */
const TOP_N = 50;
/** Plausible 40 range, as in tools/reference/build_physical.py. */
const FORTY_RANGE: [number, number] = [4.1, 5.9];

interface Target {
  pos: RatedPos;
  name: string;
  personId: string;
  ovr: number;
  rank: number;
  stints: string[];
  page?: string;
  existing?: string;
}

interface OutRecord {
  name: string;
  pos: RatedPos;
  forty: number;
  times?: number[];
  kind: 'combine' | 'predraft' | 'cited';
  timing?: string;
  quote?: string;
  basis?: string;
  src: string;
  url?: string;
  permalink?: string;
  retrieved?: string;
  conf: 'verified' | 'reference' | 'estimated';
}

const SUFFIX: Record<RatedPos, string> = { QB: 'quarterback', RB: 'running back', WR: 'wide receiver', TE: 'tight end', OL: 'offensive lineman', DE: 'defensive end', DT: 'defensive tackle', LB: 'linebacker', CB: 'cornerback', S: 'safety' };
const isDisamb = (p: WikiPage) => /\{\{\s*(disambiguation|hndis|set index|surname)/i.test(p.wikitext) || /may refer to/i.test(p.wikitext.slice(0, 600));
const isFootball = (p: WikiPage) => /american football|national football league|\bnfl\b/i.test(p.wikitext.slice(0, 4000));

function targetsOf(): Target[] {
  const S = loadSources({ forty: false });
  const run = rateAll(buildInputs(S).inputs);
  const accByEntry = new Map<string, { page?: string }>();
  for (const r of Object.values(S.accolades)) for (const e of r?.entries ?? []) accByEntry.set(e, r as { page?: string });
  const out: Target[] = [];
  for (const pos of POSITIONS) {
    const list = run.entries.filter((e) => e.pos === pos).sort((a, b) => b.ovr.value - a.ovr.value || a.id.localeCompare(b.id));
    const seen = new Set<string>();
    let n = 0;
    for (const e of list) {
      if (seen.has(e.personId)) continue;
      seen.add(e.personId);
      const f = e.inputs.measurables.forty;
      if (f && (f.conf === 'verified' || f.conf === 'reference')) continue;
      const stints = list.filter((x) => x.personId === e.personId).map((x) => x.id);
      const page = stints.map((id) => accByEntry.get(id)?.page ?? accByEntry.get(`ol-key:${id.split('#')[0]}:0`)?.page).find(Boolean);
      out.push({ pos, name: e.name, personId: e.personId, ovr: e.ovr.value, rank: seen.size, stints, page, existing: f ? `${f.v.toFixed(2)} (${f.src})` : undefined });
      if (++n >= TOP_N) break;
    }
  }
  return out;
}

/** The article for a target: the accolades page, his name, or "Name (position)" / "Name (American football)". */
function resolvePages(wiki: WikiClient, targets: readonly Target[]): Map<string, WikiPage> {
  const first = wiki.pages([...new Set(targets.flatMap((t) => [t.page, t.name].filter((x): x is string => !!x)))]);
  const ok = (p: WikiPage | null | undefined): p is WikiPage => !!p && !isDisamb(p) && isFootball(p);
  const out = new Map<string, WikiPage>();
  const retry: string[] = [];
  for (const t of targets) {
    const hit = [t.page, t.name].map((x) => (x ? first.get(x) : undefined)).find(ok);
    if (hit) out.set(t.personId, hit);
    else retry.push(`${t.name} (${SUFFIX[t.pos]})`, `${t.name} (American football)`);
  }
  const second = wiki.pages([...new Set(retry)]);
  for (const t of targets) {
    if (out.has(t.personId)) continue;
    const hit = [`${t.name} (${SUFFIX[t.pos]})`, `${t.name} (American football)`].map((x) => second.get(x)).find(ok);
    if (hit) out.set(t.personId, hit);
  }
  return out;
}

/** Body of the first {{NFL predraft ...}} template (nested templates allowed). */
function predraftTemplate(w: string): string | undefined {
  const m = /\{\{\s*NFL[ _]predraft/i.exec(w);
  if (!m) return undefined;
  let depth = 0;
  for (let i = m.index; i < w.length - 1; i++) {
    if (w[i] === '{' && w[i + 1] === '{') {
      depth++;
      i++;
    } else if (w[i] === '}' && w[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) return w.slice(m.index + 2, i - 1);
    }
  }
  return undefined;
}

function predraftForty(p: WikiPage): { forty: number; note: string } | undefined {
  const body = predraftTemplate(p.wikitext);
  if (!body) return undefined;
  const params = new Map<string, string>();
  for (const part of body.split(/\n\s*\|/)) {
    const i = part.indexOf('=');
    if (i > 0) params.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  const raw = ['dash', 'forty', '40'].map((k) => params.get(k)).find((v) => v && /\d/.test(v));
  const v = raw ? Number(/(\d\.\d+)/.exec(raw)?.[1]) : NaN;
  if (!(v >= FORTY_RANGE[0] && v <= FORTY_RANGE[1])) return undefined;
  if (/\{\{\s*(cn|citation needed|fact)\b/i.test(raw!)) return undefined;
  const note = normText(wikiPlain(params.get('note') ?? params.get('notes') ?? '')).slice(0, 160);
  return { forty: v, note };
}

/** nflverse combine 40 by gsis id (players.csv gsis → pfr, combine.csv by pfr). */
function combineByGsis(): Map<string, { forty: number; season: number }> {
  const players = readCsv(join(CACHE_DIR, 'players.csv'));
  const [g, p] = [players.col('gsis_id'), players.col('pfr_id')];
  const pfrOf = new Map<string, string>();
  for (const r of players.rows) if (r[g] && r[p]) pfrOf.set(r[g]!, r[p]!);
  const combine = readCsv(join(CACHE_DIR, 'combine.csv'));
  const [cp, cf, cs] = [combine.col('pfr_id'), combine.col('forty'), combine.col('season')];
  const byPfr = new Map<string, { forty: number; season: number }>();
  for (const r of combine.rows) {
    const f = num(r[cf]);
    if (r[cp] && f !== null && f >= FORTY_RANGE[0] && f <= FORTY_RANGE[1]) byPfr.set(r[cp]!, { forty: f, season: num(r[cs]) ?? 0 });
  }
  const out = new Map<string, { forty: number; season: number }>();
  for (const [gsis, pfr] of pfrOf) {
    const c = byPfr.get(pfr);
    if (c) out.set(gsis, c);
  }
  return out;
}

function main(): void {
  const fetch = process.argv.includes('--fetch');
  const wiki = new WikiClient(!fetch, (s) => console.error(s));
  const targets = targetsOf();
  const pages = resolvePages(wiki, targets);
  const combine = combineByGsis();
  const S = loadSources({ forty: false });
  const people: Record<string, OutRecord> = {};
  const problems: string[] = [];

  // 1. OL starters with a combine 40 (every lineman in the rated units).
  const olNames = new Map<string, string>();
  for (const u of Object.values(S.olRosters)) for (const l of u?.linemen ?? []) olNames.set(l.personId, l.name);
  for (const [pid, name] of olNames) {
    const c = combine.get(pid);
    if (c) people[pid] = { name, pos: 'OL', forty: c.forty, kind: 'combine', src: `nflverse:combine ${c.season}`, conf: 'verified' };
  }
  // 2. Pre-draft tables for the targets.
  for (const t of targets) {
    if (people[t.personId]) continue;
    const p = pages.get(t.personId);
    const pd = p ? predraftForty(p) : undefined;
    if (p && pd) {
      people[t.personId] = {
        name: t.name,
        pos: t.pos,
        forty: pd.forty,
        kind: 'predraft',
        src: `wikipedia:${p.title}#Pre-draft measurables${pd.note ? ` (${pd.note})` : ''}`,
        url: pageUrl(p.title),
        permalink: permalink(p.title, p.revid),
        retrieved: p.retrieved,
        conf: 'reference',
      };
    }
  }
  // 3. Cited, quoted times.
  const citedPages = wiki.pages(FORTY_SOURCES.map((d) => d.page));
  const targetIds = new Set(targets.map((t) => t.personId));
  for (const d of FORTY_SOURCES) {
    const p = citedPages.get(d.page);
    if (!p) {
      problems.push(`${d.name}: page "${d.page}" not cached (rerun with --fetch)`);
      continue;
    }
    if (!normText(wikiPlain(p.wikitext)).includes(normText(d.quote))) problems.push(`${d.name}: quote not found in "${p.title}": ${d.quote}`);
    for (const x of d.times) if (!d.quote.includes(String(x))) problems.push(`${d.name}: time ${x} is not in the quote`);
    if (d.quote.trim().split(/\s+/).length > 30) problems.push(`${d.name}: quote over 30 words`);
    if (!targetIds.has(d.personId)) problems.push(`${d.name} (${d.personId}): not a target (has a measured time or is outside the top ${TOP_N})`);
    if (people[d.personId]) continue; // a measured time wins
    const t = targets.find((x) => x.personId === d.personId);
    const forty = +(d.times.reduce((a, b) => a + b, 0) / d.times.length).toFixed(3);
    people[d.personId] = {
      name: d.name,
      pos: t?.pos ?? 'QB',
      forty,
      ...(d.times.length > 1 ? { times: [...d.times] } : {}),
      kind: 'cited',
      timing: d.timing,
      quote: d.quote,
      basis: d.basis,
      src: `cited40:wikipedia:${p.title}`,
      url: pageUrl(p.title),
      permalink: permalink(p.title, p.revid),
      retrieved: p.retrieved,
      conf: 'estimated',
    };
  }
  if (problems.length) {
    for (const p of problems) console.error(`  - ${p}`);
    throw new Error(`${problems.length} forty source problem(s)`);
  }

  // Coverage of the targets.
  const coverage: Record<string, { measured: string[]; cited: string[]; uncited: string[]; bodyPrior: string[]; noPage: string[] }> = {};
  for (const pos of POSITIONS) coverage[pos] = { measured: [], cited: [], uncited: [], bodyPrior: [], noPage: [] };
  for (const t of targets) {
    const r = people[t.personId];
    const c = coverage[t.pos]!;
    if (r && r.kind !== 'cited') c.measured.push(t.name);
    else if (r) c.cited.push(t.name);
    else if (t.existing) c.uncited.push(t.name);
    else c.bodyPrior.push(t.name);
    if (!pages.has(t.personId)) c.noPage.push(t.name);
  }
  const sorted = Object.fromEntries(Object.entries(people).sort((a, b) => a[0].localeCompare(b[0])));
  const out = {
    _meta: {
      what: '40-yard times for players with no measured time in the base data, keyed by person id: nflverse combine for OL starters (verified), Wikipedia pre-draft tables (reference) and quoted, cited times (estimated) for the top 50 per position without one.',
      generatedBy: TOOL,
      targets: `top ${TOP_N} by OVR per position (distinct people, best stint) with no measured 40, rated without this file`,
      coverage,
    },
    people: sorted,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  const cnt = (k: OutRecord['kind']) => Object.values(people).filter((r) => r.kind === k).length;
  console.log(`wrote ${OUT}: ${Object.keys(people).length} people (combine ${cnt('combine')}, predraft ${cnt('predraft')}, cited ${cnt('cited')}); ${targets.length} targets`);

  const L: string[] = [];
  L.push('## 40-yard times for legends (`data/augment/forty_times.json`)', '');
  L.push(`Generated by \`${TOOL}\` (user-approved, PR #3 round 2: "a sourced list of commonly cited 40-yard times for players who never had combine data, the same method as arm_strength.json"). Targets: the top ${TOP_N} by OVR at each position (distinct people, best stint) with no measured 40 in the base data. For each: an nflverse combine time (OL only; the OL pool read no measurables before), a Wikipedia pre-draft table time (\`reference\`, the same rule as \`estimated_physical.json\`), or a quoted time from the article prose (\`estimated\`, curated in \`tools/augment/forty-sources.ts\`, each quote checked verbatim against the cached page; the build refuses a missing quote). Where none exists, Speed stays the body prior and the player is listed below.`, '');
  L.push('- **In the engine:** a measured time (combine, table) works as before. A cited time is an estimated measurable: Speed confidence 0.55, between the body prior (0.4 with a production signature, 0 without) and a table time (0.9); the hand-time correction follows its stated timing (hand or unstated +0.06 s, electronic pro day +0.05, Combine +0.03). It replaces an uncited estimate from `estimated_physical.json` and never a measured time. Two times or a range count as their mean.');
  L.push(`- **Found:** ${cnt('combine')} OL starters with an nflverse combine 40 (${Object.values(coverage).reduce((a, c) => a + c.measured.length, 0)} targets now measured, combine or table), ${cnt('predraft')} pre-draft table times, ${cnt('cited')} cited times. Wikipedia rarely states a 40 for players who predate the combine: ${Object.values(coverage).reduce((a, c) => a + c.bodyPrior.length + c.uncited.length, 0)} of ${targets.length} targets have none.`);
  L.push('- **Left out on purpose:** rumors (Darrell Green\'s "rumored" 4.09 camp time; his existing uncited 4.25 estimate stays), 100-yard or 100-meter times, and times of other players named near him.', '');
  L.push('| Player | Pos | 40 | Kind | Timing | Quote / source |', '|---|---|---:|---|---|---|');
  for (const [, r] of Object.entries(sorted).filter(([, r]) => r.kind !== 'combine').sort((a, b) => POSITIONS.indexOf(a[1].pos) - POSITIONS.indexOf(b[1].pos) || a[1].name.localeCompare(b[1].name))) {
    L.push(`| ${r.name} | ${r.pos} | ${r.forty.toFixed(2)}${r.times ? ` (${r.times.join(' / ')})` : ''} | ${r.kind} | ${r.timing ?? ''} | ${r.quote ? `"${r.quote}" ([${r.src.replace('cited40:wikipedia:', 'Wikipedia: ')}](${r.permalink}))` : `[${r.src}](${r.permalink})`} |`);
  }
  L.push('', 'Targets per position: measured now (combine or table) / cited / uncited estimate kept / body prior.', '', '| Pos | Measured | Cited | Uncited estimate | Body prior (no credible cited time) |', '|---|---:|---:|---:|---|');
  for (const pos of POSITIONS) {
    const c = coverage[pos]!;
    L.push(`| ${pos} | ${c.measured.length} | ${c.cited.length} | ${c.uncited.length}${c.uncited.length ? ` (${c.uncited.join(', ')})` : ''} | ${c.bodyPrior.length}: ${c.bodyPrior.join(', ')} |`);
  }
  const noPage = Object.values(coverage).flatMap((c) => c.noPage);
  L.push('', `No Wikipedia article found for: ${noPage.join(', ') || 'none'}.`, '');
  writeMarkedSection(REPORT, TOOL, L);
}

// Run directly or through tools/run-ts.mjs (which passes a relative path).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
