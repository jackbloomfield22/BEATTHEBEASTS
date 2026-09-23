import type { CutTrait } from './types';

// Traits considered and cut (docs/TRAITS.md and the ratings report list them).
// The rules (user, ratings follow-up): cut any trait fewer than five players
// earn, or that always appears alongside another trait (≥ 95% of its holders
// also hold the other), and anything that describes a career arc instead of
// how the player plays within his stint. Counts are from the tuning runs that
// led to the cut (ratings v1 data).

export const CUT_TRAITS: readonly CutTrait[] = [
  // Rule: fewer than five players.
  { id: 'touch-passer', label: 'Touch Passer', pos: ['QB'], reason: 'Fewer than five: 7 QBs passed the gates (Deep Accuracy top 25%, Throw Power bottom 60%) and only 1 kept it after the four-trait cap. Deep Accuracy and Throw Power both read yards per attempt and per completion, so a top deep passer with a modest arm barely exists in the data.' },
  { id: 'small-but-mighty', label: 'Small but Mighty', pos: ['WR'], reason: 'Fewer than five: 11 receivers passed (bottom 25% height, top Catch in Traffic), 2 kept it. Catch in Traffic reads height (20% of its formula), so short receivers rarely reach the top of it.' },
  { id: 'point-guard', label: 'Point Guard (Quick Trigger + Rhythm Passer)', pos: ['QB'], reason: 'Combination removed with Rhythm Passer (below). Unflappable (Quick Trigger + Ice in His Veins) takes its place.' },
  // Rule: always alongside another trait.
  { id: 'separator', label: 'Separator', pos: ['WR'], reason: 'Always alongside another: 97% of Separators (both route ratings in the top 15%) were also Route Technicians (both in the top 25%). It was a stricter copy of Route Technician.' },
  { id: 'rhythm-passer', label: 'Rhythm Passer', pos: ['QB'], reason: 'Always alongside another: 95% of Ice in His Veins holders were also Rhythm Passers, because Release and Under Pressure both come from sack rate and honors. One of the pair had to go; Ice in His Veins says more (pressure), and Quick Trigger (Release) and Surgeon (Short Accuracy) already cover Rhythm Passer\'s two halves.' },
  { id: 'edge-setter', label: 'Edge Setter', pos: ['DE'], reason: 'Always alongside another: all 8 holders (Strength and Tackle in the top 25%) also held Wrecking Ball (Power Rusher + Run Stuffer), which reads the same strength and tackling.' },
  // Design cuts.
  { id: 'volume-target', label: 'Volume Target', pos: ['WR'], reason: 'Same signal as Alpha (receptions per game as a share of a league team\'s completions), so it would always appear alongside it. Merged into Alpha.' },
  { id: 'return-man', label: 'Return Man', pos: ['RB', 'WR'], reason: 'No gameplay to attach it to: every drive starts at the 25 and punts are auto-simulated (BRIEF "Game format and rules"). The data is also one-sided: sourced kick and punt return stats exist only from 1999 (nflverse weekly stats, not in the augmentation layer), so no pre-1999 player could earn it.' },
  { id: 'iron-man', label: 'Iron Man, Late Bloomer, Ageless', pos: ['QB', 'RB', 'WR', 'TE'], reason: 'Career-arc traits. Players exist as era stints, so a trait describes how he plays within the stint, never his durability or the shape of his career. Never built; no gate reads age, experience or a count of seasons (tested).' },
];

/** Combinations redefined during tuning (the first definition broke a rule). */
export const REDEFINED_COMBOS: readonly { id: string; was: string; now: string; reason: string }[] = [
  { id: 'go-to-guy', was: 'Alpha + Red Zone Threat', now: 'Alpha + Glue Hands', reason: 'Only 3 receivers held both.' },
  { id: 'no-fly-zone', was: 'Shutdown Corner + Ballhawk', now: 'Shutdown Corner + Zone Reader', reason: 'Only 4 corners held both.' },
  { id: 'every-down-backer', was: 'Sideline to Sideline + Coverage Linebacker', now: 'Run Stuffer + Coverage Linebacker', reason: 'All 6 holders were also Speed Rushers (always alongside another).' },
  { id: 'open-field-menace', was: 'YAC Monster + Twitch (WR and TE)', now: 'WR only', reason: 'Twitch is a receiver trait; no tight end could hold both.' },
];
