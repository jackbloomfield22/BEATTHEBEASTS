// Validation of the full ratings run (BRIEF "Validation: prove the ratings are
// right"): anchors, era parity, monotonicity, cap pileups, cross-stint
// consistency, and the legacy comparison. docs/RATINGS_REPORT.md shows the
// same checks in detail.

import { describe, expect, it } from 'vitest';
import { rateAll } from '@/engine/ratings/engine';
import { buildInputs } from '@/engine/ratings/inputs';
import { sumContributions } from '@/engine/ratings/scale';
import type { RatingInputs, Sourced } from '@/engine/ratings/types';
import { loadSources } from '../tools/ratings/sources';
import { capPileups, crossStintViolations, eraParity, evaluateAnchors, legacyCorrelation } from '../tools/ratings/validate';

const sources = loadSources();
const { inputs } = buildInputs(sources);
const run = rateAll(inputs);

describe('ratings run', () => {
  it('rates every non-excluded entry, five linemen per OL unit', () => {
    const ol = run.entries.filter((e) => e.pos === 'OL');
    expect(ol.length).toBe(sources.olUnits.filter((u) => !sources.excluded.has(u.id)).length * 5);
    expect(run.entries.some((e) => sources.excluded.has(e.id))).toBe(false);
  });

  it('every value is on the 1–99 scale and its contributions sum to it', () => {
    for (const e of run.entries) {
      for (const [k, a] of [...Object.entries(e.attrs), ['ovr', e.ovr] as const]) {
        expect(a.value, `${e.id} ${k}`).toBeGreaterThanOrEqual(1);
        expect(a.value, `${e.id} ${k}`).toBeLessThanOrEqual(99);
        expect(Math.abs(sumContributions(a) - a.value), `${e.id} ${k}`).toBeLessThan(1e-6);
        expect(['high', 'medium', 'low']).toContain(a.conf);
      }
    }
  });

  it('imp is at most 20% of every attribute for every player', () => {
    for (const e of run.entries) {
      for (const [k, a] of Object.entries(e.attrs)) {
        const moves = a.contributions.filter((c) => c.kind !== 'base' && !c.label.startsWith('Pool-shape') && !c.label.startsWith('Clamped') && !c.label.startsWith('Pool calibration'));
        const total = moves.reduce((s, c) => s + Math.abs(c.delta), 0);
        const imp = moves.filter((c) => c.kind === 'reputation' && c.src === 'legacy:imp').reduce((s, c) => s + Math.abs(c.delta), 0);
        expect(imp, `${e.id} ${k}`).toBeLessThanOrEqual(0.2 * total + 1e-9);
      }
    }
  });

  it('the TE block grade keeps its direction (weight cap only, no per-player cap)', () => {
    // User decision (PR #3 round 2): a great blocker's grade lifts his blocking
    // and a poor blocker's grade lowers it, whatever his size says.
    const te = run.entries.filter((e) => e.pos === 'TE' && e.inputs.stats.blockGrade);
    expect(te.length).toBeGreaterThan(400);
    for (const e of te) {
      const c = e.attrs.runBlock!.contributions.find((x) => x.label.startsWith('Legacy block grade'))!;
      expect(c.label, e.id).not.toContain('capped');
    }
  });

  it('no pileups: at most 6 players at 99 in any attribute of any position', () => {
    const bad = capPileups(run).filter((r) => r.at99 > 6);
    expect(bad.map((r) => `${r.pos} ${r.attr}: ${r.at99}`)).toEqual([]);
  });

  it('cross-stint consistency: physicals differ only by the aging curve', () => {
    expect(crossStintViolations(run)).toEqual([]);
  });

  it('legacy comparison: Spearman of OVR vs imp is between 0.75 and 0.9', () => {
    const { overall } = legacyCorrelation(run);
    expect(overall).toBeGreaterThanOrEqual(0.75);
    expect(overall).toBeLessThanOrEqual(0.9);
  });

  it('era parity: no offensive decade is more than 3 points off (top-10 OVR)', () => {
    // Defense and OL are reported in RATINGS_REPORT.md; the defensive pools
    // have 5–15 players per decade, so their top-N is too small to test.
    const offense = eraParity(run).filter((r) => ['QB', 'RB', 'WR', 'TE', 'OL'].includes(r.pos));
    expect(offense.map((r) => `${r.pos}: ${r.flagged.join(', ')}`).filter((s) => !s.endsWith(': '))).toEqual([]);
  });

  it('anchors: every anchor not flagged for review passes', () => {
    const failing = evaluateAnchors(run)
      .filter((a) => !a.pass && !a.anchor.review)
      .map((a) => `${a.label}: ${a.results.filter((r) => !r.pass).map((r) => r.text).join('; ')}`);
    expect(failing).toEqual([]);
  });
});

describe('monotonicity', () => {
  // Improve one production stat for a sample of stints and re-rate the whole
  // pool: the attributes that read that stat (and OVR) must not go down.
  const cases: { pos: string; field: keyof RatingInputs['stats']; factor: number; attrs: string[] }[] = [
    { pos: 'QB', field: 'ypa', factor: 1.1, attrs: ['throwPower', 'deepAcc', 'midAcc'] },
    { pos: 'QB', field: 'intPct', factor: 0.8, attrs: ['decision', 'shortAcc'] },
    { pos: 'RB', field: 'ypc', factor: 1.1, attrs: ['vision', 'elusiveness', 'breakTackle'] },
    { pos: 'WR', field: 'recYdsPerGame', factor: 1.15, attrs: ['deepRoute', 'beatPress'] },
    { pos: 'TE', field: 'tdPerGame', factor: 1.2, attrs: ['catchInTraffic', 'spectacular'] },
    { pos: 'DE', field: 'sacksPerGame', factor: 1.2, attrs: ['powerMoves', 'finesseMoves'] },
    { pos: 'CB', field: 'defIntPerGame', factor: 1.3, attrs: ['ballSkills', 'zoneCov'] },
  ];
  for (const c of cases) {
    it(`${c.pos}: better ${String(c.field)} never lowers ${c.attrs.join(', ')} or OVR`, () => {
      // One stint at a time, so other perturbed players can't overtake it in
      // the pool ranking (that would be a real, legitimate drop).
      const pool = inputs.filter((e) => e.pos === c.pos && e.stats[c.field]);
      const step = Math.max(1, Math.floor(pool.length / 3));
      const targets = pool.filter((_, i) => i % step === 0).slice(0, 3);
      expect(targets.length).toBe(3);
      const before = new Map(run.entries.map((e) => [e.id, e]));
      for (const t of targets) {
        const perturbed = inputs.map((e) => {
          if (e.id !== t.id) return e;
          const s = e.stats[c.field] as Sourced;
          return { ...e, stats: { ...e.stats, [c.field]: { ...s, v: s.v * c.factor } } };
        });
        const a = rateAll(perturbed).entries.find((e) => e.id === t.id)!;
        const b = before.get(t.id)!;
        for (const k of c.attrs) expect(a.attrs[k]!.value, `${t.id} ${k}`).toBeGreaterThanOrEqual(b.attrs[k]!.value - 1e-6);
        expect(a.ovr.value, `${t.id} OVR`).toBeGreaterThanOrEqual(b.ovr.value - 1e-6);
      }
    });
  }
});
