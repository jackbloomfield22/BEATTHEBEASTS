// "Approved fixes, round 2" subsection of docs/RATINGS_REPORT.md (PR #3
// round 2): the user's decisions on the two open calls and the four new items,
// with before/after. "Before" is data/ratings/round2.before.json, frozen by
// tools/ratings/round2-before.ts at the branch head before round 2.

import { readFileSync } from 'node:fs';
import { attrLabel, SKILL_ATTRS } from '../../src/engine/ratings/attributes/index.ts';
import type { RatingRun } from '../../src/engine/ratings/engine.ts';
import { OVR_WEIGHTS } from '../../src/engine/ratings/ovrWeights.ts';
import type { RatedEntry, RatedPos } from '../../src/engine/ratings/types.ts';
import type { LoadedSources } from './sources.ts';
import { ROOT } from './sources.ts';

interface Before {
  name: string;
  pos: string;
  ovr: number;
  conf: string;
  attrs: Record<string, number>;
}

const f1 = (x: number) => x.toFixed(1);
const who = (e: { name: string; team: string; decade: string }) => `${e.name} (${e.team} ${e.decade})`;
const idWho = (id: string, name: string) => `${name} (${id.split(':')[2]} ${id.split(':')[3]})`;

export function approvedFixes2Section(run: RatingRun, S: LoadedSources): string[] {
  const before = (JSON.parse(readFileSync(ROOT + 'data/ratings/round2.before.json', 'utf8')) as { entries: Record<string, Before> }).entries;
  const fumbles = JSON.parse(readFileSync(ROOT + 'data/augment/league_fumbles.json', 'utf8')) as { seasons: Record<string, { rate: number; touches: number; fumbles: number; conf: string }> };
  const forty = JSON.parse(readFileSync(ROOT + 'data/augment/forty_times.json', 'utf8')) as {
    _meta: { coverage: Record<string, { measured: string[]; cited: string[]; uncited: string[]; bodyPrior: string[] }> };
    people: Record<string, { name: string; pos: string; forty: number; kind: string; timing?: string }>;
  };
  const r1Before = (JSON.parse(readFileSync(ROOT + 'data/ratings/approved-fixes.before.json', 'utf8')) as { entries: Record<string, { attrs?: Record<string, number> }> }).entries;
  const lines: string[] = [];
  const out = (...s: string[]) => lines.push(...s);
  const byPos = (pos: string) => run.entries.filter((e) => e.pos === pos).sort((a, b) => b.ovr.value - a.ovr.value || a.id.localeCompare(b.id));
  const rankNow = (e: RatedEntry) => byPos(e.pos).indexOf(e) + 1;
  const beforeList = (pos: string) =>
    Object.entries(before)
      .filter(([, b]) => b.pos === pos)
      .sort((a, b) => b[1].ovr - a[1].ovr || a[0].localeCompare(b[0]));
  const rankBefore = (id: string) => {
    const b = before[id];
    return b ? beforeList(b.pos).findIndex(([x]) => x === id) + 1 : 0;
  };
  const get = (id: string) => run.entries.find((e) => e.id === id);
  const ba = (e: RatedEntry) => {
    const b = before[e.id];
    return b ? `${f1(b.ovr)} (#${rankBefore(e.id)})` : 'new';
  };
  const topTable = (pos: RatedPos, n = 10) => {
    const was = beforeList(pos);
    const now = byPos(pos);
    out(`| # | ${pos} before round 2 | ${pos} now (was) |`, '|---|---|---|');
    for (let i = 0; i < n; i++) {
      const [bid, b] = was[i]!;
      const e = now[i]!;
      out(`| ${i + 1} | ${idWho(bid, b.name)} ${f1(b.ovr)} | ${who(e)} ${f1(e.ovr.value)} (${ba(e)}) |`);
    }
    out('');
  };

  out(
    '### Approved fixes, round 2 (ratings follow-up)',
    '',
    '_The user decided the two open calls and added four items (PR #3 round 2). "Before" is `data/ratings/round2.before.json` (every stint at the branch head before round 2, frozen by `tools/ratings/round2-before.ts`)._',
    '',
  );

  // Key players.
  const KEY = [
    'players:jerry-rice:SF:1980s',
    'players:george-kittle:SF:2020s',
    'players:kellen-winslow:LAC:1980s',
    'defense:reggie-white:PHI:1980s',
    'defense:reggie-white:PHI:1990s',
    'defense:bruce-smith:BUF:1990s',
    'players:walter-payton:CHI:1970s',
    'players:walter-payton:CHI:1980s',
    'defense:myles-garrett:CLE:2020s',
  ];
  out('| Stint | Pos | OVR before (rank) | OVR now (rank) | What moved it |', '|---|---|---|---|---|');
  const why: Record<string, string> = {
    'players:jerry-rice:SF:1980s': 'cited 40 (4.45–4.71 range, mean 4.58) instead of the uncited 4.65: Speed',
    'players:george-kittle:SF:2020s': 'block grade keeps its direction: Run Block',
    'players:kellen-winslow:LAC:1980s': 'block grade keeps its direction: Run Block',
    'defense:reggie-white:PHI:1980s': 'pool recalibration (a new stint in the DE pool)',
    'defense:reggie-white:PHI:1990s': 'added stint (1990–92, cited)',
    'defense:bruce-smith:BUF:1990s': 'pool recalibration',
    'players:walter-payton:CHI:1970s': 'Ball Security era-adjusted',
    'players:walter-payton:CHI:1980s': 'Ball Security era-adjusted',
    'defense:myles-garrett:CLE:2020s': '(unchanged)',
  };
  for (const id of KEY) {
    const e = get(id);
    if (!e) continue;
    const extra = e.pos === 'TE' ? ` ${before[id]?.attrs.runBlock ?? '–'} → ${f1(e.attrs.runBlock!.value)}` : e.pos === 'RB' ? ` ${before[id]?.attrs.ballSecurity ?? '–'} → ${f1(e.attrs.ballSecurity!.value)}` : id.startsWith('players:jerry-rice') ? ` ${before[id]?.attrs.speed ?? '–'} → ${f1(e.attrs.speed!.value)}` : '';
    out(`| ${who(e)} | ${e.pos} | ${ba(e)} | ${f1(e.ovr.value)} (#${rankNow(e)}) | ${why[id]}${extra} |`);
  }
  out('');

  // 1. TE block grade.
  const kittle = get('players:george-kittle:SF:2020s')!;
  const winslow = get('players:kellen-winslow:LAC:1980s')!;
  const rb = SKILL_ATTRS.TE.find((d) => d.key === 'runBlock')!;
  const w = (k: string) => rb.terms.find((t) => (Array.isArray(t.s) ? t.s : [t.s]).includes(k))!.w;
  const contrib = (e: RatedEntry, prefix: string) => e.attrs.runBlock!.contributions.find((c) => c.label.startsWith(prefix))?.delta ?? 0;
  const winAbove = byPos('TE').indexOf(winslow) < byPos('TE').indexOf(kittle);
  out(
    `1. **TE block grade: per-player cap dropped, 20% weight cap kept** (user: "Kittle really is the best blocking tight end of his era and Winslow was a poor blocker; a cap that flips them is wrong"). The grade now moves blocking in its own direction at its 20% weight. Kittle's Run Block ${before[kittle.id]!.attrs.runBlock} → ${f1(kittle.attrs.runBlock!.value)} (grade 92), Winslow's ${before[winslow.id]!.attrs.runBlock} → ${f1(winslow.attrs.runBlock!.value)} (grade 70). TE OVR: **Kittle #${rankNow(kittle)} (${f1(kittle.ovr.value)}), Winslow #${rankNow(winslow)} (${f1(winslow.ovr.value)})**; ${winAbove ? 'Winslow is still above Kittle.' : 'Winslow is no longer #1 and sits below Kittle.'}`,
    `   Winslow's Run Block is still ${f1(winslow.attrs.runBlock!.value)} (it was ${r1Before[winslow.id]?.attrs?.runBlock ?? '–'} before round 1) because round 1 moved the block grade's lost weight onto size and strength: Run Block reads weight ${w('p_weight').toFixed(3)} and strength ${w('p_strength').toFixed(3)} (were 0.25 and 0.15), and his 251 lb frame translates to about 271 today (${contrib(winslow, 'Weight') >= 0 ? '+' : ''}${f1(contrib(winslow, 'Weight'))} from weight, ${f1(contrib(winslow, 'Strength'))} from strength, ${f1(contrib(winslow, 'Legacy block grade'))} from his grade). Blocking's weight in TE OVR is ${['runBlock', 'passBlock', 'impactBlock'].map((k) => `${attrLabel('TE', k)} ${OVR_WEIGHTS.TE[k]!.toFixed(3)}`).join(', ')} after the physicals cap. Reported, not changed (no new fix invented).`,
    '',
  );
  topTable('TE');

  // 2. Marino.
  const marino = get('players:dan-marino:MIA:1980s')!;
  const qbs = byPos('QB').sort((a, b) => b.attrs.release!.value - a.attrs.release!.value);
  out(`2. **Marino's Release anchor: 97+** (user-approved band; the anchor stays on Release). Release ${f1(marino.attrs.release!.value)}, rank ${qbs.indexOf(marino) + 1} of ${qbs.length}: passes.`, '');

  // 3. Fumbles.
  const dec = (d: number) => {
    const rs = Object.entries(fumbles.seasons).filter(([y]) => Number(y) >= d && Number(y) < d + 10).map(([, r]) => r);
    const t = rs.reduce((a, r) => a + r.touches, 0);
    return t ? rs.reduce((a, r) => a + r.fumbles, 0) / t : rs[0]!.rate;
  };
  out(
    `3. **Ball Security era-adjusted** (user: "Payton and Dickerson losing 5 points for playing before gloves and ball-security coaching is exactly the bias the era system exists to remove"). Fumbles per touch is now a log ratio to the league RB fumble rate over the stint's seasons, like every other rate stat (\`r_fum\`, "Fumbles per touch vs league"). League rate (RBs with 100+ touches): ${[1960, 1970, 1980, 1990, 2000, 2010, 2020].map((d) => `${d}s ${(100 * dec(d)).toFixed(2)}%`).join(', ')}. Sources: nflverse 1999+ (verified), a published season table for 1970–1998 (reference, checked row by row), the 1970–72 level held for the 1960s (estimated); see AUGMENT_REPORT "League fumble rates".`,
    '',
  );
  out('| RB stint | Ball Security before → now | OVR before → now |', '|---|---|---|');
  for (const id of ['players:walter-payton:CHI:1970s', 'players:walter-payton:CHI:1980s', 'players:eric-dickerson:LAR:1980s', 'players:barry-sanders:DET:1990s', 'players:saquon-barkley:PHI:2020s', 'players:marshall-faulk:LAR:1990s']) {
    const e = get(id);
    if (e) out(`| ${who(e)} | ${before[id]?.attrs.ballSecurity ?? '–'} → ${f1(e.attrs.ballSecurity!.value)} | ${ba(e)} → ${f1(e.ovr.value)} (#${rankNow(e)}) |`);
  }
  out('');
  topTable('RB');

  // 4. Forty.
  const cov = forty._meta.coverage;
  const tot = (k: 'measured' | 'cited' | 'uncited' | 'bodyPrior') => Object.values(cov).reduce((a, c) => a + c[k].length, 0);
  const cited = Object.values(forty.people).filter((p) => p.kind === 'cited');
  out(
    `4. **Cited 40 times for legends** (\`data/augment/forty_times.json\`, \`tools/augment/forty.ts\`; method, every quote and the full lists in AUGMENT_REPORT "40-yard times for legends"). Targets: the top 50 by OVR at each position without a measured time (${Object.values(cov).reduce((a, c) => a + c.measured.length + c.cited.length + c.uncited.length + c.bodyPrior.length, 0)} people). **${cited.length} got a cited time** (quoted verbatim from the article prose and checked against the cached page; \`estimated\`, Speed confidence 0.55, between the body prior and a measured time), ${tot('measured')} got a measured time (${Object.values(forty.people).filter((p) => p.kind === 'combine').length} OL starters from the nflverse combine, which the OL pool never read before, and Wikipedia pre-draft tables), ${tot('uncited')} keep an uncited estimate from M2 (${Object.values(cov).flatMap((c) => c.uncited).join(', ')}; your call whether to drop them to the body prior), and **${tot('bodyPrior')} stay on the body prior**: Wikipedia almost never states a 40 for a pre-combine player. By position (cited / measured / body prior): ${Object.entries(cov).map(([p, c]) => `${p} ${c.cited.length}/${c.measured.length}/${c.bodyPrior.length}`).join(', ')}.`,
    `   Cited: ${cited.map((p) => `${p.name} ${p.forty.toFixed(2)}`).join(', ')}. The engine adds the hand-time correction for the stated timing, so Lamar Jackson's reported 4.34 now reads 4.40 and Speed 94.5 (was 96.5 from the uncited estimate), which puts his approved 95+ band a hair out (flagged below). Jerry Rice's source gives a 4.45–4.71 range (mean 4.58, was 4.65): Speed ${before['players:jerry-rice:SF:1980s']?.attrs.speed} → ${f1(get('players:jerry-rice:SF:1980s')!.attrs.speed!.value)}.`,
    '',
  );

  // 5. Added stints and other gaps.
  const wp = get('defense:reggie-white:PHI:1990s');
  out(
    `5. **Missing stints** (\`data/augment/added_stints.json\`, \`tools/augment/added-stints.ts\`, validated by \`src/engine/data/addedStints.ts\`; legacy data untouched). One added: ${wp ? `${who(wp)}, 1990–92, 43 sacks (14, 15, 14; checked against the Wikipedia career table), 2 INT, 5 FR, 1 TD, 48 games, first-team All-Pro 1990 and 1991, second-team 1992 (cited honors); \`imp\` 97 from his PHI 1980s stint. **DE #${rankNow(wp)}, ${f1(wp.ovr.value)}** (${wp.ovr.conf})` : 'not rated'}. Person, body and honors come from his existing stint; the stint's seasons, games and stats are \`reference\`.`,
    '',
  );
  topTable('DE');

  // M4.5: four more of the gaps, named by the user.
  const m45 = S.added.filter((r) => r.id !== 'defense:reggie-white:PHI:1990s');
  if (m45.length) {
    const ranges = (ys: readonly number[]) => (ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : `${ys[0]}`);
    out(
      `   **Added in M4.5** (user: "from the 47 missing stints add only these: Deion Sanders ATL/SF 1990–94, Randy Moss MIN 2000–04, Terrell Owens SF 2000–03, Charles Woodson LV. Sourced like White's"). Same method as White: season lines from the player's Wikipedia career table (revision pinned; the table must agree with its own Career row, the stated values and nflverse roster seasons), \`imp\` from the same player's legacy stint (same franchise in the adjacent decade, else the nearest in time), person, body and honors from his existing stint. For 1999+ seasons the table was checked season by season against nflverse (receptions, yards and TDs, or interceptions and sacks: all equal) and the ratings read the nflverse stats (verified), as for every legacy stint. A stint is one franchise in one decade, so "ATL/SF 1990–94" is two stints (ATL 1990–93, SF 1994) and Woodson's first Raiders run (1998–2005) is LV 1990s and LV 2000s; his 2013–15 return (safety, ages 37–39) is not added.`,
      '',
      '| Stint | Seasons | Line | imp from | OVR (rank) | Confidence |',
      '|---|---|---|---|---|---|',
    );
    for (const r of m45) {
      const e = get(r.id);
      const t = r.totals;
      const line = r.id.startsWith('players:') ? `${t.games} G, ${t.rec} rec, ${t.yds} yds, ${t.td} TD` : `${t.games} G, ${t.int} INT, ${t.td} TD, ${t.sk} sk`;
      out(`| ${idWho(r.id, r.entry.n)} | ${ranges(r.seasons)} | ${line} | ${idWho(r.impFrom, r.entry.n)}, imp ${S.players.find((p) => p.id === r.impFrom)?.imp ?? S.defense.find((d) => d.id === r.impFrom)?.imp} | ${e ? `**${f1(e.ovr.value)} (${e.pos} #${rankNow(e)})**` : 'not rated'} | ${e?.ovr.conf ?? '–'} |`);
    }
    out('');
  }

  // Other gaps noticed, not added.
  const byId = new Map(run.entries.map((e) => [e.id, e]));
  const gaps: { score: number; text: string }[] = [];
  for (const r of Object.values(S.accolades)) {
    if (!r?.entries?.length) continue;
    const stints = r.entries.map((id) => byId.get(id)).filter((e): e is RatedEntry => !!e);
    if (!stints.length) continue;
    const covered = new Set(stints.flatMap((e) => e.inputs.seasons.v));
    const miss = (l?: number[]) => (l ?? []).filter((y) => y >= 1960 && !covered.has(y));
    const ap1 = miss(r.allPro1);
    const ap2 = miss(r.allPro2).filter((y) => !ap1.includes(y));
    const pb = miss(r.proBowl);
    const score = ap1.length + 0.5 * ap2.length + 0.35 * pb.length;
    if (ap1.length >= 2 || score >= 2.5) {
      const best = stints.sort((a, b) => b.ovr.value - a.ovr.value)[0]!;
      gaps.push({ score, text: `${r.name} (${best.pos}; rated: ${stints.map((e) => `${e.team} ${e.decade} ${f1(e.ovr.value)}`).join(', ')}): honors seasons in no stint: ${[ap1.length ? `All-Pro ${ap1.join(', ')}` : '', ap2.length ? `2nd-team ${ap2.join(', ')}` : '', pb.length ? `Pro Bowl ${pb.join(', ')}` : ''].filter(Boolean).join('; ')}` });
    }
  }
  gaps.sort((a, b) => b.score - a.score);
  out(
    `   **Other gaps noticed (not added; your call).** People whose cited honors (1960 on) fall in seasons none of their rated stints cover, at least two first-team All-Pro seasons or the equivalent (${gaps.length}):`,
    '',
    ...gaps.map((g) => `   - ${g.text}`),
    '',
  );

  out('6. **The estimated 1970s–80s WR stints ranked 12–21** (Branch, Pearson, Quick, Jefferson): left as they are, as decided.', '');
  return lines;
}
