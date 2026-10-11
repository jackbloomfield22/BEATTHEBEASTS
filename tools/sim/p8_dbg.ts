import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING8 } from '../../src/game/clips.ts';
import { catchAhead } from '../../src/sim/passing.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const c = PASSING8.find((x) => x.id === 'p8-reach')!;
const s = createPlay({ seed: c.seed, offense: rosters.offense, defense: rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: true });
for (let k = 0; k < 1500 && !s.result; k++) {
  if (s.ball.mode === 'air' && s.ball.target >= 0 && s.t > 1.15) {
    const a = s.agents[s.ball.target]!;
    const ah = catchAhead(s, a);
    console.log(s.t.toFixed(3), ah ? `${ah.dt.toFixed(3)} -> ${(s.t + ah.dt).toFixed(3)}` : 'null');
  }
  const was = s.ball.mode;
  stepPlay(s, c.script(s));
  if (was === 'air' && s.ball.mode !== 'air') { console.log('caught at', s.t.toFixed(3)); break; }
}
