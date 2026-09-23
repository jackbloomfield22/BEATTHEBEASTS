import type { AttributeResult, RatingInputs, TraitId, TraitResult } from './types';

// Traits (BRIEF "Overall rating and traits"): they come from attribute
// thresholds and stat signatures, never from `imp`. Each has one gameplay
// effect, which sim/attributeEffects.ts implements from M5 on:
//
//   deep-threat           defenders give a deeper cushion; +go-route separation at the break
//   route-technician      break sharpness bonus on every route stem
//   possession            higher catch floor on short/intermediate targets when hit in stride
//   contested-catch       bonus in 50/50 catch resolution with a defender in contact
//   yac-monster           first missed tackle after the catch is more likely
//   elusive               juke/spin success ceiling raised
//   bruiser               more yards after contact; tacklers lose leverage
//   workhorse             stamina drain from carries reduced
//   receiving-back        runs full WR route tree from the backfield
//   pocket-passer         steps up instead of bailing when the edge collapses
//   gunslinger            throws into tighter windows (more completions and INTs)
//   scrambler             breaks the pocket earlier and throws on the run
//   field-general         pre-snap audibles and faster progression reads
//   speed-rusher          wins around the edge earlier against slow feet
//   power-rusher          bull rush collapses the pocket faster against weak anchors
//   interior-wrecker      interior pass rush wins quicker vs guards/centers
//   ballhawk              breaks on the ball earlier and converts more PBUs into INTs
//   shutdown-corner       tighter trail in man; QBs throw his way less
//   enforcer              big-hit chance and fumble pressure raised
//   run-stuffer           holds the point of attack; fewer yards before contact
//   sideline-to-sideline  better pursuit angles on outside runs
//   coverage-linebacker   can carry TEs and RBs in man and match vertical routes

type Attrs = Record<string, AttributeResult>;
type ZOf = (key: string) => number | undefined;

interface TraitRule {
  id: TraitId;
  pos: readonly string[];
  /** Returns reasons when the rule fires, else null. */
  test: (a: (k: string) => number, z: ZOf, e: RatingInputs) => string[] | null;
}

const all = (...conds: [boolean, string][]): string[] | null => (conds.every(([c]) => c) ? conds.map(([, r]) => r) : null);
const fmt = (label: string, v: number, op: string, th: number): [boolean, string] => [
  op === '>=' ? v >= th : v < th,
  `${label} ${v.toFixed(0)} ${op === '>=' ? '≥' : '<'} ${th}`,
];

const RULES: readonly TraitRule[] = [
  { id: 'deep-threat', pos: ['WR', 'TE'], test: (a) => all(fmt('Speed', a('speed'), '>=', 90), fmt('Deep Route Running', a('deepRoute'), '>=', 86)) },
  { id: 'route-technician', pos: ['WR', 'TE'], test: (a) => all(fmt('Short Route Running', a('shortRoute'), '>=', 90), fmt('Deep Route Running', a('deepRoute'), '>=', 86)) },
  { id: 'possession', pos: ['WR', 'TE'], test: (a) => all(fmt('Catching', a('catching'), '>=', 88), fmt('Short Route Running', a('shortRoute'), '>=', 85), fmt('Speed', a('speed'), '<', 90)) },
  { id: 'contested-catch', pos: ['WR', 'TE'], test: (a) => all(fmt('Catch in Traffic', a('catchInTraffic'), '>=', 90), fmt('Spectacular Catch', a('spectacular'), '>=', 85)) },
  { id: 'yac-monster', pos: ['WR', 'TE', 'RB'], test: (a, _z, e) => (e.pos === 'RB' ? all(fmt('Elusiveness', a('elusiveness'), '>=', 88), fmt('Catching', a('catching'), '>=', 80)) : all(fmt('Run After Catch', a('rac'), '>=', 90))) },
  { id: 'elusive', pos: ['RB'], test: (a) => all(fmt('Elusiveness', a('elusiveness'), '>=', 90), fmt('Agility', a('agility'), '>=', 88)) },
  { id: 'bruiser', pos: ['RB'], test: (a) => all(fmt('Trucking', a('trucking'), '>=', 90), fmt('Break Tackle', a('breakTackle'), '>=', 80)) },
  {
    id: 'workhorse',
    pos: ['RB'],
    test: (a, _z, e) => {
      const c = e.stats.carriesPerGame;
      return all(fmt('Stamina', a('stamina'), '>=', 85), [!!c && c.v >= 18, c ? `${c.v.toFixed(1)} carries per game ≥ 18` : 'carries per game unknown']);
    },
  },
  { id: 'receiving-back', pos: ['RB'], test: (a) => all(fmt('Catching', a('catching'), '>=', 82), fmt('Route Running', a('routeRunning'), '>=', 78)) },
  { id: 'pocket-passer', pos: ['QB'], test: (a) => all(fmt('Pocket Presence', a('pocketPresence'), '>=', 88), fmt('Scramble', a('scramble'), '<', 70)) },
  { id: 'gunslinger', pos: ['QB'], test: (a) => all(fmt('Throw Power', a('throwPower'), '>=', 90), fmt('Decision Making', a('decision'), '<', 85)) },
  { id: 'scrambler', pos: ['QB'], test: (a) => all(fmt('Scramble', a('scramble'), '>=', 88), fmt('Throw on the Run', a('throwOnRun'), '>=', 80)) },
  { id: 'field-general', pos: ['QB'], test: (a) => all(fmt('Awareness', a('awareness'), '>=', 92), fmt('Decision Making', a('decision'), '>=', 90)) },
  { id: 'speed-rusher', pos: ['DE', 'LB'], test: (a) => all(fmt('Finesse Moves', a('finesseMoves'), '>=', 88), fmt('Speed', a('speed'), '>=', 80)) },
  { id: 'power-rusher', pos: ['DE', 'DT'], test: (a) => all(fmt('Power Moves', a('powerMoves'), '>=', 88), fmt('Strength', a('strength'), '>=', 80)) },
  { id: 'interior-wrecker', pos: ['DT'], test: (a) => all(fmt('Block Shedding', a('blockShed'), '>=', 88), [a('powerMoves') >= 86 || a('finesseMoves') >= 86, `Power ${a('powerMoves').toFixed(0)} / Finesse ${a('finesseMoves').toFixed(0)}, one ≥ 86`]) },
  { id: 'ballhawk', pos: ['CB', 'S', 'LB'], test: (a) => all(fmt('Ball Skills', a('ballSkills'), '>=', 90)) },
  { id: 'shutdown-corner', pos: ['CB'], test: (a) => all(fmt('Man Coverage', a('manCov'), '>=', 92), fmt('Press', a('press'), '>=', 85)) },
  { id: 'enforcer', pos: ['S', 'LB'], test: (a) => all(fmt('Hit Power', a('hitPower'), '>=', 90), fmt('Tackle', a('tackle'), '>=', 80)) },
  { id: 'run-stuffer', pos: ['DT', 'DE', 'LB'], test: (a) => all(fmt('Tackle', a('tackle'), '>=', 88), fmt('Block Shedding', a('blockShed'), '>=', 85)) },
  { id: 'sideline-to-sideline', pos: ['LB', 'S'], test: (a) => all(fmt('Pursuit', a('pursuit'), '>=', 92), fmt('Speed', a('speed'), '>=', 80)) },
  { id: 'coverage-linebacker', pos: ['LB'], test: (a) => all(fmt('Zone Coverage', a('zoneCov'), '>=', 82), fmt('Man Coverage', a('manCov'), '>=', 70)) },
];

export const TRAIT_LABELS: Record<TraitId, string> = {
  'deep-threat': 'Deep Threat',
  'route-technician': 'Route Technician',
  possession: 'Possession',
  'contested-catch': 'Contested Catch',
  'yac-monster': 'YAC Monster',
  elusive: 'Elusive',
  bruiser: 'Bruiser',
  workhorse: 'Workhorse',
  'receiving-back': 'Receiving Back',
  'pocket-passer': 'Pocket Passer',
  gunslinger: 'Gunslinger',
  scrambler: 'Scrambler',
  'field-general': 'Field General',
  'speed-rusher': 'Speed Rusher',
  'power-rusher': 'Power Rusher',
  'interior-wrecker': 'Interior Wrecker',
  ballhawk: 'Ballhawk',
  'shutdown-corner': 'Shutdown Corner',
  enforcer: 'Enforcer',
  'run-stuffer': 'Run Stuffer',
  'sideline-to-sideline': 'Sideline to Sideline',
  'coverage-linebacker': 'Coverage Linebacker',
};

export function deriveTraits(e: RatingInputs, attrs: Attrs, z: ZOf): TraitResult[] {
  const a = (k: string) => attrs[k]?.value ?? 0;
  const out: TraitResult[] = [];
  for (const r of RULES) {
    if (!r.pos.includes(e.pos)) continue;
    const reasons = r.test(a, z, e);
    if (reasons) out.push({ id: r.id, reasons });
  }
  return out;
}
