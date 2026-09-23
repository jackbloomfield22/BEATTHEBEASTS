import type { CutTrait } from './types';

// Traits considered and cut (docs/TRAITS.md and the ratings report list them).
// The rules (user, ratings follow-up): cut any trait fewer than five players
// earn, or that always appears alongside another trait (≥ 95% of its holders
// also hold the other), and anything that describes a career arc instead of
// how the player plays within his stint.

export const CUT_TRAITS: readonly CutTrait[] = [
  { id: 'return-man', label: 'Return Man', pos: ['RB', 'WR'], reason: 'No gameplay to attach it to: every drive starts at the 25 and punts are auto-simulated (BRIEF "Game format and rules"). The data would also be one-sided: sourced kick/punt return stats exist only from 1999 (nflverse weekly stats), so no pre-1999 back could earn it.' },
  { id: 'volume-target', label: 'Volume Target', pos: ['WR'], reason: 'Same signal as Alpha (receptions per game as a share of a league team\'s completions), so it would always appear alongside it. Merged into Alpha.' },
  { id: 'iron-man', label: 'Iron Man / Late Bloomer / Ageless', pos: ['QB', 'RB', 'WR', 'TE'], reason: 'Career-arc traits. Players exist as era stints, so a trait describes how he plays within the stint, never his durability or career shape. Never built.' },
];
