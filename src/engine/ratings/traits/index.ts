import type { RatedPos, TraitResult } from '../types';
import { UNIT_TRAITS } from './catalogDefense';
import { COMBOS } from './combos';
import { TRAIT_DEFS } from './derive';
import type { TraitIconId, TraitKind, TraitPolarity, TraitTier } from './types';

export * from './types';
export { COMBOS } from './combos';
export { CUT_TRAITS, REDEFINED_COMBOS } from './cut';
export { DEFENSE_TRAITS, UNIT_TRAITS } from './catalogDefense';
export { OFFENSE_TRAITS } from './catalogOffense';
export { deriveAllTraits, MAX_NEGATIVE, MAX_TRAITS, TRAIT_DEFS, type OlUnitTraits, type TraitRun } from './derive';
export { metricLabel } from './metrics';
export { parseRanks, plainWhy, type Rank } from './plain';
export { detectSynergies, SYNERGIES, SYNERGY_LIMITS, type RosterView, type SynergyDef, type SynergyHit } from './synergies';

/** Everything the UI needs to show a trait badge. */
export interface TraitInfo {
  id: string;
  label: string;
  icon: TraitIconId;
  effect: string;
  kind: TraitKind;
  polarity: TraitPolarity;
  tier: TraitTier;
  pos: readonly RatedPos[];
  /** Combination traits: the two parts. */
  parts?: readonly [string, string];
  /** OL unit trait. */
  unit?: boolean;
}

const INFO = new Map<string, TraitInfo>();
for (const d of TRAIT_DEFS) INFO.set(d.id, { id: d.id, label: d.label, icon: d.icon, effect: d.effect, kind: d.kind, polarity: d.polarity, tier: d.tier, pos: d.pos });
for (const d of UNIT_TRAITS) INFO.set(d.id, { id: d.id, label: d.label, icon: d.icon, effect: d.effect, kind: d.kind, polarity: d.polarity, tier: d.tier, pos: d.pos, unit: true });
for (const c of COMBOS) {
  const [a, b] = c.parts.map((p) => INFO.get(p)!);
  INFO.set(c.id, {
    id: c.id,
    label: c.label,
    icon: c.icon,
    effect: c.effect,
    kind: c.kind,
    polarity: a!.polarity === 'negative' && b!.polarity === 'negative' ? 'negative' : 'positive',
    tier: a!.tier === 'elite' || b!.tier === 'elite' ? 'elite' : 'standard',
    pos: c.pos,
    parts: c.parts,
  });
}

export function traitInfo(id: string): TraitInfo | undefined {
  return INFO.get(id);
}

export const ALL_TRAIT_INFO: readonly TraitInfo[] = [...INFO.values()];

/** Label lookup (kept for existing callers). */
export const TRAIT_LABELS: Readonly<Record<string, string>> = Object.fromEntries([...INFO.values()].map((t) => [t.id, t.label]));

/** Trait ids a player holds, with combinations expanded into their parts too (synergies read these). */
export function heldTraitIds(traits: readonly TraitResult[]): string[] {
  const out = new Set<string>();
  for (const t of traits) {
    out.add(t.id);
    for (const p of t.combo ?? []) out.add(p);
  }
  return [...out];
}
