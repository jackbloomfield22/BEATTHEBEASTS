// "Diagnosis (for review)" subsection of docs/RATINGS_REPORT.md (ratings
// follow-up). The user asked four questions after the approved fixes and
// said "diagnose, don't change": this module only reads the finished run.
// Every number in the tables is computed here; the prose around them names
// the mechanism and cites the one outside source it uses.

import { attrLabel } from '../../src/engine/ratings/attributes/index.ts';
import type { RatingRun } from '../../src/engine/ratings/engine.ts';
import { accoladeScore } from '../../src/engine/ratings/signals.ts';
import type { RatedEntry, RatedPos } from '../../src/engine/ratings/types.ts';

/** League passing figures quoted from Football Perspective, "The Ebb and Flow of the NFL Passing Game Since 1932". */
const FP_URL = 'http://www.footballperspective.com/the-ebb-and-flow-of-the-nfl-passing-game-since-1932/';

const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const sgn = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
const who = (e: RatedEntry) => `${e.name} (${e.team} ${e.decade})`;

/**
 * OVR movement (OVR − 72) split by the provenance of the inputs behind it:
 * each OVR term (an attribute) is divided among that attribute's own
 * contributions in proportion. Approximate (an OVR term measures the
 * attribute against the pool mean, not against 72), but it shows what an
 * OVR rests on.
 */
function provenance(e: RatedEntry): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => (out[k] = (out[k] ?? 0) + v);
  for (const c of e.ovr.contributions) {
    if (c.kind === 'base') continue;
    const key = Object.keys(e.attrs).find((k) => c.label === attrLabel(e.pos, k));
    const a = key ? e.attrs[key] : undefined;
    if (!a) {
      add('shape', c.delta);
      continue;
    }
    const moves = a.contributions.filter((x) => x.kind !== 'base');
    const tot = moves.reduce((s, x) => s + x.delta, 0);
    if (Math.abs(tot) < 1e-9) continue;
    for (const x of moves) {
      const share = (c.delta * x.delta) / tot;
      if (x.kind === 'accolade') add('honors', share);
      else if (x.kind === 'reputation') add('reputation', share);
      else if (x.kind === 'stat' || x.kind === 'unit' || x.kind === 'scouting') add(x.conf === 'verified' ? 'stats verified' : x.conf === 'estimated' ? 'stats estimated' : 'stats legacy', share);
      else if (x.kind === 'physical') add(x.conf === 'verified' || x.conf === 'reference' ? 'physical measured' : 'physical estimated', share);
      else if (x.kind === 'body' || x.kind === 'aging') add('body/aging', share);
      else add('shape', share);
    }
  }
  return out;
}

const PROV_COLS = ['honors', 'stats verified', 'stats estimated', 'stats legacy', 'reputation', 'physical measured', 'physical estimated', 'body/aging', 'shape'] as const;

export function diagnosisSection(run: RatingRun): string[] {
  const lines: string[] = [];
  const out = (...s: string[]) => lines.push(...s);
  const byPos = (pos: RatedPos) => run.entries.filter((e) => e.pos === pos).sort((a, b) => b.ovr.value - a.ovr.value || a.id.localeCompare(b.id));
  const get = (id: string) => run.entries.find((e) => e.id === id);
  const rank = (e: RatedEntry) => byPos(e.pos).indexOf(e) + 1;
  const top3 = (e: RatedEntry) =>
    e.ovr.contributions
      .filter((c) => c.kind !== 'base')
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .map((c) => `${c.label} ${c.input ?? ''} (${sgn(c.delta)})`)
      .join(', ');
  const hon = (e: RatedEntry) => {
    const a = e.inputs.accolades;
    return a ? `${f2(accoladeScore(e.inputs)!.x)} (${a.seasons} season${a.seasons === 1 ? '' : 's'})` : '–';
  };
  const provTable = (list: RatedEntry[]) => {
    out(`| Stint | # | OVR | Conf | Games | Honors/season | ${PROV_COLS.join(' | ')} |`, `|---|---|---|---|---|---|${PROV_COLS.map(() => '---').join('|')}|`);
    for (const e of list) {
      const p = provenance(e);
      out(`| ${who(e)} | ${rank(e)} | ${f1(e.ovr.value)} | ${e.ovr.conf} (${f2(e.ovr.confScore)}) | ${e.inputs.games.v.toFixed(0)} (${e.inputs.games.conf}) | ${hon(e)} | ${PROV_COLS.map((k) => (p[k] === undefined || Math.abs(p[k]!) < 0.05 ? '·' : sgn(p[k]!))).join(' | ')} |`);
    }
    out('');
  };
  const attr = (e: RatedEntry, k: string) => f1(e.attrs[k]!.value);

  out(
    '### Diagnosis (for review)',
    '',
    '_Diagnosis only: the user asked four questions after the approved fixes and said "stats stay primary: do not change formulas or data". Nothing below changes a rating._',
    '',
    `"Provenance" splits OVR − 72 by the inputs behind it (each OVR term divided among its attribute's contributions in proportion; approximate): honors (reference), stats by provenance (verified = nflverse 1999+; estimated = our pre-1999 stint rates; legacy = the legacy file), legacy reputation (\`imp\`, and the TE block grade), physical attributes measured (combine or cited pro day) or estimated (body prior), body and aging, and shape (rank blend and pool calibration). Confidence is a label only: it never scales a value. Only sample size shrinks a signal, by games, whatever its provenance.`,
    '',
  );

  // ---------------------------------------------------------------- D1
  const wr = byPos('WR');
  const rice = wr.filter((e) => e.name === 'Jerry Rice' && e.team === 'SF');
  const best = rice[0]!;
  const above = wr.slice(0, rank(best) - 1);
  out(
    `**1. Jerry Rice after the physicals cap.** His best stint, ${who(best)}, is **#${rank(best)} of ${wr.length} WR at ${f1(best.ovr.value)}** (${best.ovr.conf}); ${rice
      .slice(1)
      .map((e) => `${who(e)} is #${rank(e)} at ${f1(e.ovr.value)}`)
      .join('; ')}. ${above.length ? `Above him: ${above.map((e) => `${who(e)} ${f1(e.ovr.value)}`).join(', ')}.` : 'Nobody is above him.'} Before the cap the 1980s stint was #15 at 94.5 (Speed 81 and Acceleration 80 from his 4.65 hand-timed 40 cost him against 4.3–4.4 receivers). The stints right behind him, with their three largest OVR contributions:`,
    '',
    '| # | Stint | OVR | Conf | Top 3 contributions |',
    '|---|---|---|---|---|',
    ...wr.slice(0, 8).map((e, i) => `| ${i + 1} | ${who(e)} | ${f1(e.ovr.value)} | ${e.ovr.conf} (${f2(e.ovr.confScore)}) | ${top3(e)} |`),
    '',
  );

  // ---------------------------------------------------------------- D2
  const four = ['players:cliff-branch:LV:1970s', 'players:drew-pearson:DAL:1970s', 'players:mike-quick:PHI:1980s', 'players:john-jefferson:LAC:1970s'].map(get).filter((e): e is RatedEntry => !!e);
  const modern = ['players:ja-marr-chase:CIN:2020s', 'players:justin-jefferson:MIN:2020s', 'players:terrell-owens:PHI:2000s'].map(get).filter((e): e is RatedEntry => !!e);
  const aboveRice = four.filter((e) => rank(e) < rank(best));
  const pre = (n: number) => wr.slice(0, n).filter((e) => ['1960s', '1970s', '1980s', '1990s'].includes(e.decade)).length;
  const poolPre = wr.filter((e) => ['1960s', '1970s', '1980s', '1990s'].includes(e.decade)).length / wr.length;
  out(
    `**2. Branch, Pearson, Quick and Jefferson: an easy ride from estimated inputs?** ${aboveRice.length ? `${aboveRice.map(who).join(', ')} still rank above Rice.` : `None of them ranks above Rice now: ${four.map((e) => `${e.name} #${rank(e)} (${f1(e.ovr.value)})`).join(', ')}.`} They still sit in the top 25 above verified modern stints, so the check was done anyway:`,
    '',
  );
  provTable([best, ...four, ...modern]);
  const jj = get('players:john-jefferson:LAC:1970s');
  const jjGb = get('players:john-jefferson:GB:1980s');
  out(
    '- **What is estimated.** Every rate stat of these stints (receptions, yards per catch and yards per game) is our pre-1999 stint estimate (`data/augment/estimated_stats_pre1999.json`, `estimated`); TDs are legacy; honors are cited (reference); the league baselines for 1960–1998 are estimated (`data/augment/era_baselines_pre1999.json`). There are no targets before 1992, so Catching falls back from catch % to receptions per game (volume counts 0.55 of Catching instead of 0.15), and there are no fumbles before 1999, so Ball Security regresses to the average. Rice\'s own 1980s stint is built the same way (estimated stats, cited honors), so none of this separates him from them.',
    '- **Does estimation cost anything?** No. Estimated stats count at full strength: confidence (0.53, medium, against 0.90 for Chase) is a label only, and shrinkage is by games alone, so a 100-game estimated stint is shrunk exactly like a 100-game verified one. What they rest on is honors first (the largest column), then estimated stats; verified skill evidence is zero. That is the "easy ride": not generous inputs, but inputs that are never discounted for being estimated.',
    `- **Are the estimated era baselines generous?** Only slightly, in two seasons. [Football Perspective](${FP_URL}) gives 1977 at 51.3% completions, 6.5 yards per attempt and 25 passes per team game, and 12.7 yards per completion in 1975, 1976 and 1977. Ours: 1977 51.6%, 6.30, 24.7 and 12.21; 1976 12.50; 1975 12.74. The 1976–77 yardage baselines are 2–4% low, which flatters a receiver's yards-per-catch and yards-per-game ratios by that much in those two seasons; weighted over a 1972–79 stint it is about 1%, against yards-per-catch ratios of +37–45% (17.1–18.0 vs about 12.5). The 1970s sack rate (about 8.3–9.0%) and INT rate (5.0–5.9% vs the source's 5.3% for 1970–77) match.`,
    `- **Short stints and honors per season.** Branch, Pearson and Quick are 7–8-season stints at 0.95–0.97 honors per season (half average, half best three), not inflated. ${jj ? `John Jefferson's LAC stint is 1978–79 only (${f2(accoladeScore(jj.inputs)!.x)} honors a season over 2 seasons): his two best years are the whole stint, so nothing dilutes them, and his estimated stats are shrunk (29 games of yards-per-catch sample: ×0.75). His later GB stint is separate (${jjGb ? `#${rank(jjGb)}, ${f1(jjGb.ovr.value)}` : 'rated separately'}).` : ''} Rice 1980s: 1.43 over 5 seasons.`,
    `- **Across the pool.** ${pre(25)} of the WR top 25 and ${pre(100)} of the top 100 are pre-2000 stints, against ${(poolPre * 100).toFixed(0)}% of the pool; the era-parity table keeps every WR decade within 1.1 points. Older stints are not held back; the one real asymmetry is that their estimated inputs are never discounted. Option (not applied): shrink \`estimated\` stats harder (a larger k), which would pull these four and Rice's 1980s stint down together.`,
    '',
  );

  // ---------------------------------------------------------------- D3
  const de = byPos('DE');
  const garrett = get('defense:myles-garrett:CLE:2020s')!;
  const white = get('defense:reggie-white:PHI:1980s')!;
  const whiteGb = get('defense:reggie-white:GB:1990s')!;
  const smith = get('defense:bruce-smith:BUF:1990s')!;
  const smith80 = get('defense:bruce-smith:BUF:1980s')!;
  const jjw = get('defense:j-j-watt:HOU:2010s')!;
  const tjw = get('defense:t-j-watt:PIT:2020s')!;
  const saquon = get('players:saquon-barkley:PHI:2020s')!;
  const faulk = get('players:marshall-faulk:LAR:1990s')!;
  const sanders = get('players:barry-sanders:DET:1990s')!;
  const payton = get('players:walter-payton:CHI:1970s')!;
  const dick = get('players:eric-dickerson:LAR:1980s')!;
  const sackShare = (e: RatedEntry) => e.inputs.stats.sacksPerGame!.v / e.inputs.baseline.sacksPerTeamGame;
  out(
    `**3. Current #1s: does verified modern data give them an edge at the top?** Garrett is DE #${rank(garrett)} (${f1(garrett.ovr.value)}). Barkley is RB #${rank(saquon)} (${f1(saquon.ovr.value)}) behind ${who(faulk)} ${f1(faulk.ovr.value)}, itself a verified one-season stint (1999).`,
    '',
  );
  provTable([garrett, jjw, tjw, smith, white]);
  out(
    `- **DE: yes, through measurables, not through stats.** Sack evidence is on equal terms: Garrett ${f2(garrett.inputs.stats.sacksPerGame!.v)} sacks a game against ${f2(garrett.inputs.baseline.sacksPerTeamGame)} per team game (share ${f2(sackShare(garrett))}), White ${f2(white.inputs.stats.sacksPerGame!.v)} against ${f2(white.inputs.baseline.sacksPerTeamGame)} (${f2(sackShare(white))}); era baselines make them the same. Honors are close (${hon(garrett)} vs ${hon(white)}). The difference is physical: Garrett's combine (4.64 40, 41" vertical, 33 bench reps) gives Speed ${attr(garrett, 'speed')} and Strength ${f1(garrett.attrs.strength?.value ?? 0)}, measured; White and Smith have no measurables in any source we hold, so their speed and agility are body priors (White Speed ${attr(white, 'speed')}, Smith ${attr(smith, 'speed')}, estimated), which cost them in Pursuit (White ${attr(white, 'pursuit')} vs Garrett ${attr(garrett, 'pursuit')}) and Finesse Moves. That is a swing of about 4.5 points of OVR movement (the two "physical" columns: Garrett ${sgn((provenance(garrett)['physical measured'] ?? 0) + (provenance(garrett)['physical estimated'] ?? 0))}, White ${sgn((provenance(white)['physical measured'] ?? 0) + (provenance(white)['physical estimated'] ?? 0))}, Smith ${sgn((provenance(smith)['physical measured'] ?? 0) + (provenance(smith)['physical estimated'] ?? 0))}), more than the whole gap; pool calibration and the rank blend give about 1.5 of it back (the "shape" column).`,
    `- **Sample size and confidence** don't favor the moderns: sacks shrink by games (k = 10) and all these stints have 73–145 games (×0.88–0.94). Confidence (high vs medium) never scales a value. Missing tackle data before 1999 moves weight onto honors (missing-evidence reweighting), which helps the older stints: Smith's Tackle is ${attr(smith, 'tackle')} against Garrett's ${attr(garrett, 'tackle')}.`,
    `- **RB: body and one un-era-adjusted stat.** Barkley vs Sanders (#${rank(sanders)}, ${f1(sanders.ovr.value)}): Sanders wins Vision (${attr(sanders, 'vision')} vs ${attr(saquon, 'vision')}), Elusiveness (${attr(sanders, 'elusiveness')} vs ${attr(saquon, 'elusiveness')}), Break Tackle and Catching. Barkley's edge is body (233 vs 203 lb: Trucking ${attr(saquon, 'trucking')} vs ${attr(sanders, 'trucking')}, Stiff Arm ${attr(saquon, 'stiffArm')} vs ${attr(sanders, 'stiffArm')}, Pass Block ${attr(saquon, 'passBlock')} vs ${attr(sanders, 'passBlock')}) and **Ball Security** (${attr(saquon, 'ballSecurity')} vs ${attr(sanders, 'ballSecurity')}). Fumbles per touch is the one rate stat **not compared to a league baseline** (\`r_fum\` is absolute; the era baselines have no fumble field), and fumbling fell across eras: in our own pool the median RB fumble rate is 1.9% for 1970s stints, 1.8% 1980s, 1.1% 1990s–2000s, 0.9% 2010s and 0.8% 2020s, and median Ball Security climbs from 52 to 77. So ${who(payton)} rates ${attr(payton, 'ballSecurity')} (${sgn(payton.ovr.contributions.find((c) => c.label === 'Ball Security')!.delta)} OVR) and ${who(dick)} ${attr(dick, 'ballSecurity')} (${sgn(dick.ovr.contributions.find((c) => c.label === 'Ball Security')!.delta)}), against Barkley's ${sgn(saquon.ovr.contributions.find((c) => c.label === 'Ball Security')!.delta)}. That is a systematic modern edge unrelated to verification (a candidate fix for your call: a league fumble baseline per season).`,
    `- **Short stints.** Barkley's PHI stint is 2024–25 (32 games); Faulk's LAR 1990s stint is 1999 alone. Shrinkage works against them (Barkley's yards per carry counts ×0.84, Sanders' ×0.95), but honors are never shrunk: a one- or two-season stint is all peak (Barkley 1.08 honors a season over 2 seasons; Faulk 1999 ${hon(faulk)}), while a 9-season stint mixes peak and non-peak years (Sanders ${hon(sanders)} with the best-three blend). Jim Brown is not in the legacy player list, so there is no stint to compare.`,
    '',
  );

  // ---------------------------------------------------------------- D4
  out(
    `**4. Reggie White and Bruce Smith.** ${[smith, white, whiteGb, smith80].map((e) => `${who(e)} #${rank(e)} of ${de.length}, ${f1(e.ovr.value)}`).join('; ')}. Top 3: ${de
      .slice(0, 3)
      .map((e) => `${who(e)} ${f1(e.ovr.value)}`)
      .join(', ')}.`,
    '',
    '| Attribute | ' + [garrett, jjw, tjw, smith, white, whiteGb].map(who).join(' | ') + ' |',
    '|---|' + [0, 1, 2, 3, 4, 5].map(() => '---').join('|') + '|',
    ...['finesseMoves', 'powerMoves', 'blockShed', 'pursuit', 'tackle', 'playRec', 'awareness', 'speed', 'acceleration'].map((k) => `| ${attrLabel('DE', k)} | ${[garrett, jjw, tjw, smith, white, whiteGb].map((e) => attr(e, k)).join(' | ')} |`),
    `| Sacks/game vs league team | ${[garrett, jjw, tjw, smith, white, whiteGb].map((e) => `${f2(e.inputs.stats.sacksPerGame!.v)} / ${f2(e.inputs.baseline.sacksPerTeamGame)} (${e.inputs.stats.sacksPerGame!.conf})`).join(' | ')} |`,
    `| Honors per season | ${[garrett, jjw, tjw, smith, white, whiteGb].map(hon).join(' | ')} |`,
    '',
    `- **Pre-1982 sacks: not a factor for them.** Both careers start in 1985, after sacks became official (1982); their sack rates are \`estimated\` only because the per-stint totals are ours (\`data/augment/estimated_def_stints_pre1999.json\`, high certainty, season by season in the notes). The unofficial-sack flag matters for Deacon Jones (#${rank(get('defense:deacon-jones:LAR:1960s')!)}, 141 unofficial sacks), and it doesn't hold him back: estimated inputs are not discounted (see 2).`,
    `- **Stint totals from corrections.** White GB 1990s: legacy held 111.5 sacks (his 1990s decade across teams); the correction sets 68.5 (Packers 1993–98). His 1990–92 Eagles seasons (14, 15, 14 sacks, per the correction note) belong to no stint: the legacy list has no PHI 1990s entry, so the rated pool never sees them. Smith's BUF 1990s stint is 10 seasons (1990–99) and includes 1991 (1.5 sacks, injured) and 1999 at 36: ${f2(smith.inputs.stats.sacksPerGame!.v)} a game (share ${f2(sackShare(smith))} of the league team rate against Garrett's ${f2(sackShare(garrett))}), so his sack evidence is worth about half of Garrett's.`,
    `- **Measurables** (see 3): no 40, bench or jumps for either, so Speed and Agility are body priors: White ${attr(white, 'speed')} / ${attr(white, 'agility')} (PHI), ${attr(whiteGb, 'speed')} / ${attr(whiteGb, 'agility')} at 31–37 in Green Bay; Smith ${attr(smith, 'speed')} / ${attr(smith, 'agility')}. Pursuit (30% speed) and Finesse Moves (25% speed and agility) carry it: White GB Pursuit ${attr(whiteGb, 'pursuit')}, Finesse ${attr(whiteGb, 'finesseMoves')}.`,
    `- **Pool calibration** re-centers the curated elite DE pool (median honors 0.47 a season, ≈ 89 on offense) and compresses the top: it adds ${sgn(garrett.ovr.contributions.find((c) => c.label.startsWith('Pool calibration'))?.delta ?? 0)} to Garrett, ${sgn(smith.ovr.contributions.find((c) => c.label.startsWith('Pool calibration'))?.delta ?? 0)} to Smith and ${sgn(white.ovr.contributions.find((c) => c.label.startsWith('Pool calibration'))?.delta ?? 0)} to White. It narrows the gaps; it doesn't cause them.`,
    `- **Honors dilution** is small: the best-three blend keeps Smith's 10-season stint at ${hon(smith)} (Garrett ${hon(garrett)}, J.J. Watt ${hon(jjw)}); honors are Smith's largest OVR input, larger than Garrett's. White's GB stint (ages 31–37, ${hon(whiteGb)}) is the diluted one.`,
    `- **Net.** Smith and White trail Garrett by ${f1(garrett.ovr.value - smith.ovr.value)} and ${f1(garrett.ovr.value - white.ovr.value)}: equal honors and era-adjusted sack evidence (White) or half the sack evidence (Smith's long stint), and measured athleticism against a body prior. The data can't separate them further; a cited 40 time for either would move them.`,
    '',
  );
  return lines;
}
