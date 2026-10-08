// One harness play, traced after the throw (docs/passing/PASSING2.md): the
// ball, the man it's thrown to and every defender within 25 yd of him, each
// quarter second, and the events. For reading a long completion.
//   node tools/run-ts.mjs tools/sim/deeptrace.ts <play> <def> <k>
import { readFileSync } from 'node:fs';
import { createPlay, practiceRosters, stepPlay, NEUTRAL, playById, defById, type SnapshotLike } from '../../src/sim/index.ts';
import { sidesFor, cellSeed } from '../../src/sim/outcomes.ts';
import { dist } from '../../src/sim/vec.ts';
import { openness } from '../../src/sim/ai.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const [pid, did, ks] = process.argv.slice(2);
const play = playById(pid!);
const def = defById(did!);
const k = Number(ks ?? 0);
const HASHES = [3.08, 0, -3.08];
const sd = sidesFor(r, play, def);
const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
let thrown = -1;
let seen = 0;
for (let t = 0; t < 60 * 40 && !s.result; t++) {
  stepPlay(s, NEUTRAL);
  for (; seen < s.events.length; seen++) {
    const e = s.events[seen]!;
    if (e.type === 'engage' || e.type === 'shed') continue;
    console.log(`  ${(e.t - s.snapT).toFixed(2)} ${e.type} ${(e.who ?? []).map((i) => s.agents[i]!.slot).join(',')} ${JSON.stringify(e.data ?? {})}`);
  }
  if (thrown < 0 && s.ball.mode === 'air' && s.ball.target >= 0) thrown = s.ball.target;
  if (process.argv.includes('--reads') && (s.phase === 'pocket' || s.phase === 'dropback') && s.tick % 6 === 0) {
    const qb = s.agents[s.qb]!;
    console.log(`${(s.t - s.snapT).toFixed(2)} read ${s.read.idx} ` + s.icons.map((k) => { const why: string[] = []; const o = openness(s, qb, s.agents[k]!, true, why); return `${s.agents[k]!.slot} ${o.sep.toFixed(1)}@${(o.at.x - s.setup.los).toFixed(0)} [${why.slice(-2).join(' ')}]`; }).join(' | '));
  }
  if (thrown >= 0 && s.tick % 15 === 0) {
    const tg = s.agents[s.carrier >= 0 ? s.carrier : thrown]!;
    const near = s.def.map((i) => s.agents[i]!).filter((d) => dist(d.pos, tg.pos) < 25).sort((a, b) => dist(a.pos, tg.pos) - dist(b.pos, tg.pos));
    console.log(`${(s.t - s.snapT).toFixed(2)} ${s.phase} ball ${s.ball.pos.x.toFixed(1)},${s.ball.pos.y.toFixed(1)},${s.ball.pos.z.toFixed(1)} ${tg.slot} ${tg.pos.x.toFixed(1)},${tg.pos.y.toFixed(1)} v ${tg.vel.x.toFixed(1)},${tg.vel.y.toFixed(1)} | ` + near.map((d) => `${d.slot} ${d.pos.x.toFixed(1)},${d.pos.y.toFixed(1)} v${d.vel.x.toFixed(1)},${d.vel.y.toFixed(1)} ${d.anim}${d.down ? ' DOWN' : ''}`).join(' | '));
  }
}
console.log(JSON.stringify(s.result));
