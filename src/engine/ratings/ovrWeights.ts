import type { RatedPos } from './types';

// Position OVR weights (BRIEF "Overall rating and traits": "a weighted blend
// of the attributes that matter for the position, weights documented in one
// file"). Each row sums to 1. The blend is then standardized within the
// position pool and mapped through the same z→rating curve as every other
// skill, so OVR 90+ means All-Pro level at that position in every decade.
//
// Starting weights reflect what decides plays in the real-time sim: for a QB,
// accuracy and decisions over arm strength; for a corner, man coverage first.
// They are review items, not fitted values.

export const OVR_WEIGHTS: Record<RatedPos, Readonly<Record<string, number>>> = {
  QB: { shortAcc: 0.14, midAcc: 0.14, deepAcc: 0.12, decision: 0.14, throwPower: 0.08, awareness: 0.1, pocketPresence: 0.08, underPressure: 0.08, release: 0.05, throwOnRun: 0.04, scramble: 0.03 },
  RB: { vision: 0.14, breakTackle: 0.12, elusiveness: 0.12, speed: 0.12, acceleration: 0.08, ballSecurity: 0.08, trucking: 0.07, catching: 0.08, stiffArm: 0.04, routeRunning: 0.05, passBlock: 0.04, awareness: 0.06 },
  WR: { shortRoute: 0.14, deepRoute: 0.12, catching: 0.16, speed: 0.12, catchInTraffic: 0.09, beatPress: 0.07, rac: 0.07, spectacular: 0.06, acceleration: 0.06, awareness: 0.05, ballSecurity: 0.03, runBlock: 0.03 },
  TE: { catching: 0.15, shortRoute: 0.12, runBlock: 0.14, passBlock: 0.07, catchInTraffic: 0.1, deepRoute: 0.06, speed: 0.08, impactBlock: 0.06, beatPress: 0.04, rac: 0.06, spectacular: 0.03, awareness: 0.06, ballSecurity: 0.03 },
  OL: { pbPower: 0.18, pbFinesse: 0.18, rbPower: 0.16, rbFinesse: 0.12, anchor: 0.12, pullMove: 0.06, awareness: 0.1, strength: 0.08 },
  DE: { finesseMoves: 0.2, powerMoves: 0.18, blockShed: 0.14, pursuit: 0.1, tackle: 0.1, playRec: 0.08, speed: 0.08, acceleration: 0.06, awareness: 0.06 },
  DT: { powerMoves: 0.2, blockShed: 0.2, finesseMoves: 0.12, tackle: 0.12, playRec: 0.08, strength: 0.1, pursuit: 0.06, awareness: 0.06, acceleration: 0.06 },
  LB: { tackle: 0.16, pursuit: 0.14, playRec: 0.14, blockShed: 0.1, zoneCov: 0.1, hitPower: 0.07, speed: 0.08, manCov: 0.05, finesseMoves: 0.06, awareness: 0.06, powerMoves: 0.04 },
  CB: { manCov: 0.2, zoneCov: 0.16, press: 0.12, ballSkills: 0.12, speed: 0.12, acceleration: 0.06, agility: 0.06, playRec: 0.06, tackle: 0.05, awareness: 0.05 },
  S: { zoneCov: 0.18, ballSkills: 0.12, tackle: 0.12, playRec: 0.12, manCov: 0.1, hitPower: 0.08, pursuit: 0.08, speed: 0.08, awareness: 0.06, press: 0.06 },
};

/** The 4–6 attributes the draft card shows per position (BRIEF "Draft screen display"). */
export const CARD_ATTRS: Record<RatedPos, readonly string[]> = {
  QB: ['shortAcc', 'deepAcc', 'throwPower', 'decision', 'pocketPresence', 'scramble'],
  RB: ['speed', 'vision', 'elusiveness', 'trucking', 'catching', 'ballSecurity'],
  WR: ['speed', 'shortRoute', 'deepRoute', 'catching', 'catchInTraffic', 'rac'],
  TE: ['catching', 'shortRoute', 'catchInTraffic', 'runBlock', 'passBlock', 'speed'],
  OL: ['pbPower', 'pbFinesse', 'rbPower', 'anchor', 'awareness'],
  DE: ['finesseMoves', 'powerMoves', 'blockShed', 'speed', 'tackle'],
  DT: ['powerMoves', 'blockShed', 'finesseMoves', 'strength', 'tackle'],
  LB: ['tackle', 'pursuit', 'playRec', 'zoneCov', 'blockShed', 'speed'],
  CB: ['manCov', 'zoneCov', 'press', 'ballSkills', 'speed'],
  S: ['zoneCov', 'ballSkills', 'tackle', 'hitPower', 'speed'],
};
