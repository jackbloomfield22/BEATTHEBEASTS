import type { RatedPos } from '../types';

// Trait definitions (BRIEF "Overall rating and traits"; docs/TRAITS.md).
//
// A trait is earned by passing every condition of its definition. Conditions
// are percentile gates inside the position pool (all decades together; every
// input is already era-relative), so a trait means the same thing in 1965 and
// 2020 and plenty of players never earn one:
//
//   elite traits     primary condition at the top 10% of the position
//   standard traits  top 25%
//   negative traits  bottom 10–15%
//
// Secondary conditions may use looser gates (e.g. "Throw Power in the bottom
// half" for a Touch Passer); every gate is written out in the definition.
//
// Traits read three kinds of signal, so they don't all say the same thing:
//   physical    measurables and body (Speed, height, weight)
//   technical   attribute thresholds (Deep Accuracy, Elusiveness)
//   production  stat signatures the attributes don't capture on their own
//               (share of the team's catches, yards per catch, TDs per touch)
//
// Traits describe how a player plays within his stint, never his career arc:
// no condition may read age, experience or a count of seasons.

export type TraitKind = 'physical' | 'technical' | 'production';
export type TraitPolarity = 'positive' | 'negative';
export type TraitTier = 'elite' | 'standard';

/** Icon ids; src/ui/scouting/traitIcons.tsx draws one glyph per id. */
export const TRAIT_ICON_IDS = [
  'rocket', 'target', 'feather', 'crosshair', 'stopwatch', 'escape', 'dual', 'tilt', 'pillar', 'climb', 'runner', 'scalpel', 'crown',
  'clipboard', 'snowflake', 'eye', 'hook', 'flame', 'stack', 'percent', 'flag', 'metronome', 'warning', 'magnet', 'feet', 'twig',
  'bomb', 'house', 'dice', 'baton', 'bolt', 'burst', 'ram', 'palm', 'shatter', 'anvil', 'train', 'zigzag', 'spiral', 'hurdle',
  'cut', 'hourglass', 'battery', 'split', 'hand', 'shield', 'grind', 'star', 'drop', 'rail', 'sway', 'ruler', 'weight', 'tower',
  'spring', 'route', 'release', 'slot', 'arrowUp', 'glove', 'toe', 'sparkle', 'fist', 'yac', 'chain', 'alpha', 'plow', 'link',
  'blocker', 'wall', 'lock', 'sack', 'claw', 'motor', 'hawk', 'net', 'eyeRadar', 'pick', 'broom', 'boulder', 'punch', 'missile',
  'swing', 'ice', 'turnstile', 'gauge', 'brain', 'loop', 'combo',
] as const;
export type TraitIconId = (typeof TRAIT_ICON_IDS)[number];

/**
 * A metric a condition reads, resolved per entry by metrics.ts:
 *   attribute key        'speed', 'deepAcc', ... (physical attributes fall
 *                        back to the physical pass when the position doesn't
 *                        show them, e.g. an RB's jumping)
 *   'height' / 'weight'  era-translated body (the time-machine rule), shown as listed
 *   'z:<signal>'         a stat signal from ../signals.ts as its sample-shrunk z-score
 *   't:<signal>'         a trait-only stat signal (metrics.ts TRAIT_SIGNALS)
 */
export type MetricKey = string;

export interface Cond {
  m: MetricKey;
  /** 'top': percentile ≥ 100 − gate; 'bottom': percentile ≤ gate. */
  side: 'top' | 'bottom';
  /** Gate as a share of the position pool, in percent. */
  gate: number;
}

export interface TraitDef {
  id: string;
  label: string;
  pos: readonly RatedPos[];
  kind: TraitKind;
  polarity: TraitPolarity;
  tier: TraitTier;
  icon: TraitIconId;
  /** One-line gameplay effect (sim/attributeEffects.ts implements it from M5). */
  effect: string;
  conds: readonly Cond[];
  /** Design note shown in docs/TRAITS.md (e.g. what a proxy stands for). */
  note?: string;
}

/** Two traits that together read as something recognizable: shown as one badge. */
export interface ComboDef {
  id: string;
  label: string;
  pos: readonly RatedPos[];
  parts: readonly [string, string];
  kind: TraitKind;
  icon: TraitIconId;
  effect: string;
}

/** A trait considered and cut, with the reason (listed in the report and docs/TRAITS.md). */
export interface CutTrait {
  id: string;
  label: string;
  pos: readonly RatedPos[];
  reason: string;
}

/** OL unit traits read the unit's aggregate (mean of its five linemen). */
export interface UnitTraitDef extends Omit<TraitDef, 'pos'> {
  pos: readonly ['OL'];
}
