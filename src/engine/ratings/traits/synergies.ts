import type { RatedPos } from '../types';
import type { TraitIconId } from './types';

// Roster synergies: a drafted QB and receiver, a QB or RB and his O-line (the
// unit's traits, read from the mean of its five linemen), or a QB and RB whose
// traits fit together. Shown in the matchup preview and pre-game (M7; the
// Ratings Explorer's compare mode shows them now), applied by the sim from M5.
//
// Every effect is small and bounded (SYNERGY_LIMITS), described in data: the
// sim looks up `key` and adds `value` (in `unit`) for the pair only. A roster
// can hold several synergies, but each pair of players gets at most one per
// key (the first match below).

export type SynergyUnit = 'pct' | 's' | 'yd';

/** Largest magnitude a single synergy may have, per unit (tests enforce it). */
export const SYNERGY_LIMITS: Record<SynergyUnit, number> = { pct: 5, s: 0.15, yd: 0.5 };

export interface SynergyRole {
  pos: readonly RatedPos[];
  /** Any of these trait ids (combinations count as their parts too). */
  traits: readonly string[];
}

export interface SynergyEffect {
  /** One line for the UI and docs. */
  text: string;
  /** What the sim modifies (sim/attributeEffects.ts, M5). */
  key: string;
  /** Signed change, in `unit`. */
  value: number;
  unit: SynergyUnit;
}

export interface SynergyDef {
  id: string;
  label: string;
  icon: TraitIconId;
  polarity: 'positive' | 'negative';
  a: SynergyRole;
  /** The partner: another player, or the OL unit (unit traits). */
  b: SynergyRole | { unit: true; traits: readonly string[] };
  effect: SynergyEffect;
}

const QB: readonly RatedPos[] = ['QB'];
const REC: readonly RatedPos[] = ['WR', 'TE'];

export const SYNERGIES: readonly SynergyDef[] = [
  {
    id: 'moonball',
    label: 'Moonball',
    icon: 'rocket',
    polarity: 'positive',
    a: { pos: QB, traits: ['deep-ball-artist', 'cannon'] },
    b: { pos: REC, traits: ['burner', 'deep-threat', 'long-strider', 'seam-stretcher', 'big-play', 'home-run-threat'] },
    effect: { text: 'Deep balls (20+ air yards) to this receiver: placement error −5%.', key: 'pass.deepError', value: -5, unit: 'pct' },
  },
  {
    id: 'timing-offense',
    label: 'Timing Offense',
    icon: 'metronome',
    polarity: 'positive',
    a: { pos: QB, traits: ['quick-trigger', 'surgeon'] },
    b: { pos: REC, traits: ['route-technician', 'slot-weapon', 'head-fake', 'twitch'] },
    effect: { text: 'On routes under 15 yd thrown on the last step of the drop: +0.05 s of separation at the break.', key: 'route.breakSeparation', value: 0.05, unit: 's' },
  },
  {
    id: 'red-zone-connection',
    label: 'Red Zone Connection',
    icon: 'flag',
    polarity: 'positive',
    a: { pos: QB, traits: ['red-zone-sniper'] },
    b: { pos: REC, traits: ['red-zone-threat', 'contested-catch-king', 'basketball-body'] },
    effect: { text: 'Inside the 20: catch probability +4% on throws to this receiver.', key: 'catch.redZone', value: 4, unit: 'pct' },
  },
  {
    id: 'throw-it-up',
    label: 'Throw It Up',
    icon: 'tower',
    polarity: 'positive',
    a: { pos: QB, traits: ['gunslinger', 'cannon'] },
    b: { pos: REC, traits: ['contested-catch-king', 'skyscraper', 'mismatch', 'big-body'] },
    effect: { text: 'Contested catches on his throws to this receiver +4%.', key: 'catch.contested', value: 4, unit: 'pct' },
  },
  {
    id: 'scramble-drill',
    label: 'Scramble Drill',
    icon: 'house',
    polarity: 'positive',
    a: { pos: QB, traits: ['escape-artist', 'off-platform', 'dual-threat'] },
    b: { pos: REC, traits: ['sideline-toe-tap', 'twitch', 'head-fake', 'athlete-te'] },
    effect: { text: 'When the QB leaves the pocket this receiver converts his route 0.1 s sooner.', key: 'route.scrambleConvert', value: -0.1, unit: 's' },
  },
  {
    id: 'security-blanket',
    label: 'Security Blanket',
    icon: 'hook',
    polarity: 'positive',
    a: { pos: QB, traits: ['checkdown-charlie', 'game-manager'] },
    b: { pos: ['TE', 'RB'], traits: ['safety-blanket', 'sure-hands', 'receiving-back', 'third-down-back', 'h-back'] },
    effect: { text: 'Under pressure, short throws to this target +4% completion.', key: 'catch.shortUnderPressure', value: 4, unit: 'pct' },
  },
  {
    id: 'pitch-and-catch',
    label: 'Pitch and Catch',
    icon: 'chain',
    polarity: 'positive',
    a: { pos: QB, traits: ['surgeon', 'efficiency-king'] },
    b: { pos: REC, traits: ['chain-mover', 'glue-hands', 'sure-hands'] },
    effect: { text: 'On third down, throws to this receiver past the sticks +3% catch probability.', key: 'catch.thirdDown', value: 3, unit: 'pct' },
  },
  {
    id: 'read-option',
    label: 'Read Option',
    icon: 'dual',
    polarity: 'positive',
    a: { pos: QB, traits: ['dual-threat', 'designed-runner'] },
    b: { pos: ['RB'], traits: ['burst', 'one-cut', 'home-run-hitter', 'big-play-back'] },
    effect: { text: 'On option plays the edge defender reads the mesh 0.1 s later.', key: 'run.meshRead', value: 0.1, unit: 's' },
  },
  {
    id: 'follow-the-convoy',
    label: 'Follow the Convoy',
    icon: 'hourglass',
    polarity: 'positive',
    a: { pos: ['RB'], traits: ['patient-runner'] },
    b: { unit: true, traits: ['road-graders', 'ground-and-pound'] },
    effect: { text: 'Running lanes behind this line stay open 0.1 s longer for him.', key: 'run.laneHold', value: 0.1, unit: 's' },
  },
  {
    id: 'downhill',
    label: 'Downhill',
    icon: 'plow',
    polarity: 'positive',
    a: { pos: ['RB'], traits: ['battering-ram', 'tackle-breaker', 'goal-line-hammer', 'grinder'] },
    b: { unit: true, traits: ['road-graders'] },
    effect: { text: 'Inside runs: +0.3 yd before contact.', key: 'run.yardsBeforeContact', value: 0.3, unit: 'yd' },
  },
  {
    id: 'outside-zone',
    label: 'Outside Zone',
    icon: 'swing',
    polarity: 'positive',
    a: { pos: ['RB'], traits: ['one-cut', 'burst', 'home-run-hitter'] },
    b: { unit: true, traits: ['athletic-line'] },
    effect: { text: 'Stretch runs reach the edge 0.1 s sooner.', key: 'run.edgeReach', value: -0.1, unit: 's' },
  },
  {
    id: 'screen-game',
    label: 'Screen Game',
    icon: 'hand',
    polarity: 'positive',
    a: { pos: ['RB'], traits: ['receiving-back', 'scatback'] },
    b: { unit: true, traits: ['athletic-line'] },
    effect: { text: 'On screens the lead blockers arrive 0.1 s sooner.', key: 'screen.blockArrival', value: -0.1, unit: 's' },
  },
  {
    id: 'clean-pocket',
    label: 'Clean Pocket',
    icon: 'wall',
    polarity: 'positive',
    a: { pos: QB, traits: ['climber', 'pre-snap-wizard', 'field-general'] },
    b: { unit: true, traits: ['pass-pro-wall', 'smart-line'] },
    effect: { text: 'Pocket-collapse time +0.1 s.', key: 'pocket.collapseTime', value: 0.1, unit: 's' },
  },
  {
    id: 'sitting-duck',
    label: 'Sitting Duck',
    icon: 'warning',
    polarity: 'negative',
    a: { pos: QB, traits: ['statue', 'sack-magnet', 'happy-feet'] },
    b: { unit: true, traits: ['turnstile', 'sack-prone'] },
    effect: { text: 'A clash: pocket-collapse time −0.1 s.', key: 'pocket.collapseTime', value: -0.1, unit: 's' },
  },
];

/** A roster as synergy detection sees it: players with their held trait ids (combinations expanded), and the OL unit. */
export interface RosterView {
  players: readonly { id: string; pos: RatedPos; traits: readonly string[] }[];
  olUnit?: { unitId: string; traits: readonly string[] };
}

export interface SynergyHit {
  synergy: SynergyDef;
  /** The first member and the trait of his that matched. */
  a: { id: string; trait: string };
  /** The partner (player id, or the OL unit id) and the trait that matched. */
  b: { id: string; trait: string; unit?: boolean };
}

/** Every synergy a roster holds. Pure and deterministic (roster order). */
export function detectSynergies(roster: RosterView): SynergyHit[] {
  const out: SynergyHit[] = [];
  const seen = new Set<string>();
  const match = (held: readonly string[], want: readonly string[]) => want.find((t) => held.includes(t));
  for (const s of SYNERGIES) {
    for (const a of roster.players) {
      if (!s.a.pos.includes(a.pos)) continue;
      const ta = match(a.traits, s.a.traits);
      if (!ta) continue;
      const partners: { id: string; traits: readonly string[]; unit?: boolean }[] =
        'unit' in s.b ? (roster.olUnit ? [{ id: roster.olUnit.unitId, traits: roster.olUnit.traits, unit: true }] : []) : roster.players.filter((b) => b.id !== a.id && (s.b as SynergyRole).pos.includes(b.pos));
      for (const b of partners) {
        const tb = match(b.traits, s.b.traits);
        if (!tb) continue;
        // One synergy per effect key per pair.
        const k = `${s.effect.key}|${a.id}|${b.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ synergy: s, a: { id: a.id, trait: ta }, b: { id: b.id, trait: tb, ...(b.unit ? { unit: true } : {}) } });
      }
    }
  }
  return out;
}
