// M6.6 diagnosis (Playtest 1: "carrier move prompts show up late"): how long
// after a user's ball carrier gets the ball the sim holds his three move
// options (mem.opts, set by carrierStep), per run scheme and after a catch.
//
//   node tools/run-ts.mjs tools/sim/optsdelay.ts

import { readFileSync } from 'node:fs';
import { createPlay, defById, input, NEUTRAL, PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '@/sim';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

for (const play of PLAYS.filter((p) => p.run)) {
  const delays: number[] = [];
  for (let seed = 1; seed <= 12; seed++) {
    const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play, def: defById('cover3'), los: 30, toGo: 10, user: true });
    stepPlay(s, input({ snap: true }));
    let got = -1;
    for (let k = 0; k < 400 && !s.result; k++) {
      stepPlay(s, input({ move: { x: 1, y: 0 } }));
      if (s.phase === 'carrier' && got < 0) got = s.t;
      if (got >= 0 && s.carrier >= 0 && s.agents[s.carrier]!.mem.opts !== undefined) {
        delays.push(s.t - got);
        break;
      }
    }
  }
  delays.sort((a, b) => a - b);
  const med = delays[Math.floor(delays.length / 2)] ?? NaN;
  console.log(`${play.id.padEnd(26)} ${play.run!.scheme.padEnd(12)} options after the handoff: median ${(med * 1000).toFixed(0)} ms, max ${((delays[delays.length - 1] ?? NaN) * 1000).toFixed(0)} ms (${delays.length} runs)`);
}

// After a catch: throw to the first read on a tap and see when the options land.
{
  const delays: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: PLAYS.find((p) => p.id === 'trips-stick')!, def: defById('cover3'), los: 30, toGo: 10, user: true });
    stepPlay(s, input({ snap: true }));
    for (let k = 0; k < 55; k++) stepPlay(s, NEUTRAL);
    stepPlay(s, input({ throwHeld: 1 }));
    stepPlay(s, NEUTRAL);
    let got = -1;
    for (let k = 0; k < 200 && !s.result; k++) {
      stepPlay(s, NEUTRAL);
      if (s.phase === 'carrier' && got < 0) got = s.t;
      if (got >= 0 && s.agents[s.carrier]!.mem.opts !== undefined) {
        delays.push(s.t - got);
        break;
      }
    }
  }
  console.log(`after a catch (${delays.length} catches): ${delays.map((d) => Math.round(d * 1000)).join(', ')} ms`);
}
