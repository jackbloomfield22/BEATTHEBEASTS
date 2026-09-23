// "Approved fixes" subsection of docs/RATINGS_REPORT.md (ratings follow-up):
// the four user-approved fixes and their before/after. "Before" is frozen in
// data/ratings/approved-fixes.before.json by tools/ratings/approved-fixes-before.ts.

import { readFileSync } from 'node:fs';
import { SKILL_ATTRS, attrLabel } from '../../src/engine/ratings/attributes/index.ts';
import type { RatingRun } from '../../src/engine/ratings/engine.ts';
import { OVR_WEIGHTS, OVR_WEIGHTS_SET, PHYSICAL_OVR_CAP, physicalExposure, physicalShare } from '../../src/engine/ratings/ovrWeights.ts';
import type { RatedEntry, RatedPos } from '../../src/engine/ratings/types.ts';
import { consensusCheck, loadConsensus } from './consensus.ts';
import { ROOT } from './sources.ts';

interface BeforeEntry {
  name: string;
  pos: string;
  team: string;
  decade: string;
  ovr: number;
  conf: string;
  attrs?: Record<string, number>;
}

/** The formulas as they were before the fixes (for the report's before/after). */
const BEFORE_FORMULAS: Record<string, string> = {
  'QB release': 'q_sack 0.35, q_cmp 0.15, q_yds|q_tdg 0.15, acc 0.15, imp 0.2',
  'QB pocketPresence': 'q_sack 0.35, q_int|q_intg 0.15, acc 0.2, exp 0.1, imp 0.2',
  'QB underPressure': 'q_sack 0.3, q_rate 0.2, q_int|q_intg 0.1, acc 0.25, imp 0.15',
  'TE runBlock': 'w_block 0.4, p_weight 0.25, p_strength 0.15, acc 0.05, imp 0.15',
  'TE passBlock': 'w_block 0.35, p_weight 0.3, p_strength 0.1, exp 0.1, imp 0.15',
  'TE impactBlock': 'p_weight 0.3, p_strength 0.3, w_block 0.25, imp 0.15',
};

const f1 = (x: number) => x.toFixed(1);
const f3 = (x: number) => x.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
const formula = (pos: RatedPos, key: string) =>
  SKILL_ATTRS[pos]
    .find((d) => d.key === key)!
    .terms.map((t) => `${Array.isArray(t.s) ? t.s.join('|') : t.s} ${f3(t.w)}`)
    .join(', ');

export function approvedFixesSection(run: RatingRun): string[] {
  const before = (JSON.parse(readFileSync(ROOT + 'data/ratings/approved-fixes.before.json', 'utf8')) as { entries: Record<string, BeforeEntry> }).entries;
  const lines: string[] = [];
  const out = (...s: string[]) => lines.push(...s);
  const pool = (pos: RatedPos) => run.entries.filter((e) => e.pos === pos);
  const rankNow = (pos: RatedPos, v: (e: RatedEntry) => number) => {
    const s = [...pool(pos)].sort((a, b) => v(b) - v(a) || a.id.localeCompare(b.id));
    return { list: s, rank: new Map(s.map((e, i) => [e.id, i + 1])) };
  };
  const rankBefore = (pos: string, v: (b: BeforeEntry) => number) => {
    const s = Object.entries(before)
      .filter(([, b]) => b.pos === pos)
      .sort((a, b) => v(b[1]) - v(a[1]) || a[0].localeCompare(b[0]));
    return { list: s, rank: new Map(s.map(([id], i) => [id, i + 1])) };
  };
  const who = (b: { name: string; team: string; decade: string }) => `${b.name} (${b.team} ${b.decade})`;

  out(
    '### Approved fixes (ratings follow-up)',
    '',
    `_User-approved after the consensus review. "Before" is \`data/ratings/approved-fixes.before.json\` (the run just before these fixes, frozen by \`tools/ratings/approved-fixes-before.ts\`)._`,
    '',
  );

  // 1. physicals cap
  const wr = OVR_WEIGHTS.WR;
  const te = OVR_WEIGHTS.TE;
  const keys = [...new Set([...Object.keys(OVR_WEIGHTS_SET.WR), ...Object.keys(OVR_WEIGHTS_SET.TE)])];
  out(
    `1. **WR/TE physicals cap.** Raw physical attributes may carry at most ${PHYSICAL_OVR_CAP * 100}% of WR and TE OVR (\`src/engine/ratings/ovrWeights.ts\` PHYSICAL_OVR_CAP). "Physical" means the physical attributes (speed, acceleration, agility, strength, stamina, jumping), counted where they sit in the OVR weights (WR Speed and Acceleration, TE Speed) and inside the skills whose formulas read them (Run After Catch is 50% agility and speed; Spectacular Catch 20% jumping; Release 20% strength and agility; Run Block and the TE blocking skills read strength). That is how the review counted "~25%" for WR (Speed 0.12, Acceleration 0.06 and Run After Catch). Body size (height, weight) is not a physical attribute. Exposure before: WR ${f3(physicalExposure('WR', OVR_WEIGHTS_SET.WR))}, TE ${f3(physicalExposure('TE', OVR_WEIGHTS_SET.TE))} (after the block-grade cap moved weight onto TE strength); now ${f3(physicalExposure('WR', wr))} and ${f3(physicalExposure('TE', te))}. The physical part of every term is scaled by one factor per position and the weight removed goes to the pure skills (no physical input) in proportion; physical attributes themselves are unchanged. At TE most of the 8% is blocking strength, so Speed keeps only ${f3(te.speed!)} of TE OVR (a one-line change if you'd rather exempt blocking strength).`,
    '',
    '   | OVR term | WR physical share | WR set | WR now | TE physical share | TE set | TE now |',
    '   |---|---|---|---|---|---|---|',
    ...keys.map((k) => {
      const c = (w: Readonly<Record<string, number>>) => (w[k] === undefined ? '–' : f3(w[k]!));
      const sh = (p: 'WR' | 'TE') => (OVR_WEIGHTS_SET[p][k] === undefined ? '–' : f3(physicalShare(p, k)));
      return `   | ${attrLabel(OVR_WEIGHTS_SET.WR[k] !== undefined ? 'WR' : 'TE', k)} | ${sh('WR')} | ${c(OVR_WEIGHTS_SET.WR)} | ${c(wr)} | ${sh('TE')} | ${c(OVR_WEIGHTS_SET.TE)} | ${c(te)} |`;
    }),
    '',
  );

  // 2. TE block grade
  out(
    '2. **TE block-grade cap.** The legacy hand-set block grade `b` (`w_block`) now follows the `imp` rule (`src/engine/ratings/attributes/types.ts` CAPPED_SIGNALS): at most 20% of each TE blocking formula, and per player at most a quarter of the same-direction evidence from the uncapped terms (≤ 20% of the attribute\'s movement; `imp` and the block grade can\'t prop each other up). The weight it gave up went to the formula\'s other inputs in proportion; reputation gained nothing. Contributions show "(capped at 20%)" where the per-player cap binds. Tests: `tests/ratings-engine.test.ts` (weights) and `tests/ratings-validation.test.ts` (every TE, every attribute).',
    '',
    ...(['runBlock', 'passBlock', 'impactBlock'] as const).map((k) => `   - ${attrLabel('TE', k)}: ${BEFORE_FORMULAS[`TE ${k}`]} → ${formula('TE', k)}`),
    '',
  );

  // 3. Munoz
  const mz = before['players:anthony-munoz:CIN:1980s'];
  const teBefore = rankBefore('TE', (b) => b.ovr);
  out(
    `3. **Anthony Munoz TE row excluded** (\`data/corrections.json\`, op exclude, source nflverse rosters: CIN 1980–1989 at tackle). ${mz ? `It rated ${f1(mz.ovr)} OVR at TE (#${teBefore.rank.get('players:anthony-munoz:CIN:1980s')} of ${teBefore.list.length}) on a block grade of 88 and a lineman's body.` : ''} He stays in the CIN OL units. ${run.entries.some((e) => e.id === 'players:anthony-munoz:CIN:1980s') ? '**Still rated: check the correction.**' : 'The TE pool is now ' + pool('TE').length + ' stints.'}`,
    '',
  );

  // 4. sack-rate split
  out(
    '4. **Sack-rate split.** Sack rate fed Release (0.35), Pocket Presence (0.35) and Under Pressure (0.3): one stat counted three times (Eli Manning\'s 4.7% vs a 6.3% league was +7.7 of his +16.6 Release). Now it is Pocket Presence\'s stat, keeps a small share of Under Pressure (a sack is the pressured dropback that never became a throw) and is out of Release. No licensed data times the release (Next Gen Stats time-to-throw was rejected: no license), so Release reads the box-score traces of timing throws: completion % vs league (the short-accuracy stat), passing volume vs league team, INT rate (late balls get picked) and honors, with `imp` down to 0.15. Reasons per term are in `src/engine/ratings/attributes/offense.ts`.',
    '',
    ...(['release', 'pocketPresence', 'underPressure'] as const).map((k) => `   - ${attrLabel('QB', k)}: ${BEFORE_FORMULAS[`QB ${k}`]} → ${formula('QB', k)}`),
    '',
  );

  // WR/TE before/after tables
  for (const pos of ['WR', 'TE'] as const) {
    const now = rankNow(pos, (e) => e.ovr.value);
    const was = rankBefore(pos, (b) => b.ovr);
    const named = pos === 'WR' ? ['Jerry Rice'] : ['George Kittle'];
    out(`**${pos} OVR, before → now** (rank of ${was.list.length} → rank of ${now.list.length})`, '');
    out('| # | Before | Now (was) |', '|---|---|---|');
    for (let i = 0; i < 10; i++) {
      const [bid, b] = was.list[i]!;
      const n = now.list[i]!;
      const nb = before[n.id];
      out(`| ${i + 1} | ${who(b)} ${f1(b.ovr)}${now.rank.has(bid) ? '' : ' (excluded)'} | ${who(n)} ${f1(n.ovr.value)} (${nb ? `${f1(nb.ovr)}, #${was.rank.get(n.id)}` : 'new'}) |`);
    }
    out('');
    const rows = now.list.filter((e) => named.includes(e.name));
    out(`${named.join(', ')}: ${rows.map((e) => `${e.team} ${e.decade} ${f1(before[e.id]!.ovr)} (#${was.rank.get(e.id)}) → ${f1(e.ovr.value)} (#${now.rank.get(e.id)})`).join('; ')}.`, '');
  }

  // The block-grade cap's side effect, for review.
  const blk = ['runBlock', 'passBlock', 'impactBlock'] as const;
  const teRows = ['players:george-kittle:SF:2020s', 'players:kellen-winslow:LAC:1980s', 'players:rob-gronkowski:NE:2010s', 'players:tony-gonzalez:KC:2000s']
    .map((id) => run.entries.find((e) => e.id === id))
    .filter((e): e is RatedEntry => !!e && !!before[e.id]?.attrs);
  const grade = (e: RatedEntry) => e.inputs.stats.blockGrade?.v ?? '–';
  out(
    '**Side effect of the block-grade cap, for review.** Most of the TE movement above is the block grade, not speed. Under the `imp` rule the hand-set grade can only amplify the other blocking evidence, which for a TE is body and strength (no stat measures TE blocking). Kittle\'s grade of 92 now can\'t lift him against a measured 18-rep bench (Strength 64), and Winslow\'s grade of 70 (the only input that says he was a weak blocker) can\'t pull him down against a 251 lb frame that translates to about 271 today. That is most of Kittle\'s drop and Winslow\'s rise to TE #1. The rule is applied as approved; if you want the grade to keep its direction, the alternative is the 20% weight cap without the per-player cap (the grade would then move blocking by at most its 20% share either way).',
    '',
    `| TE stint | Block grade | ${blk.map((k) => attrLabel('TE', k)).join(' | ')} | OVR |`,
    '|---|---|---|---|---|---|',
    ...teRows.map((e) => `| ${who(e)} | ${grade(e)} | ${blk.map((k) => `${f1(before[e.id]!.attrs![k]!)} → ${f1(e.attrs[k]!.value)}`).join(' | ')} | ${f1(before[e.id]!.ovr)} → ${f1(e.ovr.value)} |`),
    '',
  );

  // Eli and the Release top 10
  const qbNow = rankNow('QB', (e) => e.attrs.release!.value);
  const qbWas = rankBefore('QB', (b) => b.attrs!.release!);
  out('**QB Release, before → now** (rank of ' + qbNow.list.length + ')', '');
  out('| Stint | Release | Pocket Presence | Under Pressure |', '|---|---|---|---|');
  const eli = qbNow.list.filter((e) => e.name === 'Eli Manning').sort((a, b) => a.decade.localeCompare(b.decade));
  const cell = (e: RatedEntry, k: string) => `${f1(before[e.id]!.attrs![k]!)} → ${f1(e.attrs[k]!.value)}`;
  for (const e of eli) out(`| ${who(e)} | ${f1(before[e.id]!.attrs!.release!)} (#${qbWas.rank.get(e.id)}) → ${f1(e.attrs.release!.value)} (#${qbNow.rank.get(e.id)}) | ${cell(e, 'pocketPresence')} | ${cell(e, 'underPressure')} |`);
  out('');
  for (const e of eli) {
    const cs = e.attrs.release!.contributions.filter((c) => c.kind !== 'base').map((c) => `${c.label}${c.input ? ` [${c.input}]` : ''} ${c.delta >= 0 ? '+' : ''}${f1(c.delta)}`);
    out(`- Eli ${e.decade} Release now: 72 ${cs.join(', ')}.`);
  }
  out('', '| # | Before | Now (was) |', '|---|---|---|');
  for (let i = 0; i < 10; i++) {
    const [, b] = qbWas.list[i]!;
    const n = qbNow.list[i]!;
    out(`| ${i + 1} | ${who(b)} ${f1(b.attrs!.release!)} | ${who(n)} ${f1(n.attrs.release!.value)} (${f1(before[n.id]!.attrs!.release!)}, #${qbWas.rank.get(n.id)}) |`);
  }
  out('');

  // Consensus check, before → now (before: the report at the frozen commit).
  const c = consensusCheck(run, loadConsensus());
  const riceA = c.anchors.find((a) => a.id === 'players:jerry-rice:SF:1980s');
  out(
    `**Consensus check after the fixes** (the stats stay primary; see "Consensus check"): ${c.top.filter((t) => t.inSet).length} of ${c.top.length} top-3 players are in the consensus set (was 14), ${c.disagreements.length} disagreements (was 23). ${riceA ? `The Rice anchor (99) now ${riceA.agrees ? 'agrees' : 'still disagrees'}: ${f1(riceA.stats)}, rank ${riceA.rank} (was 94.5, rank 15).` : ''} WR and TE top 3 now: ${c.top
      .filter((t) => ['WR', 'TE'].includes(t.group))
      .map((t) => `${t.group} #${t.rank} ${who(t.entry)}${t.inSet ? '' : ' (not in the set)'}`)
      .join(', ')}.`,
    '',
  );
  return lines;
}
