import type { RatedPos } from '../types';
import type { Cond, TraitDef } from './types';

// Offensive traits (QB, RB, WR, TE). Gates are percentiles of the position
// pool (types.ts): ELITE = top 10%, STD = top 25%, NEG = bottom 10%.
// Every effect is one line; sim/attributeEffects.ts implements them from M5
// and the balance harness tunes the magnitudes.

export const ELITE = 10;
export const STD = 25;
export const NEG = 10;

export const top = (m: string, gate = STD): Cond => ({ m, side: 'top', gate });
export const bottom = (m: string, gate = NEG): Cond => ({ m, side: 'bottom', gate });

type Def = Omit<TraitDef, 'pos'>;
const at = (pos: RatedPos | readonly RatedPos[], defs: Def[]): TraitDef[] => defs.map((d) => ({ ...d, pos: typeof pos === 'string' ? [pos] : pos }));

// ------------------------------------------------------------------ QB

const QB: TraitDef[] = at('QB', [
  // Arm
  { id: 'cannon', label: 'Cannon', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'rocket', conds: [top('throwPower', ELITE)], effect: 'Bullet passes leave 2 mph faster and max air distance grows 4 yd; tight-window throws arrive before the defender closes.' },
  { id: 'deep-ball-artist', label: 'Deep Ball Artist', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'target', conds: [top('deepAcc', ELITE)], effect: 'Placement error on throws of 30+ air yards shrinks 20%; lead-shoulder deep balls drop in stride.' },
  { id: 'laser', label: 'Laser', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'crosshair', conds: [top('midAcc', 20), top('throwPower', 20)], effect: 'Bullet passes over the middle (10–20 yd) keep full accuracy; no bullet-throw error penalty at that depth.' },
  { id: 'quick-trigger', label: 'Quick Trigger', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'stopwatch', conds: [top('release', ELITE)], effect: 'Wind-up to release is 0.04 s faster than his Release rating alone; hot routes beat the blitz.' },
  // Pocket and legs
  { id: 'escape-artist', label: 'Escape Artist', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'escape', conds: [top('pocketPresence'), top('scramble')], effect: 'First unblocked rusher misses the sack 20% more often when the QB is moving.' },
  { id: 'dual-threat', label: 'Dual Threat', kind: 'physical', polarity: 'positive', tier: 'elite', icon: 'dual', conds: [top('scramble', ELITE), top('speed', ELITE)], effect: 'Defenders assigned to spy him react 0.1 s later; zone defenders bail off coverage sooner when he breaks the pocket.' },
  { id: 'off-platform', label: 'Off-Platform', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'tilt', conds: [top('throwOnRun', ELITE)], effect: 'Throwing on the run or off-balance costs half the usual accuracy penalty.' },
  { id: 'climber', label: 'Climber', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'climb', conds: [top('pocketPresence', 20), bottom('scramble', 40)], effect: 'Steps up into the pocket instead of bailing when the edge collapses; pocket-collapse time +0.15 s when he climbs.' },
  { id: 'designed-runner', label: 'Designed Runner', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'runner', conds: [top('z:q_rush', ELITE)], effect: 'Unlocks QB draws and zone-read keepers in the playbook; ball security on QB runs uses his full rating.' },
  { id: 'statue', label: 'Statue', kind: 'physical', polarity: 'negative', tier: 'standard', icon: 'pillar', conds: [bottom('scramble', NEG), bottom('speed', 15)], effect: 'Can only step up or drift inside the pocket; any scramble outside the tackle box is slowed 15%.' },
  // Mind
  { id: 'surgeon', label: 'Surgeon', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'scalpel', conds: [top('shortAcc', ELITE), top('midAcc', ELITE)], effect: 'Ball placement on short and intermediate throws: back-shoulder and away-from-leverage placements cost no accuracy.' },
  { id: 'field-general', label: 'Field General', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'crown', conds: [top('awareness', ELITE)], effect: 'Sees the Beasts\' coverage shell pre-snap (shown on the play-call screen) and gets a fifth audible slot.' },
  { id: 'game-manager', label: 'Game Manager', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'clipboard', conds: [top('decision'), bottom('z:q_yds', 40)], effect: 'Throw-away and checkdown decisions are automatic under pressure; interception chance on forced throws −25%.' },
  { id: 'ice-veins', label: 'Ice in His Veins', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'snowflake', conds: [top('underPressure', ELITE)], effect: 'Pressure widens his error cone half as much; on the final drive the crowd noise wobble is removed.' },
  { id: 'pre-snap-wizard', label: 'Pre-Snap Wizard', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'eye', conds: [top('awareness'), top('z:q_sack')], effect: 'Blitzers are highlighted before the snap; a hot-route change costs no play-clock time.' },
  { id: 'checkdown-charlie', label: 'Checkdown Charlie', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'hook', conds: [top('z:q_cmp'), bottom('z:q_ypcmp', STD)], effect: 'Throws to the back or tight end in the flat get +5% completion; his deep reads come up 0.2 s later.' },
  // Style
  { id: 'gunslinger', label: 'Gunslinger', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'flame', conds: [top('throwPower'), bottom('decision', 40)], effect: 'Will fit balls into windows a step tighter: more completions against tight coverage, more interceptions.' },
  { id: 'volume-passer', label: 'Volume Passer', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'stack', conds: [top('z:q_yds', ELITE), top('t:t_att', STD)], effect: 'No stamina or accuracy drop late in drives; the two-minute drill snaps 1 s faster.' },
  { id: 'efficiency-king', label: 'Efficiency King', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'percent', conds: [top('z:q_rate', ELITE)], effect: 'The coordinator AI\'s suggested play for him is right 10% more often (it reads his best matchups).' },
  { id: 'red-zone-sniper', label: 'Red Zone Sniper', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'flag', conds: [top('z:q_td', ELITE)], effect: 'Inside the 20, placement error on throws into the end zone shrinks 20%.' },
  // Negative
  { id: 'turnover-machine', label: 'Turnover Machine', kind: 'production', polarity: 'negative', tier: 'standard', icon: 'warning', conds: [bottom('z:q_int', NEG)], effect: 'Tipped and contested throws are intercepted 25% more often.' },
  { id: 'sack-magnet', label: 'Sack Magnet', kind: 'production', polarity: 'negative', tier: 'standard', icon: 'magnet', conds: [bottom('z:q_sack', NEG)], effect: 'Holds the ball 0.2 s longer before the throw-away option appears under pressure.' },
  { id: 'happy-feet', label: 'Happy Feet', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'feet', conds: [bottom('underPressure', NEG)], effect: 'A rusher within 2 yd widens his error cone 25% more than his Under Pressure alone.' },
  { id: 'noodle-arm', label: 'Noodle Arm', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'twig', conds: [bottom('throwPower', NEG)], effect: 'Max air distance −5 yd; deep outs to the far sideline hang long enough for corners to close.' },
]);

// ------------------------------------------------------------------ RB

const RB: TraitDef[] = at('RB', [
  // Speed and power
  { id: 'home-run-hitter', label: 'Home Run Hitter', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'bolt', conds: [top('speed'), top('z:r_ypc')], effect: 'Once past the second level, pursuit angles on him are 10% worse: long runs finish as touchdowns.' },
  { id: 'burst', label: 'Burst', kind: 'physical', polarity: 'positive', tier: 'elite', icon: 'burst', conds: [top('acceleration', ELITE)], effect: 'Reaches top speed 0.15 s sooner out of a cut or through the hole.' },
  { id: 'battering-ram', label: 'Battering Ram', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'ram', conds: [top('trucking', ELITE)], effect: 'Head-on contact knocks the tackler back: +0.8 yd after contact and a chance to run through arm tackles.' },
  { id: 'stiff-arm-king', label: 'Stiff Arm King', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'palm', conds: [top('stiffArm', ELITE)], effect: 'Stiff arm against a tackler coming from the side sheds him 20% more often.' },
  { id: 'tackle-breaker', label: 'Tackle Breaker', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'shatter', conds: [top('breakTackle', ELITE)], effect: 'The first tackle attempt of every run needs a clean wrap; glancing hits are shrugged off.' },
  { id: 'low-center', label: 'Low Center of Gravity', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'anvil', conds: [bottom('height', STD), top('breakTackle')], effect: 'Tacklers hitting above the waist lose leverage: balance recovery after contact is 30% faster.' },
  { id: 'freight-train', label: 'Freight Train', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'train', conds: [top('weight'), top('speed')], effect: 'Momentum at full speed counts 15% more in collisions: DBs meeting him in the open field bounce off.' },
  // Moves
  { id: 'ankle-breaker', label: 'Ankle Breaker', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'zigzag', conds: [top('elusiveness', ELITE)], effect: 'Juke success ceiling +10%; a defender who bites falls down.' },
  { id: 'spin-cycle', label: 'Spin Cycle', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'spiral', conds: [top('elusiveness'), top('agility', ELITE)], effect: 'Spin moves keep 90% of his speed and can be chained twice in one run.' },
  { id: 'hurdler', label: 'Hurdler', kind: 'physical', polarity: 'positive', tier: 'elite', icon: 'hurdle', conds: [top('jumping', ELITE)], effect: 'Unlocks the hurdle move against low tackles; success scales with Jumping.' },
  { id: 'jump-cut', label: 'Jump Cut', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'cut', conds: [top('agility'), top('vision')], effect: 'Lateral jump cuts in the backfield cost no speed; bounce-outs find the edge.' },
  { id: 'one-cut', label: 'One-Cut', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'rail', conds: [top('acceleration', 20), top('vision', 20)], effect: 'Plant-and-go cuts on zone runs lose 50% less speed; he gets downhill a step faster.' },
  { id: 'patient-runner', label: 'Patient Runner', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'hourglass', conds: [top('vision', ELITE)], effect: 'Blocks develop for him: the running lane highlight appears 0.2 s earlier and cutback lanes stay open longer.' },
  // Role
  { id: 'workhorse', label: 'Workhorse', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'battery', conds: [top('z:r_car', ELITE), top('stamina')], effect: 'Stamina drain from carries halved; no fatigue fumble risk late in drives.' },
  { id: 'committee-back', label: 'Change of Pace', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'split', conds: [bottom('z:r_car', 40), top('z:r_ypc')], effect: 'Fresh legs: +3% speed on his first two touches of a drive, faster stamina drain after that.' },
  { id: 'receiving-back', label: 'Receiving Back', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'hand', conds: [top('catching', ELITE), top('routeRunning')], effect: 'Runs the full receiver route tree from the backfield (wheel, option, angle).' },
  { id: 'third-down-back', label: 'Third-Down Back', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'shield', conds: [top('passBlock'), top('catching')], effect: 'Blitz pickup and a checkdown release on the same snap: picks up the rusher, then leaks out if nobody comes.' },
  { id: 'goal-line-hammer', label: 'Goal Line Hammer', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'anvil', conds: [top('t:t_tdtouch', ELITE)], effect: 'Inside the 5, contact at the goal line falls forward: +1 yd on stopped runs.' },
  { id: 'grinder', label: 'Grinder', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'grind', conds: [bottom('z:r_ypc', STD), top('z:r_car')], effect: 'Never loses yards on inside runs: a stuffed run falls forward for 1 yd instead of a loss.' },
  { id: 'big-play-back', label: 'Big-Play Back', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'star', conds: [top('z:r_ypc', ELITE)], effect: 'Breakaway chance on any run that reaches the second level +15%.' },
  { id: 'scatback', label: 'Scatback', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'sway', conds: [bottom('weight', STD), top('z:r_recn'), top('elusiveness')], effect: 'Lines up in the slot as a receiver; first defender in space misses 10% more often.' },
  // Negative
  { id: 'fumble-risk', label: 'Fumble Risk', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'drop', conds: [bottom('ballSecurity', NEG)], effect: 'Fumble chance on big hits +40%.' },
  { id: 'straight-line', label: 'Straight-Line Only', kind: 'physical', polarity: 'negative', tier: 'standard', icon: 'rail', conds: [top('speed'), bottom('agility', STD)], effect: 'Cuts sharper than 45° cost 20% more speed.' },
  { id: 'dancer', label: 'Dancer', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'sway', conds: [top('elusiveness'), bottom('vision', STD)], effect: 'Hesitates in the backfield: a 0.15 s stutter before hitting the hole unless the lane is clean.' },
  { id: 'liability-protection', label: 'Liability in Protection', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'turnstile', conds: [bottom('passBlock', NEG)], effect: 'Loses blitz pickups 30% more often; keep him out of max-protect calls.' },
]);

// ------------------------------------------------------------------ WR and TE (shared definitions list the positions)

const REC: TraitDef[] = [
  // Speed and body
  ...at('WR', [
    { id: 'burner', label: 'Burner', kind: 'physical', polarity: 'positive', tier: 'elite', icon: 'bolt', conds: [top('speed', ELITE)], effect: 'Defenders in off coverage give 2 yd more cushion; he wins even-up footraces on go routes.' },
    { id: 'long-strider', label: 'Long Strider', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'ruler', conds: [top('height'), top('speed')], effect: 'Top speed is reached a step later but held 10 yd longer on vertical routes.' },
    { id: 'skyscraper', label: 'Skyscraper', kind: 'physical', polarity: 'positive', tier: 'elite', icon: 'tower', conds: [top('height', ELITE), top('jumping')], effect: 'Catch radius +6 inches at the high point; overthrows become catchable.' },
    { id: 'big-body', label: 'Big Body', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'weight', conds: [top('weight', 15), top('catchInTraffic', 15)], effect: 'Boxes out defenders on slants and curls: contested catches in front of the defender +10%.' },
    { id: 'twitch', label: 'Twitch', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'spring', conds: [top('acceleration', 15), top('agility', 15)], effect: 'Breaks on short routes are 0.05 s sharper; option routes read the defender a beat sooner.' },
    // Route and release
    { id: 'route-technician', label: 'Route Technician', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'route', conds: [top('shortRoute'), top('deepRoute')], effect: 'Break sharpness bonus on every route stem; defenders can\'t sit on one route family.' },
    { id: 'release-artist', label: 'Release Artist', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'release', conds: [top('beatPress', ELITE)], effect: 'Press jams are beaten 25% more often and never knock him off his stem.' },
    { id: 'slot-weapon', label: 'Slot Weapon', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'slot', conds: [top('shortRoute'), bottom('height', 30)], effect: 'From the slot, option routes read the leverage of the nearest defender automatically.' },
    { id: 'deep-threat', label: 'Deep Threat', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'arrowUp', conds: [top('deepRoute'), top('speed')], effect: 'Safeties shade his way: the deep third over him starts 2 yd deeper.' },
    { id: 'head-fake', label: 'Head Fake', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'loop', conds: [top('agility'), top('shortRoute')], effect: 'Double moves freeze man defenders 0.1 s longer.' },
    // Hands
    { id: 'glue-hands', label: 'Glue Hands', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'glove', conds: [top('catching', ELITE)], effect: 'Catch probability floor on catchable balls hit in stride +5%; no drops on routine catches.' },
    { id: 'sideline-toe-tap', label: 'Sideline Toe-Tap', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'toe', conds: [top('catching'), top('awareness', ELITE)], effect: 'Always gets both feet in on sideline catches (no out-of-bounds incompletions on catchable balls).' },
    { id: 'highlight-reel', label: 'Highlight Reel', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'sparkle', conds: [top('spectacular', ELITE)], effect: 'One-handed and diving catches succeed 15% more often.' },
    { id: 'contested-catch-king', label: 'Contested Catch King', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'fist', conds: [top('catchInTraffic', ELITE)], effect: 'Wins 50/50 balls with a defender in contact 15% more often.' },
    { id: 'blocking-wr', label: 'Blocking WR', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'blocker', conds: [top('runBlock', ELITE)], effect: 'Stalk blocks on outside runs and screens hold 0.4 s longer.' },
    // Production
    { id: 'chain-mover', label: 'Chain Mover', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'chain', conds: [top('z:w_catch', 15), bottom('z:w_ypr', 50)], effect: 'On third down, short routes past the sticks get +5% catch probability.' },
    { id: 'alpha', label: 'Alpha', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'alpha', conds: [top('z:w_recn', ELITE), top('z:w_yds', STD)], effect: 'The Beasts roll coverage to him (a safety shades his side); every other receiver sees softer coverage.', note: 'Target share proxy: targets exist only from 1992, so this reads receptions per game as a share of a league team\'s completions (plus receiving yards per game vs league team passing).' },
    { id: 'big-play', label: 'Big Play', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'star', conds: [top('z:w_ypr', ELITE)], effect: 'After the catch in the open field, his first missed tackle leads to +3 yd more on average.' },
    { id: 'home-run-threat', label: 'Home Run Threat', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'bolt', conds: [top('z:w_tdrate'), top('z:w_ypr')], effect: 'Catches beyond 20 air yards break for the end zone: pursuit angles on him 10% worse.' },
  ]),
  ...at(['WR', 'TE'], [
    { id: 'mismatch', label: 'Mismatch', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'tower', conds: [top('jumping'), top('catchInTraffic')], effect: 'Against a smaller defender, contested catches at the high point +10%.' },
    { id: 'yac-monster', label: 'YAC Monster', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'yac', conds: [top('rac', ELITE)], effect: 'The first missed tackle after the catch is 20% more likely.' },
    { id: 'red-zone-threat', label: 'Red Zone Threat', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'flag', conds: [top('z:w_tdrate', ELITE)], effect: 'Inside the 20, fade and back-shoulder catches +10%.' },
    { id: 'drops', label: 'Drops', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'drop', conds: [bottom('catching', NEG)], effect: 'Routine catches carry a 4% drop chance on top of his Catching.' },
  ]),
  ...at('WR', [
    { id: 'one-speed', label: 'One-Speed', kind: 'physical', polarity: 'negative', tier: 'standard', icon: 'gauge', conds: [bottom('acceleration', NEG), bottom('agility', 15)], effect: 'No change of pace: comeback and curl breaks lose 0.1 s of separation.' },
    { id: 'body-catcher', label: 'Body Catcher', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'hand', conds: [bottom('catching', STD), top('catchInTraffic')], effect: 'Balls away from his frame are caught 10% less often; high and low placements hurt him.' },
    { id: 'alligator-arms', label: 'Alligator Arms', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'warning', conds: [bottom('catchInTraffic', NEG), bottom('catching', 50)], effect: 'With a defender closing, catch probability on crossing routes −10%.' },
  ]),
  // TE-only
  ...at('TE', [
    { id: 'seam-stretcher', label: 'Seam Stretcher', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'arrowUp', conds: [top('speed'), top('deepRoute')], effect: 'Linebackers can\'t carry him up the seam: separation on seam routes +0.15 s.' },
    { id: 'move-te', label: 'Move TE', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'slot', conds: [top('shortRoute'), bottom('runBlock', 40)], effect: 'Can align in the slot or out wide; runs WR route concepts.' },
    { id: 'safety-blanket', label: 'Safety Blanket', kind: 'production', polarity: 'positive', tier: 'standard', icon: 'chain', conds: [top('z:w_catch'), bottom('z:w_ypr', 50)], effect: 'When the QB is under pressure, he breaks open toward the QB 0.2 s sooner.' },
    { id: 'sure-hands', label: 'Sure Hands', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'glove', conds: [top('catching', ELITE)], effect: 'Catch probability floor over the middle +5%; hits after the catch never cause drops.' },
    { id: 'big-slot', label: 'Big Slot', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'weight', conds: [top('shortRoute'), top('height')], effect: 'Against nickel corners, catches in traffic +10%.' },
    { id: 'volume-te', label: 'Volume TE', kind: 'production', polarity: 'positive', tier: 'elite', icon: 'stack', conds: [top('z:w_recn', ELITE)], effect: 'First read on the coordinator AI\'s suggested plays; the QB\'s progression starts with him.' },
    { id: 'sixth-lineman', label: 'Sixth Lineman', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'wall', conds: [top('runBlock', ELITE)], effect: 'Seals the edge on runs to his side: the defender he blocks is removed from the play 0.3 s longer.' },
    { id: 'complete-te', label: 'Complete TE', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'combo', conds: [top('shortRoute'), top('runBlock')], effect: 'Run and pass plays from the same look: defenders can\'t key on his alignment (play-action fools them 0.1 s longer).' },
    { id: 'pass-pro-te', label: 'Pass Pro TE', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'shield', conds: [top('passBlock', ELITE)], effect: 'Chip-and-release or full protection against an edge rusher: delays the rush 0.3 s.' },
    { id: 'lead-blocker', label: 'Lead Blocker', kind: 'technical', polarity: 'positive', tier: 'elite', icon: 'plow', conds: [top('impactBlock', ELITE)], effect: 'As an H-back or wing, his lead block on the linebacker pancakes 20% more often.' },
    { id: 'h-back', label: 'H-Back', kind: 'technical', polarity: 'positive', tier: 'standard', icon: 'swing', conds: [top('passBlock'), top('catching')], effect: 'Aligns in the backfield: can lead-block, chip or run swing routes from there.' },
    { id: 'basketball-body', label: 'Basketball Body', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'tower', conds: [top('height'), top('jumping')], effect: 'Posts up defenders in the end zone: jump-ball catch radius +4 inches.' },
    { id: 'bruiser-te', label: 'Bruiser', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'boulder', conds: [top('weight'), top('rac')], effect: 'After the catch, DBs tackling him alone lose the collision 20% more often.' },
    { id: 'athlete-te', label: 'Athlete', kind: 'physical', polarity: 'positive', tier: 'standard', icon: 'spring', conds: [top('speed'), top('agility')], effect: 'Moves like a receiver: route breaks use his Agility without the tight-end size penalty.' },
    { id: 'liability-blocker', label: 'Liability Blocker', kind: 'technical', polarity: 'negative', tier: 'standard', icon: 'turnstile', conds: [bottom('runBlock', NEG)], effect: 'Edge defenders shed his blocks 30% faster; runs to his side lose the edge.' },
    { id: 'stone-feet', label: 'Stone Feet', kind: 'physical', polarity: 'negative', tier: 'standard', icon: 'pillar', conds: [bottom('speed', 15), bottom('agility', STD)], effect: 'Route breaks lose 0.1 s of separation; linebackers carry him in man.' },
  ]),
];

export const OFFENSE_TRAITS: readonly TraitDef[] = [...QB, ...RB, ...REC];
