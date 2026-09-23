// The Traits section of docs/RATINGS_REPORT.md and the whole of
// docs/TRAITS.md, generated from the trait catalog so they can't drift from
// the code (called by report.ts).

import type { RatingRun } from '../../src/engine/ratings/engine.ts';
import {
  COMBOS,
  CUT_TRAITS,
  heldTraitIds,
  MAX_NEGATIVE,
  MAX_TRAITS,
  metricLabel,
  REDEFINED_COMBOS,
  SYNERGIES,
  TRAIT_DEFS,
  traitInfo,
  UNIT_TRAITS,
  type Cond,
  type TraitDef,
} from '../../src/engine/ratings/traits/index.ts';
import { TRAIT_GROUPS } from '../../src/engine/ratings/traits/groups.ts';
import type { RatedEntry, RatedPos } from '../../src/engine/ratings/types.ts';
import { byPosition, TRAIT_COOCCUR_MAX, TRAIT_MIN_HOLDERS, TRAIT_ZERO_SHARE_MIN, traitStats, traitTotals } from './validate.ts';

const POS: RatedPos[] = ['QB', 'RB', 'WR', 'TE', 'DE', 'DT', 'LB', 'CB', 'S'];
const esc = (s: string) => s.replace(/\|/g, '\\|');
const label = (id: string) => traitInfo(id)?.label ?? id;
const gateText = (pos: RatedPos, c: Cond) => `${metricLabel(pos, c.m)} ${c.side} ${c.gate}%`;
const gates = (pos: RatedPos, d: Pick<TraitDef, 'conds'>) => d.conds.map((c) => gateText(pos, c)).join('; ');
const who = (e: RatedEntry) => `${e.name} (${e.team} ${e.decade.slice(2)})`;

const RULES = [
  `- **Gates** are percentiles inside the position pool (all decades together; every input is already era-relative): elite traits at the top 10% of the position, standard traits at the top 25%, negative traits in the bottom 10–15%. Secondary conditions may be looser (written out per trait). Pools under 20 players with data can't gate.`,
  `- **Three kinds of signal**, so traits don't all say the same thing: *physical* (measurables and body, era-translated), *technical* (attribute thresholds) and *production* (stat signatures the attributes don't capture on their own: share of the team's catches, yards per catch, TDs per touch, attempts vs the league).`,
  `- **Up to ${MAX_TRAITS} per player, at most ${MAX_NEGATIVE} negatives.** A combination replaces its two parts and counts as one. The best trait of each facet (for a QB: arm, pocket and legs, mind, style) is shown first, then the rest by rank. Rank = how far past its gates + an elite bonus + a combination bonus + how rare the trait is among the player's peers (similar OVR at his position), so a star shows what sets him apart from the other stars.`,
  `- **Within the stint, never the career arc:** no gate reads age, experience or a count of seasons (tested).`,
  `- **The cut rules** (tested): every kept trait is held by at least ${TRAIT_MIN_HOLDERS} players; no trait's holders hold another trait ${TRAIT_COOCCUR_MAX * 100}% of the time or more (combination parts excepted); at least ${TRAIT_ZERO_SHARE_MIN * 100}% of every position has no trait.`,
  `- **Why lines** quote the player's own numbers and where they rank ("Speed 97 (top 2% of WRs)"). Film Room hides them with the other numbers.`,
];

function examples(list: RatedEntry[], id: string, n = 3): string {
  return list
    .filter((e) => heldTraitIds(e.traits).includes(id))
    .sort((a, b) => b.ovr.value - a.ovr.value)
    .slice(0, n)
    .map(who)
    .join(', ');
}

/** Lines for the Traits section of the ratings report. */
export function traitsSection(run: RatingRun): string[] {
  const lines: string[] = [];
  const out = (...s: string[]) => lines.push(...s);
  const pools = byPosition(run);
  const totals = new Map(traitTotals(run).map((t) => [t.id, t]));
  const stats = new Map(traitStats(run).map((s) => [s.pos, s]));

  out('## Traits', '', 'Catalog, gameplay effects and icons: `docs/TRAITS.md`. Engine: `src/engine/ratings/traits/`.', '', ...RULES, '');
  out('### Players with 0–4 traits', '', '| Pos | Players | No trait | 1 | 2 | 3 | 4 |', '|---|---|---|---|---|---|---|');
  for (const p of POS) {
    const s = stats.get(p);
    if (s) out(`| ${p} | ${s.n} | **${(s.zeroShare * 100).toFixed(0)}%** | ${s.byCount.slice(1).join(' | ')} |`);
  }
  out('');

  out('### Count by position', '', 'Earned: passes the gates. Held: keeps it after combinations and the four-trait cap (a combination counts for its parts). Shown: its own badge. Partner: the trait its holders most often also hold (combination parts excepted).', '');
  for (const p of POS) {
    const list = pools.get(p) ?? [];
    const rows = [...TRAIT_DEFS.filter((d) => d.pos.includes(p)).map((d) => d.id), ...COMBOS.filter((c) => c.pos.includes(p)).map((c) => c.id)];
    const row = new Map(stats.get(p)?.rows.map((r) => [r.id, r]));
    out(`<details><summary>${p} (${rows.length} traits)</summary>`, '', '| Trait | Kind | Tier | Earned | Held | Shown | Partner (share) | Top holders |', '|---|---|---|---|---|---|---|---|');
    for (const id of rows) {
      const r = row.get(id);
      const t = totals.get(id);
      const info = traitInfo(id)!;
      out(`| ${info.polarity === 'negative' ? '−' : ''}${esc(info.label)}${info.parts ? ` (${info.parts.map(label).join(' + ')})` : ''} | ${info.kind} | ${info.tier} | ${r?.earned ?? 0} | ${r?.held ?? 0} | ${r?.shown ?? 0} | ${t?.partner ? `${label(t.partner)} (${(t.partnerShare * 100).toFixed(0)}%)` : '–'} | ${esc(examples(list, id))} |`);
    }
    out('', '</details>', '');
  }

  out('### Cut', '');
  for (const c of CUT_TRAITS) out(`- **${c.label}** (${c.pos.join(', ')}): ${c.reason}`);
  out('', 'Combinations redefined while tuning:', '');
  for (const r of REDEFINED_COMBOS) out(`- **${label(r.id)}**: was ${r.was}, now ${r.now}. ${r.reason}`);
  out('');

  out('### Combinations', '', '| Combination | Parts | Positions | Holders | Top holders |', '|---|---|---|---|---|');
  for (const c of COMBOS) {
    const list = c.pos.flatMap((p) => pools.get(p) ?? []);
    out(`| ${c.label} | ${c.parts.map(label).join(' + ')} | ${c.pos.join(', ')} | ${totals.get(c.id)?.held ?? 0} | ${esc(examples(list, c.id))} |`);
  }
  out('');

  out('### OL unit traits', '', 'Read from the unit aggregate (mean of its five linemen) over the 184 units.', '', '| Unit trait | Gates | Units | Examples |', '|---|---|---|---|');
  const units = Object.values(run.olUnits);
  for (const d of UNIT_TRAITS) {
    const hs = units.filter((u) => u.traits.some((t) => t.id === d.id));
    out(`| ${d.polarity === 'negative' ? '−' : ''}${d.label} | ${esc(gates('OL', d))} | ${hs.length} | ${hs.slice(0, 3).map((u) => u.unitId.split(':').slice(-2).join(' ')).join(', ')} |`);
  }
  out(`| (none) | | ${units.filter((u) => !u.traits.length).length} | |`, '');

  out('### Synergies', '', 'Pairs whose traits fit together (QB with receiver or back, QB or back with the O-line unit). The effect is small, bounded and applies to the pair only; the sim reads it from M5, the matchup preview and pre-game show it from M7, and the Explorer\'s compare mode shows it now. "Possible pairs" counts players (or units) holding each side.', '');
  out('| Synergy | Side A | Side B | Effect | Possible pairs |', '|---|---|---|---|---|');
  for (const s of SYNERGIES) {
    const holds = (e: RatedEntry, ts: readonly string[]) => ts.some((t) => heldTraitIds(e.traits).includes(t));
    const a = run.entries.filter((e) => s.a.pos.includes(e.pos) && holds(e, s.a.traits)).length;
    const b = 'unit' in s.b ? units.filter((u) => u.traits.some((t) => s.b.traits.includes(t.id))).length : run.entries.filter((e) => (s.b as { pos: readonly RatedPos[] }).pos.includes(e.pos) && holds(e, s.b.traits)).length;
    const side = (r: { pos?: readonly RatedPos[]; traits: readonly string[]; unit?: true }) => `${'unit' in r && r.unit ? 'OL unit' : r.pos!.join('/')}: ${r.traits.map(label).join(', ')}`;
    out(`| ${s.polarity === 'negative' ? '−' : ''}${s.label} | ${esc(side(s.a))} | ${esc(side(s.b as never))} | ${esc(s.effect.text)} (\`${s.effect.key}\` ${s.effect.value > 0 ? '+' : ''}${s.effect.value} ${s.effect.unit}) | ${a} × ${b} |`);
  }
  out('');
  return lines;
}

/** docs/TRAITS.md: every trait with its gates, icon and gameplay effect. */
export function traitsDoc(): string {
  const lines: string[] = [];
  const out = (...s: string[]) => lines.push(...s);
  out(
    '# Traits',
    '',
    '_Generated from `src/engine/ratings/traits/` by `node tools/run-ts.mjs tools/ratings/report.ts` (part of `npm run ratings`). Do not edit by hand. Counts per position, top holders and the co-occurrence checks are in `docs/RATINGS_REPORT.md` ("Traits")._',
    '',
    'A trait is a specific, documented way a player plays within his stint. Every trait has a gameplay effect (implemented in `sim/attributeEffects.ts` from M5, magnitudes tuned with the balance harness), an icon (`src/ui/scouting/traitIcons.tsx`, drawn in-house) and a one-line "why he earned it" with his own numbers, shown in the Scouting panel and the Ratings Explorer.',
    '',
    '## Rules',
    '',
    ...RULES,
    '',
    'Badge colors: lime = elite, gold = standard, cyan = combination, red = negative.',
    '',
  );
  for (const p of POS) {
    const groups = TRAIT_GROUPS[p] ?? {};
    out(`## ${p}`, '');
    for (const [g, ids] of Object.entries(groups)) {
      const defs = ids.map((id) => TRAIT_DEFS.find((d) => d.id === id && d.pos.includes(p))).filter((d): d is TraitDef => !!d);
      if (!defs.length) continue;
      out(`**${g}**`, '', '| Trait | Icon | Kind | Tier | Gates | Gameplay effect |', '|---|---|---|---|---|---|');
      for (const d of defs) out(`| ${d.polarity === 'negative' ? '−' : ''}${d.label} | \`${d.icon}\` | ${d.kind} | ${d.polarity === 'negative' ? 'negative' : d.tier} | ${esc(gates(p, d))} | ${esc(d.effect)}${d.note ? ` _${esc(d.note)}_` : ''} |`);
      out('');
    }
  }
  out('## Combinations', '', 'When a player earns both parts, the combination shows as one badge instead of the pair.', '', '| Combination | Icon | Parts | Positions | Gameplay effect |', '|---|---|---|---|---|');
  for (const c of COMBOS) out(`| ${c.label} | \`${c.icon}\` | ${c.parts.map(label).join(' + ')} | ${c.pos.join(', ')} | ${esc(c.effect)} |`);
  out('', '## OL unit traits', '', 'OL units are rated as five linemen; unit traits read the unit\'s mean (pass block = Pass Block Power, Pass Block Finesse and Anchor; run block = Run Block Power and Finesse) or the unit\'s own results, as percentiles of the 184 units.', '', '| Unit trait | Icon | Gates | Gameplay effect |', '|---|---|---|---|');
  for (const d of UNIT_TRAITS) out(`| ${d.polarity === 'negative' ? '−' : ''}${d.label} | \`${d.icon}\` | ${esc(gates('OL', d))} | ${esc(d.effect)} |`);
  out('', '## Roster synergies', '', 'Detected over a drafted roster by `detectSynergies` (pure). The effect is data: the sim adds `value` (in `unit`) to `key` for that pair only. Limits per synergy: 5%, 0.15 s, 0.5 yd.', '', '| Synergy | Icon | Side A | Side B | Effect | Sim key |', '|---|---|---|---|---|---|');
  for (const s of SYNERGIES) {
    const side = (r: { pos?: readonly RatedPos[]; traits: readonly string[]; unit?: true }) => `${'unit' in r && r.unit ? 'OL unit' : r.pos!.join('/')}: ${r.traits.map(label).join(', ')}`;
    out(`| ${s.polarity === 'negative' ? '−' : ''}${s.label} | \`${s.icon}\` | ${esc(side(s.a))} | ${esc(side(s.b as never))} | ${esc(s.effect.text)} | \`${s.effect.key}\` ${s.effect.value > 0 ? '+' : ''}${s.effect.value} ${s.effect.unit} |`);
  }
  out('', '## Cut', '');
  for (const c of CUT_TRAITS) out(`- **${c.label}** (${c.pos.join(', ')}): ${c.reason}`);
  out('', 'Combinations redefined while tuning:', '');
  for (const r of REDEFINED_COMBOS) out(`- **${label(r.id)}**: was ${r.was}, now ${r.now}. ${r.reason}`);
  return lines.join('\n') + '\n';
}
