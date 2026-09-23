// "Throw Power" subsection of docs/RATINGS_REPORT.md (ratings follow-up):
// the arm inputs, the anchors and the QB top/bottom 20 before and after, and
// the arm trait counts. "Before" is the M2 formula, frozen in
// data/ratings/throw-power.m2.json by tools/ratings/throw-power-m2.ts.

import { readFileSync } from 'node:fs';
import { SKILL_ATTRS } from '../../src/engine/ratings/attributes/index.ts';
import type { RatingRun } from '../../src/engine/ratings/engine.ts';
import { ARM_EVIDENCE_WEIGHT, ARM_GRADE_Z } from '../../src/engine/ratings/signals.ts';
import { TRAIT_LABELS } from '../../src/engine/ratings/traits/index.ts';
import type { RatedEntry } from '../../src/engine/ratings/types.ts';
import { ROOT } from './sources.ts';

interface M2File {
  traitCounts: Record<string, number>;
  entries: Record<string, { throwPower: number; ovr: number; traits: string[] }>;
}

/** Anchor QBs the user named: expected high, then expected low. */
const HIGH = ['Dan Marino', 'John Elway', 'Brett Favre', 'Patrick Mahomes', 'Josh Allen', 'Terry Bradshaw', 'Michael Vick', 'Jim Kelly', 'Warren Moon', 'Randall Cunningham'];
const LOW = ['Chad Pennington', 'Alex Smith', 'Sam Bradford', 'Kirk Cousins', 'Joe Montana', 'Drew Brees'];
const ARM_TRAITS = ['cannon', 'bomb-squad', 'laser', 'gunslinger', 'riverboat-gambler', 'noodle-arm'];

export function throwPowerSection(run: RatingRun): string[] {
  const m2 = JSON.parse(readFileSync(ROOT + 'data/ratings/throw-power.m2.json', 'utf8')) as M2File;
  const qbs = run.entries.filter((e) => e.pos === 'QB');
  const tp = (e: RatedEntry) => e.attrs.throwPower!.value;
  const sorted = [...qbs].sort((a, b) => tp(b) - tp(a) || a.id.localeCompare(b.id));
  const rankNow = new Map(sorted.map((e, i) => [e.id, i + 1]));
  const m2Vals = Object.values(m2.entries).map((x) => x.throwPower);
  const rankM2 = (v: number) => 1 + m2Vals.filter((x) => x > v).length;
  const before = (e: RatedEntry) => {
    const b = m2.entries[e.id];
    return b ? `${b.throwPower} (#${rankM2(b.throwPower)})` : '–';
  };
  const arm = (e: RatedEntry) => {
    const a = e.inputs.arm;
    const air = a?.air ? `${a.air.ratio.toFixed(2)}${a.air.covered.length < a.air.stintSeasons ? '*' : ''}` : '–';
    const grade = a?.grade ? `${a.grade.grade} (${a.grade.evidence})` : '–';
    return `${air} | ${grade}`;
  };
  const row = (e: RatedEntry) => `| ${e.name} (${e.team} ${e.decade}) | ${before(e)} | ${tp(e).toFixed(1)} (#${rankNow.get(e.id)}) | ${arm(e)} |`;
  const def = SKILL_ATTRS.QB.find((d) => d.key === 'throwPower')!;
  const withAir = qbs.filter((e) => e.inputs.arm?.air).length;
  const partial = qbs.filter((e) => e.inputs.arm?.air && e.inputs.arm.air.covered.length < e.inputs.arm.air.stintSeasons).length;
  const graded = qbs.filter((e) => e.inputs.arm?.grade).length;
  const out: string[] = [];
  out.push(
    '### Throw Power (ratings follow-up)',
    '',
    '_User-approved: "add air yards per attempt from 2006 on and a sourced big-arm list for earlier QBs, flagged estimated." Data: `data/augment/arm_strength.json` (see AUGMENT_REPORT "Arm strength")._',
    '',
    `- **Formula.** M2: yards per completion vs league (deep share) 0.5, yards per attempt 0.15, passing volume 0.15, \`imp\` 0.2. Now: ${def.terms.map((t) => `${Array.isArray(t.s) ? t.s.join('|') : t.s} ${t.w}`).join(', ')}.`,
    `- **Air yards** (\`q_air\`, verified): log of intended air yards per attempt ÷ the attempt-weighted league figure over the stint's 2006+ seasons, standardized in the QB pool and shrunk by attempts (games = attempts / 30, k = 12, like the deep-share signal). It measures where a QB throws, not how hard (graded cannons average a ratio of 1.04, weak arms 0.88), so it is one input of five. A stint that also spans pre-2006 seasons keeps it only when the 2006+ seasons are at least 40% of the stint (the engine's slice rule). ${withAir} QB stints use it (${partial} partial, marked *).`,
    `- **Arm grade** (\`q_arm\`, estimated, any era): our grade of cited descriptions mapped to a z-like value (not re-standardized: the graded QBs are a selected group) and scaled by the strength of the evidence. ${graded} QB stints are graded.`,
    `  Grade → z: ${Object.entries(ARM_GRADE_Z).map(([g, z]) => `${g} ${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}`).join(', ')}. Evidence weight: ${Object.entries(ARM_EVIDENCE_WEIGHT).map(([k, w]) => `${k} ${w}`).join(', ')} (so a cannon known only from draft reports counts +1.0). Mapping and reasons: \`src/engine/ratings/signals.ts\` ARM_GRADE_Z, ARM_EVIDENCE_WEIGHT.`,
    '- **Missing evidence** works as everywhere else: a QB with no air yards (before 2006) or no grade gets 0 for that term, and part of its weight moves to his other evidence (deep share, Y/A, volume); reputation is never scaled up. Contributions are labeled in the explorer ("Intended air yards/att vs league (2006+)", verified; "Arm grade (cited descriptions, estimated)", a new `scouting` kind at estimated confidence).',
    '- **Deep Accuracy is unchanged.** Air yards say how far downfield a QB throws, not whether the ball lands; feeding them into an accuracy rating would reward throwing deep, not throwing deep well.',
    '',
    'Named anchors, M2 value (rank of 634) → now. Air = intended air yards ratio vs league (* partial stint).',
    '',
    '| QB stint | M2 | Now | Air | Grade |',
    '|---|---|---|---|---|',
  );
  const named = (names: string[]) => names.flatMap((n) => qbs.filter((e) => e.name === n).sort((a, b) => tp(b) - tp(a)));
  out.push('| **Expected high** | | | | |', ...named(HIGH).map(row), '| **Expected low** | | | | |', ...named(LOW).map(row));
  out.push('', '<details><summary>QB Throw Power top 20 and bottom 20 (now)</summary>', '', '| QB stint | M2 | Now | Air | Grade |', '|---|---|---|---|---|');
  out.push(...sorted.slice(0, 20).map(row), '| … | | | | |', ...sorted.slice(-20).map(row), '', '</details>', '');
  const nowCounts: Record<string, number> = {};
  for (const e of qbs) for (const t of e.traits) nowCounts[t.id] = (nowCounts[t.id] ?? 0) + 1;
  out.push(
    'Arm traits shown on QBs (after combinations and the four-trait cap), M2 → now: ' + ARM_TRAITS.map((id) => `${TRAIT_LABELS[id] ?? id} ${m2.traitCounts[id] ?? 0} → ${nowCounts[id] ?? 0}`).join(', ') + '. Every kept trait still has at least five holders and none always appears alongside another (tests/ratings-traits.test.ts), so no trait was cut.',
    '',
    'Known limit: air yards reward all-or-nothing deep passers whatever their arm (Tim Tebow and Drew Stanton rank near the top on them). The grade can only correct that where a cited description exists.',
    '',
  );
  return out;
}
