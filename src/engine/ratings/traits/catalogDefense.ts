import type { RatedPos } from '../types';
import { bottom, ELITE, NEG, STD, top } from './catalogOffense';
import type { TraitDef, UnitTraitDef } from './types';

// Defensive traits (the Beasts) and OL unit traits. Same gating as offense
// (percentiles of the position pool). The defensive pools are small (54–105
// curated players), so most traits are single elite gates or two standard
// gates; ≥ 5 holders per trait is tested.

type Def = Omit<TraitDef, 'pos'>;
const at = (pos: readonly RatedPos[], defs: Def[]): TraitDef[] => defs.map((d) => ({ ...d, pos }));

export const DEFENSE_TRAITS: readonly TraitDef[] = [
  // ---------------------------------------------------------------- pass rush
  ...at(['DE', 'LB'], [
    { id: 'speed-rusher', label: 'Speed Rusher', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'bolt', conds: [top('finesseMoves'), top('speed')], effect: 'Wins around the edge earlier against slow-footed tackles: speed-rush time-to-win −0.3 s against Pass Block Finesse below his.' },
  ]),
  ...at(['DE', 'DT'], [
    { id: 'power-rusher', label: 'Power Rusher', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'ram', conds: [top('powerMoves'), top('strength')], effect: 'Bull rush collapses the pocket faster against weak anchors: pocket depth shrinks 1 yd sooner.' },
    { id: 'motor', label: 'Relentless Motor', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'motor', conds: [top('stamina'), top('pursuit')], effect: 'Keeps rushing after the first move fails: a second-effort win chance late in the down.' },
  ]),
  ...at(['DT'], [
    { id: 'interior-wrecker', label: 'Interior Wrecker', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'claw', conds: [top('blockShed'), top('z:d_sack')], effect: 'Interior pass rush wins 0.25 s quicker against guards and centers.' },
    { id: 'space-eater', label: 'Space Eater', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'boulder', conds: [top('weight'), top('strength')], effect: 'Draws a double team on every run: one extra blocker is assigned to him.' },
  ]),
  ...at(['DE'], [
    { id: 'edge-bender', label: 'Edge Bender', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'spiral', conds: [top('agility'), top('acceleration')], effect: 'Dips under the tackle\'s punch: turning the corner costs 30% less speed.' },
  ]),
  ...at(['DE', 'DT', 'LB'], [
    { id: 'sack-artist', label: 'Sack Artist', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'sack', conds: [top('z:d_sack', ELITE)], effect: 'When he wins, he finishes: a win becomes a sack instead of a pressure 20% more often.' },
    { id: 'strip-sack', label: 'Strip-Sack Specialist', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'punch', conds: [top('z:d_ff', 20), top('z:d_sack', 20)], effect: 'Sacks from the blind side jar the ball loose 25% more often.' },
    { id: 'run-stuffer', label: 'Run Stuffer', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'anvil', conds: [top('tackle'), top('blockShed')], effect: 'Holds the point of attack: fewer yards before contact on runs at him.' },
  ]),
  // ---------------------------------------------------------------- coverage
  ...at(['CB', 'S', 'LB'], [
    { id: 'ballhawk', label: 'Ballhawk', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'hawk', conds: [top('ballSkills', ELITE)], effect: 'Breaks on the ball earlier and turns 25% more breakups into interceptions.' },
    { id: 'pick-six', label: 'Pick-Six Threat', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'pick', conds: [top('z:d_td'), top('z:d_int')], effect: 'After an interception his return pursuit angles are 15% worse for the offense: returns score more often.' },
  ]),
  ...at(['CB'], [
    { id: 'shutdown-corner', label: 'Shutdown Corner', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'lock', conds: [top('manCov', ELITE), top('press', 50)], effect: 'Tighter trail in man; the coordinator AI stops suggesting throws his way.' },
    { id: 'jam-artist', label: 'Jam Artist', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'palm', conds: [top('press'), top('strength')], effect: 'Press jams delay the receiver\'s release 0.15 s.' },
    { id: 'track-speed', label: 'Track Speed', kind: 'physical', polarity: 'positive', tier: 'elite', icon: 'bolt', conds: [top('speed', ELITE)], effect: 'Recovers from a lost step on vertical routes: closing speed +5% when trailing.' },
  ]),
  ...at(['CB', 'S'], [
    { id: 'zone-reader', label: 'Zone Reader', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'eyeRadar', conds: [top('zoneCov', 20), top('playRec', 20)], effect: 'In zone he breaks on the QB\'s eyes: reaction delay −0.08 s on throws into his area.' },
    { id: 'pbu-machine', label: 'Breakup Machine', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'net', conds: [top('z:d_pd')], effect: 'Contested catches against him: the ball is knocked away 10% more often.' },
    { id: 'missile', label: 'Missile', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'missile', conds: [top('hitPower'), top('speed', 50)], effect: 'Arrives at full speed: hits on receivers at the catch point dislodge the ball 15% more often.' },
    { id: 'arm-tackler', label: 'Arm Tackler', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'warning', conds: [bottom('tackle', NEG)], effect: 'Tackles in space miss 20% more often against ball carriers with Break Tackle above his Tackle.' },
    { id: 'gambler', label: 'Gambler', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'dice', conds: [top('ballSkills'), bottom('manCov', 40)], effect: 'Jumps routes: double moves beat him 20% more often, but he undercuts more throws.' },
  ]),
  ...at(['S'], [
    { id: 'center-fielder', label: 'Center Fielder', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'eye', conds: [top('zoneCov'), top('speed', 40)], effect: 'In single-high he covers sideline to sideline: deep-ball break range +3 yd.' },
  ]),
  // ---------------------------------------------------------------- run defense and hitting
  ...at(['LB', 'S'], [
    { id: 'sideline-to-sideline', label: 'Sideline to Sideline', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'rail', conds: [top('pursuit', ELITE), top('speed', 40)], effect: 'Better pursuit angles on outside runs and screens.' },
    { id: 'tackling-machine', label: 'Tackling Machine', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'net', conds: [top('z:d_tkl')], effect: 'Always in on the tackle: assists count as full wraps (no broken tackles against a pile).' },
    { id: 'enforcer', label: 'Enforcer', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'fist', conds: [top('hitPower', ELITE), top('tackle', 50)], effect: 'Big-hit chance and fumble pressure raised; receivers he hits drop the next contested ball 5% more often.' },
  ]),
  ...at(['LB'], [
    { id: 'coverage-linebacker', label: 'Coverage Linebacker', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'net', conds: [top('zoneCov'), top('manCov')], effect: 'Can carry tight ends and backs in man and match vertical routes in zone.' },
    { id: 'thumper', label: 'Downhill Thumper', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'boulder', conds: [top('hitPower', 20), top('weight', 20)], effect: 'Meets the back in the hole: runs between the tackles lose 0.5 yd after contact.' },
    { id: 'liability-space', label: 'Liability in Space', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'turnstile', conds: [bottom('manCov', NEG)], effect: 'In man against backs and tight ends he trails 0.1 s late.' },
  ]),
  ...at(['DE', 'DT', 'LB', 'CB', 'S'], [
    { id: 'ball-punch', label: 'Ball Punch', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'punch', conds: [top('z:d_ff', ELITE)], effect: 'Every tackle he makes carries a punch-out attempt: fumble chance +30%.' },
  ]),
  ...at(['DE', 'DT'], [
    { id: 'undersized', label: 'Undersized', kind: 'physical', polarity: 'negative', tier: 'standard', icon: 'twig', conds: [bottom('weight', 15), bottom('strength', STD)], effect: 'Double teams wash him out of the play; runs at him gain 0.5 yd more.' },
  ]),
  ...at(['CB', 'S'], [
    { id: 'stiff-hips', label: 'Stiff Hips', kind: 'physical', polarity: 'negative', tier: 'standard', icon: 'pillar', conds: [bottom('agility', NEG)], effect: 'Hip flip on in-breaking routes costs an extra 0.08 s.' },
  ]),
];

// ------------------------------------------------------------------ OL units
// Metrics are the unit's mean of its five linemen: 'passBlock' (Pass Block
// Power, Pass Block Finesse, Anchor), 'runBlock' (Run Block Power and
// Finesse), 'pullMove', 'awareness'; 'z:u_*' are the unit's own results.

const unit = (defs: Omit<UnitTraitDef, 'pos'>[]): UnitTraitDef[] => defs.map((d) => ({ ...d, pos: ['OL'] as const }));

export const UNIT_TRAITS: readonly UnitTraitDef[] = unit([
  { id: 'road-graders', label: 'Road Graders', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'plow', conds: [top('runBlock')], effect: 'Inside runs gain 0.3 yd before contact; double teams move the defensive tackle off the ball.' },
  { id: 'pass-pro-wall', label: 'Pass-Pro Wall', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'wall', conds: [top('passBlock')], effect: 'Pocket-collapse time +0.2 s against a four-man rush.' },
  { id: 'athletic-line', label: 'Athletic Line', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'swing', conds: [top('pullMove')], effect: 'Pulls and screens: pulling linemen arrive 0.15 s sooner; outside zone reaches the edge.' },
  { id: 'smart-line', label: 'Smart Line', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'brain', conds: [top('awareness', ELITE)], effect: 'Stunts and blitzes are picked up correctly 20% more often.' },
  { id: 'ground-and-pound', label: 'Ground and Pound', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'grind', conds: [top('z:u_run', ELITE)], effect: 'Late in drives the Beasts\' front tires faster against the run (their stamina drain +10%).' },
  { id: 'turnstile', label: 'Turnstile', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'turnstile', conds: [bottom('passBlock', NEG)], effect: 'Pocket-collapse time −0.2 s.' },
  { id: 'sack-prone', label: 'Sack-Prone', kind: 'production', polarity: 'negative', tier: 'standard', icon: 'magnet', conds: [bottom('z:u_sack', NEG)], effect: 'Free rushers come through untouched 10% more often on blitzes.' },
]);
