// Traits (ratings follow-up): gating, the four-trait cap, the cut rules,
// zero-trait share, catalog completeness, no career-arc traits, synergies,
// and a few recognizable stars. docs/TRAITS.md and the ratings report show
// the same numbers.

import { describe, expect, it } from 'vitest';
import { rateAll } from '@/engine/ratings/engine';
import { buildInputs } from '@/engine/ratings/inputs';
import {
  ALL_TRAIT_INFO,
  COMBOS,
  CUT_TRAITS,
  detectSynergies,
  heldTraitIds,
  MAX_NEGATIVE,
  MAX_TRAITS,
  SYNERGIES,
  SYNERGY_LIMITS,
  TRAIT_DEFS,
  TRAIT_ICON_IDS,
  traitInfo,
  UNIT_TRAITS,
} from '@/engine/ratings/traits';
import { CAREER_ARC_KEYS } from '@/engine/ratings/traits/metrics';
import { groupOf } from '@/engine/ratings/traits/groups';
import type { RatedEntry } from '@/engine/ratings/types';
import { loadSources } from '../tools/ratings/sources';
import { TRAIT_COOCCUR_MAX, TRAIT_MIN_HOLDERS, TRAIT_ZERO_SHARE_MIN, traitStats, traitTotals } from '../tools/ratings/validate';

const run = rateAll(buildInputs(loadSources()).inputs);
const byId = new Map(run.entries.map((e) => [e.id, e]));
const held = (id: string) => heldTraitIds(byId.get(id)!.traits);

describe('trait catalog', () => {
  it('every trait has a label, an icon, a gameplay effect and at least one gate', () => {
    for (const d of [...TRAIT_DEFS, ...UNIT_TRAITS]) {
      expect(d.label, d.id).toBeTruthy();
      expect(TRAIT_ICON_IDS, d.id).toContain(d.icon);
      expect(d.effect.length, d.id).toBeGreaterThan(10);
      expect(d.conds.length, d.id).toBeGreaterThan(0);
      for (const c of d.conds) expect(c.gate, d.id).toBeGreaterThan(0);
    }
    for (const c of COMBOS) {
      expect(TRAIT_ICON_IDS, c.id).toContain(c.icon);
      expect(c.effect.length, c.id).toBeGreaterThan(10);
      for (const p of c.parts) expect(TRAIT_DEFS.some((d) => d.id === p && c.pos.every((pos) => d.pos.includes(pos))), `${c.id} part ${p}`).toBe(true);
    }
    expect(new Set(ALL_TRAIT_INFO.map((t) => t.id)).size).toBe(ALL_TRAIT_INFO.length);
  });

  it('gates: elite traits at about the top 10%, the rest at the top 25%, negatives gated at 25% or tighter', () => {
    for (const d of TRAIT_DEFS) {
      if (d.polarity === 'negative') expect(d.conds.some((c) => c.gate <= 25), d.id).toBe(true);
      else expect(d.conds.some((c) => c.side === 'top' && c.gate <= (d.tier === 'elite' ? 10 : 25)), d.id).toBe(true);
    }
  });

  it('at least a dozen combinations, each with both parts at its positions', () => {
    expect(COMBOS.length).toBeGreaterThanOrEqual(12);
  });

  it('no career-arc traits: no gate reads age, experience or a count of seasons', () => {
    for (const d of [...TRAIT_DEFS, ...UNIT_TRAITS]) for (const c of d.conds) expect(CAREER_ARC_KEYS, `${d.id} reads ${c.m}`).not.toContain(c.m);
    for (const t of ALL_TRAIT_INFO) expect(/iron man|late bloomer|ageless|veteran|rookie/i.test(t.label), t.id).toBe(false);
  });

  it('every trait and combination has a facet at each of its positions', () => {
    for (const t of ALL_TRAIT_INFO) for (const p of t.pos) expect(groupOf(p, t.id), `${p} ${t.id}`).toBeTruthy();
  });

  it('cut traits are not in the catalog and each says why', () => {
    for (const c of CUT_TRAITS) {
      expect(traitInfo(c.id), c.id).toBeUndefined();
      expect(c.reason.length, c.id).toBeGreaterThan(20);
    }
  });
});

describe('traits on the rated pool', () => {
  it('no player shows more than four traits or more than two negatives', () => {
    for (const e of run.entries) {
      expect(e.traits.length, e.id).toBeLessThanOrEqual(MAX_TRAITS);
      expect(e.traits.filter((t) => traitInfo(t.id)?.polarity === 'negative').length, e.id).toBeLessThanOrEqual(MAX_NEGATIVE);
      expect(new Set(heldTraitIds(e.traits)).size, e.id).toBe(heldTraitIds(e.traits).length);
    }
  });

  it('every shown trait has a non-empty why line and exists in the catalog', () => {
    for (const e of run.entries) {
      for (const t of e.traits) {
        expect(traitInfo(t.id), `${e.id} ${t.id}`).toBeDefined();
        expect(t.why.length, `${e.id} ${t.id}`).toBeGreaterThan(5);
        expect(t.reasons.length, `${e.id} ${t.id}`).toBeGreaterThan(0);
        expect(traitInfo(t.id)!.pos, `${e.id} ${t.id}`).toContain(e.pos);
      }
    }
    for (const u of Object.values(run.olUnits)) for (const t of u.traits) expect(t.why.length, u.unitId).toBeGreaterThan(5);
  });

  it(`every kept trait is earned by at least ${TRAIT_MIN_HOLDERS} players`, () => {
    const thin = traitTotals(run).filter((r) => r.held < TRAIT_MIN_HOLDERS).map((r) => `${r.id}: ${r.held}`);
    expect(thin).toEqual([]);
    const units = new Map<string, number>();
    for (const u of Object.values(run.olUnits)) for (const t of u.traits) units.set(t.id, (units.get(t.id) ?? 0) + 1);
    for (const d of UNIT_TRAITS) expect(units.get(d.id) ?? 0, d.id).toBeGreaterThanOrEqual(TRAIT_MIN_HOLDERS);
  });

  it(`no trait always appears alongside another (≥ ${TRAIT_COOCCUR_MAX * 100}% of its holders)`, () => {
    const always = traitTotals(run)
      .filter((r) => r.partnerShare >= TRAIT_COOCCUR_MAX)
      .map((r) => `${r.id} with ${r.partner}: ${(r.partnerShare * 100).toFixed(0)}%`);
    expect(always).toEqual([]);
  });

  it(`at least ${TRAIT_ZERO_SHARE_MIN * 100}% of every position has no trait`, () => {
    const low = traitStats(run)
      .filter((s) => s.zeroShare < TRAIT_ZERO_SHARE_MIN)
      .map((s) => `${s.pos}: ${(s.zeroShare * 100).toFixed(1)}%`);
    expect(low).toEqual([]);
  });

  it('traits are deterministic', () => {
    const again = rateAll(buildInputs(loadSources()).inputs);
    const pick = (r: typeof run) => r.entries.slice(0, 400).map((e) => e.traits.map((t) => `${t.id}:${t.why}`).join('|'));
    expect(pick(again)).toEqual(pick(run));
  });

  it('recognizable stars get recognizable traits', () => {
    const has = (id: string, any: string[]) => any.some((t) => held(id).includes(t));
    expect(has('players:randy-moss:MIN:1990s', ['burner', 'deep-threat', 'big-play', 'long-strider'])).toBe(true);
    expect(has('players:barry-sanders:DET:1990s', ['ankle-breaker', 'spin-cycle', 'jump-cut'])).toBe(true);
    expect(has('players:jerome-bettis:PIT:1990s', ['battering-ram', 'tackle-breaker', 'stiff-arm-king'])).toBe(true);
    expect(has('players:tom-brady:NE:2010s', ['surgeon', 'field-general', 'ice-veins', 'pre-snap-wizard', 'efficiency-king'])).toBe(true);
    expect(has('defense:lawrence-taylor:NYG:1980s', ['sack-artist', 'speed-rusher', 'strip-sack'])).toBe(true);
    expect(has('defense:deion-sanders:DAL:1990s', ['shutdown-corner', 'ballhawk', 'track-speed', 'zone-reader'])).toBe(true);
    expect(has('players:michael-vick:ATL:2000s', ['dual-threat', 'designed-runner'])).toBe(true);
    expect(has('players:patrick-mahomes:KC:2010s', ['off-platform', 'cannon'])).toBe(true);
  });
});

describe('synergies', () => {
  const entry = (id: string): RatedEntry => byId.get(id)!;
  const view = (e: RatedEntry) => ({ id: e.id, pos: e.pos, traits: heldTraitIds(e.traits) });

  it('every synergy is small and bounded, and names real traits', () => {
    const known = new Set([...ALL_TRAIT_INFO.map((t) => t.id)]);
    for (const s of SYNERGIES) {
      expect(Math.abs(s.effect.value), s.id).toBeGreaterThan(0);
      expect(Math.abs(s.effect.value), s.id).toBeLessThanOrEqual(SYNERGY_LIMITS[s.effect.unit]);
      expect(s.effect.text.length, s.id).toBeGreaterThan(10);
      expect(TRAIT_ICON_IDS, s.id).toContain(s.icon);
      for (const t of [...s.a.traits, ...s.b.traits]) expect(known.has(t), `${s.id}: ${t}`).toBe(true);
    }
  });

  it('every synergy can happen with real players', () => {
    const qb = run.entries.filter((e) => e.traits.length);
    for (const s of SYNERGIES) {
      const as = qb.filter((e) => s.a.pos.includes(e.pos) && s.a.traits.some((t) => heldTraitIds(e.traits).includes(t)));
      expect(as.length, `${s.id}: nobody holds side a`).toBeGreaterThan(0);
      if ('unit' in s.b) {
        const units = Object.values(run.olUnits).filter((u) => u.traits.some((t) => s.b.traits.includes(t.id)));
        expect(units.length, `${s.id}: no OL unit holds side b`).toBeGreaterThan(0);
      } else {
        const b = s.b;
        expect(qb.some((e) => b.pos.includes(e.pos) && b.traits.some((t) => heldTraitIds(e.traits).includes(t))), `${s.id}: nobody holds side b`).toBe(true);
      }
    }
  });

  it('detects a QB–receiver pairing and is pure', () => {
    // Peyton Manning (Deep Ball Artist via Bomb Squad) with Randy Moss (Burner): Moonball.
    const roster = { players: [view(entry('players:peyton-manning:IND:2000s')), view(entry('players:randy-moss:MIN:1990s'))] };
    const hits = detectSynergies(roster);
    expect(hits.map((h) => h.synergy.id)).toContain('moonball');
    expect(detectSynergies(roster)).toEqual(hits);
    // No self-pairing, no pairing without a partner.
    expect(detectSynergies({ players: [view(entry('players:peyton-manning:IND:2000s'))] })).toEqual([]);
  });

  it('reads the OL unit for run and pass-block synergies', () => {
    const unit = Object.values(run.olUnits).find((u) => u.traits.some((t) => t.id === 'road-graders'))!;
    const rb = run.entries.find((e) => e.pos === 'RB' && heldTraitIds(e.traits).includes('patient-runner'))!;
    const hits = detectSynergies({ players: [view(rb)], olUnit: { unitId: unit.unitId, traits: heldTraitIds(unit.traits) } });
    expect(hits.some((h) => h.synergy.id === 'follow-the-convoy' && h.b.unit)).toBe(true);
  });
});
