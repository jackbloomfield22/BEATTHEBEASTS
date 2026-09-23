// Consensus check (ratings follow-up): a sanity check on top of the
// statistical ratings. The stats stay primary: these tests prove the check
// never changes a rating, that its report section is current, and that every
// disagreement is flagged. They never fail merely because stats and consensus
// disagree; disagreements are findings for review.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rateAll } from '@/engine/ratings/engine';
import { buildInputs } from '@/engine/ratings/inputs';
import { snapshot } from '@/engine/ratings/snapshot';
import { CONSENSUS_GROUPS, consensusCheck, consensusSection, loadConsensus, type ConsensusFile } from '../tools/ratings/consensus';
import { loadSources, ROOT } from '../tools/ratings/sources';

const inputs = buildInputs(loadSources()).inputs;
const run = rateAll(inputs);
const file = loadConsensus();
const result = consensusCheck(run, file);
const report = readFileSync(ROOT + 'docs/RATINGS_REPORT.md', 'utf8');

describe('consensus data', () => {
  it('lists every report group, and every player and anchor cites known sources with a URL', () => {
    for (const g of CONSENSUS_GROUPS) expect(file.positions[g]?.players.length, g).toBeGreaterThan(0);
    for (const [g, p] of Object.entries(file.positions)) {
      for (const pl of p.players) {
        expect(pl.sources.length, `${g} ${pl.name}`).toBeGreaterThan(0);
        for (const s of pl.sources) expect(file.sources[s]?.url, `${g} ${pl.name}: ${s}`).toMatch(/^https?:\/\//);
        if (pl.tier === 'modern') expect(pl.basis?.length ?? 0, pl.name).toBeGreaterThan(20);
      }
    }
    for (const a of file.anchors) for (const s of a.sources) expect(file.sources[s]?.url, `${a.name}: ${s}`).toMatch(/^https?:\/\//);
  });

  it('has the Rice and Lawrence Taylor anchors at 99, on their peak stints', () => {
    const byId = new Map(file.anchors.map((a) => [a.id, a.ovr]));
    expect(byId.get('players:jerry-rice:SF:1980s')).toBe(99);
    expect(byId.get('defense:lawrence-taylor:NYG:1980s')).toBe(99);
  });
});

describe('consensus check', () => {
  it('(a) the report has the consensus section, generated from the current ratings', () => {
    const section = consensusSection(result, file).join('\n');
    expect(report).toContain('## Consensus check');
    expect(report).toContain(section);
  });

  it('(b) every disagreement is flagged in the report; none is dropped', () => {
    // Top 3 of every group, both anchors.
    expect(result.top.length).toBe(CONSENSUS_GROUPS.length * 3);
    expect(result.anchors.length).toBe(file.anchors.length);
    const expected = result.top.filter((t) => !t.inSet).length + result.anchors.filter((a) => !a.agrees).length;
    expect(result.disagreements.length).toBe(expected);
    expect(report).toContain(`### Disagreements (${result.disagreements.length})`);
    for (const d of result.disagreements) expect(report).toContain(`- ${d.text}.`);
    // Anchors: stats value, consensus value and gap are shown whether or not they agree.
    for (const a of result.anchors) expect(report).toMatch(new RegExp(`\\| ${a.name.replace(/[()]/g, '\\$&')} \\| ${a.stats.toFixed(1)} \\| ${a.rank} of ${a.poolSize} \\| ${a.consensus} \\| [+-]?${Math.abs(a.gap).toFixed(1)} \\|`));
  });

  it('(b) with an empty consensus set, every top-3 player becomes a flagged disagreement', () => {
    const empty: ConsensusFile = { ...file, positions: Object.fromEntries(Object.entries(file.positions).map(([g, p]) => [g, { ...p, players: [] }])) };
    const r = consensusCheck(run, empty);
    expect(r.disagreements.filter((d) => d.kind === 'top3').length).toBe(r.top.length);
    const text = consensusSection(r, empty).join('\n');
    for (const d of r.disagreements) expect(text).toContain(`- ${d.text}.`);
    expect(text.match(/\*\*no: FLAG\*\*/g)?.length).toBe(r.top.length);
  });

  it('(c) the ratings are identical with and without the consensus layer', () => {
    const before = JSON.stringify(snapshot(run, 1));
    consensusCheck(run, file);
    consensusSection(result, file);
    expect(JSON.stringify(snapshot(run, 1))).toBe(before);
    // A fresh run (the engine never sees the consensus file) matches too.
    expect(JSON.stringify(snapshot(rateAll(inputs), 1))).toBe(before);
    // And the engine source never reads it.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
    for (const f of walk(ROOT + 'src/engine/ratings')) expect(readFileSync(f, 'utf8'), f).not.toMatch(/consensus/i);
  });
});
