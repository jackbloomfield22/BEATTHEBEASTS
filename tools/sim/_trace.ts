import { readFileSync } from 'node:fs';
import { createPlay, NEUTRAL, practiceRosters, playById, defById, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const s = createPlay({ seed: 1000 + Number(process.argv[4] ?? 0) * 7919, offense: rosters.offense, defense: rosters.defense, play: playById(process.argv[2]!), def: defById(process.argv[3]!), los: 35, toGo: 10, user: false });
let tgt = -1;
for (let t = 0; t < 2400 && !s.result; t++) {
  stepPlay(s, NEUTRAL);
  if (s.ball.mode === 'air' && tgt < 0) { tgt = s.ball.target; console.log('THROW t', s.t.toFixed(2), 'to', s.agents[tgt]!.slot, 'aim', s.ball.aim.x.toFixed(1), s.ball.aim.y.toFixed(1), 'arrive', s.ball.arrive.toFixed(2)); }
  if (s.tick % 12 === 0 || (tgt >= 0 && s.phase === 'air' && s.tick % 6 === 0)) {
    const r = tgt >= 0 ? s.agents[tgt]! : null;
    if (!r) continue;
    const ds = s.def.map((i) => s.agents[i]!).sort((a, b) => Math.hypot(a.pos.x - r.pos.x, a.pos.y - r.pos.y) - Math.hypot(b.pos.x - r.pos.x, b.pos.y - r.pos.y));
    const d = ds[0]!;
    console.log(s.t.toFixed(2), s.phase, 'R', r.pos.x.toFixed(1), r.pos.y.toFixed(1), 'v', Math.hypot(r.vel.x, r.vel.y).toFixed(1), '|', d.slot, d.pos.x.toFixed(1), d.pos.y.toFixed(1), 'v', Math.hypot(d.vel.x, d.vel.y).toFixed(1), 'vmax R', r.fx.vmax.toFixed(1), 'D', d.fx.vmax.toFixed(1));
  }
}
console.log(s.result, s.events.filter(e => ['catch','tackle','deflection','drop'].includes(e.type)).map(e => e.type));
