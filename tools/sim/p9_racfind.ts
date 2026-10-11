// Passing round 9: a quick out (or slant) caught by both Tyreek Hill and Wes Welker on the same snap, for the
// side-by-side broadcast video of the run after the catch (src/game/clips.ts PASSING9 p9-rac-a/-b).
//   node tools/run-ts.mjs tools/sim/p9_racfind.ts [play] [def] [at]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { userThrow } from '../../src/game/clips.ts';
void input;

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const [PLAY = 'doubles-quick-outs', DEF = 'cover3', AT = '30'] = process.argv.slice(2);
const play = PLAYS.find((q) => q.id === PLAY)!;
const run = (name: string, seed: number) => {
  const s = createPlay({ seed, offense: { ...rosters.offense, X: simPlayer(findStint(snap, name, 'WR')!, rosters.offense.X.num) }, defense: rosters.defense, play, def: defById(DEF), los: 30, toGo: 10, user: true });
  const icon = s.icons.findIndex((i) => s.agents[i]!.slot === 'X') + 1;
  const sc = userThrow({ icon, at: Number(AT) });
  for (let k = 0; k < 1500 && !s.result; k++) stepPlay(s, sc(s));
  const p = s.result?.pass;
  const x = s.agents.find((a) => a.slot === 'X')!;
  return p?.complete && p.target === x.i ? s.result!.yards - p.airYards : NaN;
};
for (let seed = 1; seed <= 60; seed++) {
  const h = run('Tyreek Hill', seed);
  const w = run('Wes Welker', seed);
  if (Number.isFinite(h) && Number.isFinite(w)) console.log(`seed ${seed}: Hill ${h.toFixed(1)} Welker ${w.toFixed(1)} diff ${(h - w).toFixed(1)}`);
}
