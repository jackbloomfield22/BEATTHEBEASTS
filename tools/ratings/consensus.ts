// Consensus check (ratings follow-up, user-approved): a sanity check on top
// of the statistical ratings. data/consensus.json lists, per position, the
// players a knowledgeable fan would accept in an all-time top 3 (NFL 100th
// Anniversary All-Time Team, plus a short sourced "modern" tier) and two
// consensus OVR anchors (Jerry Rice 99, Lawrence Taylor 99).
//
// The statistical basis is primary and wins every conflict. This module only
// reads a finished rating run; it never changes a rating, and the engine
// (src/engine/ratings) never reads the consensus file. Every disagreement is
// kept and flagged in docs/RATINGS_REPORT.md ("Consensus check"); a
// disagreement is a finding for review, never a failure.

import { readFileSync } from 'node:fs';
import type { RatingRun } from '../../src/engine/ratings/engine.ts';
import type { RatedEntry } from '../../src/engine/ratings/types.ts';
import { ROOT } from './sources.ts';

export interface ConsensusPlayer {
  name: string;
  sources: string[];
  tier?: 'modern';
  basis?: string;
}

export interface ConsensusFile {
  _meta: Record<string, unknown>;
  sources: Record<string, { title: string; url: string; permalink?: string; retrieved?: string; note?: string }>;
  anchors: { id: string; name: string; ovr: number; sources: string[]; basis: string }[];
  positions: Record<string, { label: string; players: ConsensusPlayer[] }>;
}

export function loadConsensus(): ConsensusFile {
  return JSON.parse(readFileSync(ROOT + 'data/consensus.json', 'utf8')) as ConsensusFile;
}

/** Report groups: pool positions, with the OL pool split by slot like the All-Time Team (OT / OG / C). */
export const CONSENSUS_GROUPS = ['QB', 'RB', 'WR', 'TE', 'OL-T', 'OL-G', 'OL-C', 'DE', 'DT', 'LB', 'CB', 'S'] as const;
export type ConsensusGroup = (typeof CONSENSUS_GROUPS)[number];

/** How many distinct players per group are checked. */
export const CONSENSUS_TOP_N = 3;

/**
 * An anchor of 99 agrees with the stats on the report's usual rule for 99
 * bands (RATINGS_REPORT "How ratings are built": 99 is kept for true
 * outliers, so a 99 band passes at ≥ 98.5 or at rank 1–3 in the position).
 */
export const ANCHOR_99_MIN = 98.5;
export const ANCHOR_99_RANK = 3;

const OL_GROUP = { LT: 'OL-T', RT: 'OL-T', LG: 'OL-G', RG: 'OL-G', C: 'OL-C' } as const;

export function groupOf(e: RatedEntry): ConsensusGroup {
  return e.pos === 'OL' ? OL_GROUP[e.inputs.olUnit!.slot] : e.pos;
}

/** Name key: accents, punctuation, quotes and spaces folded ("Anthony Muñoz" = "Anthony Munoz", "O. J." = "O.J."). */
export const nameKey = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/gi, '')
    .toLowerCase();

export interface TopRow {
  group: ConsensusGroup;
  rank: number;
  entry: RatedEntry;
  /** In the group's consensus set (or, for OL, listed at another OL spot). */
  inSet: boolean;
  match?: ConsensusPlayer;
  /** OL only: the All-Time Team spot he was listed at when it isn't this slot. */
  listedAt?: string;
}

export interface AnchorRow {
  id: string;
  name: string;
  consensus: number;
  stats: number;
  rank: number;
  poolSize: number;
  gap: number;
  agrees: boolean;
  basis: string;
  sources: string[];
}

export interface Disagreement {
  kind: 'top3' | 'anchor';
  /** One line for the report; the test checks each appears there. */
  text: string;
}

export interface ConsensusResult {
  top: TopRow[];
  anchors: AnchorRow[];
  disagreements: Disagreement[];
}

const who = (e: RatedEntry) => `${e.name} (${e.team} ${e.decade})`;
const f1 = (x: number) => x.toFixed(1);

/** Pure: reads the run, returns the comparison. Never writes to `run`. */
export function consensusCheck(run: RatingRun, file: ConsensusFile): ConsensusResult {
  const byGroup = new Map<ConsensusGroup, RatedEntry[]>();
  for (const e of run.entries) {
    const g = groupOf(e);
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(e);
  }
  const setOf = (g: string) => new Map((file.positions[g]?.players ?? []).map((p) => [nameKey(p.name), p]));
  const top: TopRow[] = [];
  const disagreements: Disagreement[] = [];
  for (const g of CONSENSUS_GROUPS) {
    const list = [...(byGroup.get(g) ?? [])].sort((a, b) => b.ovr.value - a.ovr.value || a.id.localeCompare(b.id));
    // Distinct players: a player's best stint stands for him.
    const seen = new Set<string>();
    const picks: RatedEntry[] = [];
    for (const e of list) {
      // Same person = same personId (stints of one player share it).
      if (seen.has(e.personId)) continue;
      seen.add(e.personId);
      picks.push(e);
      if (picks.length === CONSENSUS_TOP_N) break;
    }
    const own = setOf(g);
    picks.forEach((e, i) => {
      const k = nameKey(e.name);
      let match = own.get(k);
      let listedAt: string | undefined;
      if (!match && g.startsWith('OL-')) {
        for (const other of CONSENSUS_GROUPS.filter((x) => x.startsWith('OL-') && x !== g)) {
          const m = setOf(other).get(k);
          if (m) {
            match = m;
            listedAt = other;
            break;
          }
        }
      }
      const row: TopRow = { group: g, rank: i + 1, entry: e, inSet: !!match, match, listedAt };
      top.push(row);
      if (!match) disagreements.push({ kind: 'top3', text: `${g} #${i + 1}: ${who(e)}, OVR ${f1(e.ovr.value)}, is not in the consensus set for ${g}` });
    });
  }

  const anchors: AnchorRow[] = file.anchors.map((a) => {
    const e = run.entries.find((x) => x.id === a.id);
    if (!e) {
      disagreements.push({ kind: 'anchor', text: `Anchor ${a.name}: entry ${a.id} is not in the rated pool` });
      return { id: a.id, name: a.name, consensus: a.ovr, stats: NaN, rank: NaN, poolSize: 0, gap: NaN, agrees: false, basis: a.basis, sources: a.sources };
    }
    const pool = run.entries.filter((x) => x.pos === e.pos).sort((x, y) => y.ovr.value - x.ovr.value);
    const rank = pool.findIndex((x) => x.id === e.id) + 1;
    const gap = e.ovr.value - a.ovr;
    const agrees = a.ovr >= 99 ? e.ovr.value >= ANCHOR_99_MIN || rank <= ANCHOR_99_RANK : e.ovr.value >= a.ovr - 0.5;
    if (!agrees) disagreements.push({ kind: 'anchor', text: `Anchor ${a.name}: stats OVR ${f1(e.ovr.value)} (rank ${rank} of ${pool.length} ${e.pos}) vs consensus ${a.ovr}, gap ${gap >= 0 ? '+' : ''}${f1(gap)}` });
    return { id: a.id, name: a.name, consensus: a.ovr, stats: e.ovr.value, rank, poolSize: pool.length, gap, agrees, basis: a.basis, sources: a.sources };
  });
  return { top, anchors, disagreements };
}

const esc = (s: string) => s.replace(/\|/g, '\\|');

/** The "Consensus check" section of docs/RATINGS_REPORT.md. */
export function consensusSection(r: ConsensusResult, file: ConsensusFile): string[] {
  const src = (ids: readonly string[]) => ids.map((id) => (file.sources[id] ? `[${id}](${file.sources[id]!.permalink ?? file.sources[id]!.url})` : id)).join(', ');
  const out: string[] = [];
  const nTop = r.top.length;
  const nIn = r.top.filter((t) => t.inSet).length;
  out.push(
    '## Consensus check',
    '',
    '_Generated by `tools/ratings/consensus.ts` from `data/consensus.json`._',
    '',
    'A sanity check on top of the statistical system. **The statistical ratings are primary and win every conflict: this check never changes a rating** (the engine never reads the consensus file; `tests/ratings-consensus.test.ts` proves the ratings are identical with and without it). When the two disagree, the stats result is kept and the disagreement is listed below for review.',
    '',
    `- **Consensus set** per position: the NFL 100th Anniversary All-Time Team (2019) at that position, plus a short \`modern\` tier for careers that matured after the vote, each with a countable record only All-Time Team members otherwise share (Mahomes: three Super Bowl MVPs; J. J. Watt and Aaron Donald: three Defensive Player of the Year awards). Sources and the matching rule are in \`data/consensus.json\`.`,
    `- **Top ${CONSENSUS_TOP_N}** are distinct players by their best stint's OVR. The OL pool is split by slot (tackles, guards, center) like the All-Time Team; a lineman the team lists at another OL spot counts, and the table says where he was listed.`,
    `- **Anchors** of 99 agree on the report's usual 99 rule (OVR ≥ ${ANCHOR_99_MIN} or rank 1–${ANCHOR_99_RANK} in the position pool).`,
    '',
    `**${nIn} of ${nTop} top-${CONSENSUS_TOP_N} players are in the consensus set; ${r.disagreements.length} disagreement${r.disagreements.length === 1 ? '' : 's'} flagged (stats kept).**`,
    '',
    '### OVR anchors',
    '',
    '| Anchor | Stats OVR | Rank in position | Consensus OVR | Gap | Result | Basis |',
    '|---|---|---|---|---|---|---|',
  );
  for (const a of r.anchors) {
    out.push(`| ${a.name} | ${Number.isFinite(a.stats) ? f1(a.stats) : 'not rated'} | ${Number.isFinite(a.rank) ? `${a.rank} of ${a.poolSize}` : '–'} | ${a.consensus} | ${Number.isFinite(a.gap) ? `${a.gap >= 0 ? '+' : ''}${f1(a.gap)}` : '–'} | ${a.agrees ? 'agrees' : '**FLAG** (stats kept)'} | ${esc(a.basis)} (${src(a.sources)}) |`);
  }
  out.push('', `### Top ${CONSENSUS_TOP_N} by OVR per position`, '', '| Pos | # | Player | OVR | In consensus set | Source |', '|---|---|---|---|---|---|');
  for (const t of r.top) {
    const inSet = t.inSet ? (t.listedAt ? `yes (listed at ${t.listedAt.slice(3)})` : t.match?.tier === 'modern' ? 'yes (modern tier)' : 'yes') : '**no: FLAG** (stats kept)';
    const why = t.match ? `${src(t.match.sources)}${t.match.basis ? `: ${esc(t.match.basis)}` : ''}` : '–';
    out.push(`| ${t.group} | ${t.rank} | ${who(t.entry)} | ${f1(t.entry.ovr.value)} | ${inSet} | ${why} |`);
  }
  out.push('', `### Disagreements (${r.disagreements.length})`, '');
  if (!r.disagreements.length) out.push('None.');
  for (const d of r.disagreements) out.push(`- ${d.text}.`);
  out.push('');
  return out;
}
