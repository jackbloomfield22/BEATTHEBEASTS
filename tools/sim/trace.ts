// Trace AI-vs-AI passes: for each throw, the target's route, who was nearest
// him at the release and at the catch point, what they were assigned, and how
// it came out. For reading coverage by eye while tuning.
//   node tools/run-ts.mjs tools/sim/trace.ts <play> <def> [n] [--flip] [--hash=L|M|R]
import { readFileSync } from 'node:fs';
import { createPlay, defById, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { routeOf } from '../../src/sim/ai.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { dist } from '../../src/sim/vec.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [playId = 'trips-stick', defId = 'cover3', nArg = '8'] = args;
// As the harness plays them: the hash and the flip cycle with the seed (or fix them with --hash=L|M|R and --flip / --noflip).
const hashArg = process.argv.find((a) => a.startsWith('--hash='))?.slice(7);
const HASH = [3.08, 0, -3.08];
const play = playById(playId);
for (let k = 0; k < Number(nArg); k++) {
  const sd = sidesFor(r, play, defById(defId));
  const ballY = hashArg === 'L' ? 3.08 : hashArg === 'R' ? -3.08 : hashArg === 'M' ? 0 : HASH[k % 3]!;
  const flip = process.argv.includes('--flip') ? true : process.argv.includes('--noflip') ? false : k % 2 === 1;
  const seed = cellSeed(play, defById(defId), k);
  const s = createPlay({ seed, offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY, flip, toGo: 10, user: false });
  const lines: string[] = [];
  let thrown = false;
  while (!s.result && s.tick < 2400) {
    stepPlay(s, NEUTRAL);
    if (!thrown && s.ball.mode === 'air' && s.ball.target >= 0) {
      thrown = true;
      const t = s.agents[s.ball.target]!;
      const near = s.def.map((i) => s.agents[i]!).sort((a, b) => dist(a.pos, t.pos) - dist(b.pos, t.pos)).slice(0, 2);
      const as = (slot: string) => JSON.stringify(sd.def.assign[slot as keyof typeof sd.def.assign]);
      lines.push(`  throw t=${(s.t - s.snapT).toFixed(2)} to ${t.slot} (${routeOf(s, t)}) at (${(t.pos.x - 35).toFixed(1)}, ${t.pos.y.toFixed(1)}) aim (${(s.ball.aim.x - 35).toFixed(1)}, ${s.ball.aim.y.toFixed(1)}) hang ${(s.ball.arrive - s.t).toFixed(2)}`);
      for (const d of near) lines.push(`    ${d.slot.padEnd(4)} ${d.p.pos} ${dist(d.pos, t.pos).toFixed(1)} yd from him, ${dist(d.pos, s.ball.aim).toFixed(1)} from the catch point  ${as(d.slot)}`);
    }
  }
  const res = s.result!;
  lines.unshift(`k ${k} seed ${seed} hash ${ballY} flip ${flip}: ${res.reason} ${res.yards} yd${res.sack ? ' SACK' : ''} sep ${res.pass?.sep ?? '-'} contest ${res.pass?.contest ?? '-'} pressure@${s.pressureT >= 0 ? (s.pressureT - s.snapT).toFixed(2) : '-'}`);
  console.log(lines.join('\n'));
}
