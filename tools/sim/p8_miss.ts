// Passing round 8: the balls that reach nobody's hands. For each AI throw to
// a receiver that ends with no touch, where it passed him: its closest
// approach to his hands point (yd), along his run (+ ahead of his centre)
// and across it, its height, and the ball's velocity against his.
//   node tools/run-ts.mjs tools/sim/p8_miss.ts [playsPerCell] [--routes=slant,dig]
import { readFileSync } from 'node:fs';
import { createPlay, NEUTRAL, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { DEF_CALLS, PASS_PLAYS } from '../../src/sim/plays.ts';
import { handsAt } from '../../src/sim/passing.ts';
import { routeOf } from '../../src/sim/ai.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const n = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 6);
const want = process.argv.find((a) => a.startsWith('--routes='))?.slice(9).split(',');
const HASHES = [3.08, 0, -3.08];
const PASS_BASE = PASS_PLAYS.filter((p) => !p.situ && !p.unlock);
const rows: { route: string; d: number; along: number; across: number; z: number; rel: number; out: string; seed: string }[] = [];
for (const play of PASS_BASE)
  for (const def of DEF_CALLS)
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(rosters, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      let tgt = -1;
      let best = { d: 99, along: 0, across: 0, z: 0, rel: 0 };
      let route = '';
      for (let t = 0; t < 60 * 40 && !s.result; t++) {
        stepPlay(s, NEUTRAL);
        if (s.ball.mode === 'air' && s.ball.target >= 0 && s.agents[s.ball.target]!.side === 'off') {
          if (tgt < 0) route = String(routeOf(s, s.agents[s.ball.target]!) ?? "");
          tgt = s.ball.target;
          const r = s.agents[tgt]!;
          const h = handsAt(r);
          const d = Math.hypot(s.ball.pos.x - h.x, s.ball.pos.y - h.y);
          if (d < best.d && s.ball.pos.z > 0.15) {
            const sp = Math.hypot(r.vel.x, r.vel.y);
            const ux = sp > 1 ? r.vel.x / sp : 1;
            const uy = sp > 1 ? r.vel.y / sp : 0;
            const dx = s.ball.pos.x - r.pos.x;
            const dy = s.ball.pos.y - r.pos.y;
            best = { d, along: dx * ux + dy * uy, across: -dx * uy + dy * ux, z: s.ball.pos.z, rel: (s.ball.vel.x - r.vel.x) * ux + (s.ball.vel.y - r.vel.y) * uy };
          }
        }
      }
      if (tgt < 0 || !s.result?.pass?.attempted) continue;
      if (want && !want.includes(route)) continue;
      const touched = s.events.some((e) => (e.type === 'catch' || e.type === 'drop' || e.type === 'deflection' || e.type === 'bobble' || e.type === 'interception'));
      rows.push({ route, ...best, out: s.result.pass.complete ? 'catch' : touched ? 'touched' : 'miss', seed: `${play.id}/${def.id}#${k}` });
    }
const miss = rows.filter((r) => r.out === 'miss');
console.log(`${rows.length} throws, ${miss.length} untouched`);
const b = (lo: number, hi: number) => miss.filter((r) => r.d >= lo && r.d < hi).length;
console.log('closest to his hands (yd):', [[0, 0.5], [0.5, 0.85], [0.85, 1.2], [1.2, 2], [2, 99]].map(([lo, hi]) => `${lo}-${hi} ${b(lo!, hi!)}`).join(', '));
const near = miss.filter((r) => r.d < 0.85);
for (const r of near.slice(0, 40)) console.log(`${r.route.padEnd(9)} d ${r.d.toFixed(2)} along ${r.along.toFixed(2)} across ${r.across.toFixed(2)} z ${r.z.toFixed(2)} relv ${r.rel.toFixed(1)}  ${r.seed}`);
