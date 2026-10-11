// Passing round 7: the go routes behind tests/sim.test.ts "catches in stride": his speed at the catch against his top speed, the slowest he ran with the ball in the air, and how far the throw was off.
//   node tools/run-ts.mjs tools/sim/p7stride.ts
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
for (let k = 0; k < 40; k++) {
  const s = createPlay({ seed: 300 + k, offense: rosters.offense, defense: rosters.defense, play: playById('trips-four-verts'), def: defById('cover3'), los: 35, toGo: 10, user: true });
  stepPlay(s, input({ snap: true }));
  const icon = 1 + (k % 4);
  let before = -1, caught = false, minv = 9;
  for (let t = 0; t < 2400 && !s.result && !caught; t++) {
    const f = t < 95 ? NEUTRAL : t < 100 ? input({ throwHeld: icon }) : NEUTRAL;
    const r = s.agents[s.icons[icon - 1]!]!;
    before = Math.hypot(r.vel.x, r.vel.y) / r.fx.vmax;
    if (s.phase === 'air') minv = Math.min(minv, before);
    const n = s.events.length;
    stepPlay(s, f);
    caught = s.events.slice(n).some((e) => e.type === 'catch' && e.who![0] === r.i);
  }
  if (!caught || (s.pass?.airYards ?? 0) < 15) continue;
  const th = s.events.find((e) => e.type === 'throw');
  console.log(`k ${k} icon ${icon} at catch ${before.toFixed(2)} min ${minv.toFixed(2)} off ${th?.data?.off} air ${s.pass?.airYards}`);
}
