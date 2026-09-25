// Re-find the browser tests' seeds (e2e/practice.spec.ts) after a sim change:
// replays the tests' exact inputs on the Practice Field's first snap (Four
// Verticals from the Own 25, the coverage the seed draws) and lists the
// seeds whose play still does what the test needs.
//   node tools/run-ts.mjs tools/sim/e2eseeds.ts [maxSeed]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, input, NEUTRAL, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const max = Number(process.argv[2] ?? 600);
/** The coverage the Practice Field draws for a session's first snap (src/game/practice.ts callPlay). */
const coverFor = (seed: number) => DEF_CALLS[(seed >>> 4) % DEF_CALLS.length]!;
const make = (seed: number) => createPlay({ seed, offense: r.offense, defense: r.defense, play: playById('trips-four-verts'), def: coverFor(seed), los: 25, ballY: 0, toGo: 10, user: true, difficulty: 'pro', fatigue: {} });

/** The touchdown test: snap, 100 ticks, icon 1 held 3 ticks, then up-right 20 ticks from the first 10-tick check in the carrier phase, then up. */
function touchdownRun(seed: number): PlayState {
  const s = make(seed);
  const step = (f: InputFrame) => stepPlay(s, f);
  step(input({ snap: true }));
  for (let k = 1; k < 100 && !s.result; k++) step(NEUTRAL);
  for (let k = 0; k < 3 && !s.result; k++) step(input({ throwHeld: 1 }));
  // tickUntil: check, then 10 ticks, until carrier or dead.
  for (let k = 0; k < 900 && !s.result; k += 10) {
    if (s.phase === 'carrier' || s.phase === 'dead') break;
    for (let j = 0; j < 10 && !s.result; j++) step(NEUTRAL);
  }
  const d = Math.SQRT1_2;
  for (let k = 0; k < 20 && !s.result; k++) step(input({ move: { x: d, y: -d } }));
  for (let k = 0; k < 2400 && !s.result; k++) step(input({ move: { x: 1, y: 0 } }));
  return s;
}

const tds: string[] = [];
for (let seed = 1; seed < max; seed++) {
  const s = touchdownRun(seed);
  if (s.result?.touchdown && s.events.some((e) => e.type === 'touchdown')) tds.push(`${seed} (${coverFor(seed).id}, ${s.result.yards} yd)`);
}
console.log('touchdown seeds:', tds.slice(0, 12).join(', '));
/**
 * The full-play test: snap, to tick 100, icon 1 held 3 ticks; checks every 10
 * ticks for the throw, then for the catch; then up until the whistle. It
 * needs a catch and a gain of more than 10.
 */
function fullPlay(seed: number): PlayState {
  const s = make(seed);
  stepPlay(s, input({ snap: true }));
  while (s.tick < 100 && !s.result) stepPlay(s, NEUTRAL);
  for (let k = 0; k < 3 && !s.result; k++) stepPlay(s, input({ throwHeld: 1 }));
  for (let k = 0; k < 60 && !s.result; k += 10) {
    if (s.events.some((e) => e.type === 'throw')) break;
    for (let j = 0; j < 10 && !s.result; j++) stepPlay(s, NEUTRAL);
  }
  for (let k = 0; k < 900 && !s.result; k += 10) {
    if (s.phase === 'carrier' || s.phase === 'dead') break;
    for (let j = 0; j < 10 && !s.result; j++) stepPlay(s, NEUTRAL);
  }
  for (let k = 0; k < 2400 && !s.result; k++) stepPlay(s, input({ move: { x: 1, y: 0 } }));
  return s;
}
const full: string[] = [];
for (let seed = 1; seed < max && full.length < 10; seed++) {
  const s = fullPlay(seed);
  const thrown = s.events.find((e) => e.type === 'throw');
  if (!thrown || thrown.who![1] !== s.icons[0] || !s.events.some((e) => e.type === 'catch')) continue;
  if (!['tackle', 'touchdown', 'outOfBounds'].includes(s.result!.reason) || s.result!.yards <= 10 || !s.result!.offenseBall) continue;
  full.push(`${seed} (${coverFor(seed).id}, ${s.result!.reason} ${s.result!.yards} yd)`);
}
console.log('full-play seeds:', full.join(', '));

// The tackle test: Stick, snap, 78 ticks, icon 1 held 3 ticks, no more input: it needs a tackle or a sack.
const stick = (seed: number) => {
  const s = createPlay({ seed, offense: r.offense, defense: r.defense, play: playById('trips-stick'), def: coverFor(seed), los: 25, ballY: 0, toGo: 10, user: true, difficulty: 'pro', fatigue: {} });
  stepPlay(s, input({ snap: true }));
  while (s.tick < 78 && !s.result) stepPlay(s, NEUTRAL);
  for (let k = 0; k < 3 && !s.result; k++) stepPlay(s, input({ throwHeld: 1 }));
  for (let k = 0; k < 2400 && !s.result; k++) stepPlay(s, NEUTRAL);
  return s;
};
const tk: string[] = [];
for (let seed = 1; seed < 60 && tk.length < 8; seed++) {
  const s = stick(seed);
  if (s.events.some((e) => e.type === 'tackle' || e.type === 'sack')) tk.push(`${seed} (${coverFor(seed).id}, ${s.result!.reason} ${s.result!.yards})`);
}
console.log('stick tackle seeds:', tk.join(', '));
