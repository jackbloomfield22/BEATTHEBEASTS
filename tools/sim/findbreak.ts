// M6.6: which scripted clip (src/game/clips.ts) gives a breakaway for the
// breakaway-camera stills (tools/shots/m66.spec.ts): the carrier 15 yd past
// the line at 6.3 yd/s or more, and for how long before the whistle.
//   node tools/run-ts.mjs tools/sim/findbreak.ts

import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, stepPlay, type SnapshotLike } from '@/sim';
import { CLIPS, CONCEPTS } from '@/game/clips';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

for (const c of [...CLIPS, ...CONCEPTS]) {
  const s = createPlay({ seed: c.seed, offense: rosters.offense, defense: rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: true });
  let first = -1;
  let last = -1;
  for (let k = 0; k < 900 && !s.result; k++) {
    stepPlay(s, c.script(s) as Parameters<typeof stepPlay>[1]);
    const a = s.carrier >= 0 ? s.agents[s.carrier]! : null;
    if (a && a.side === 'off' && s.phase === 'carrier' && a.pos.x - s.setup.los > 15 && Math.hypot(a.vel.x, a.vel.y) > 6.3) {
      if (first < 0) first = s.t;
      last = s.t;
    }
  }
  console.log(`${c.id.padEnd(16)} breakaway ${first < 0 ? '-' : `${first.toFixed(2)}..${last.toFixed(2)} s`}`);
}
