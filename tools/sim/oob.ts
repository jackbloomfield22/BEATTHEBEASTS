// Out-of-bounds audit: every play and split against every call, from both
// hashes and the middle, flipped and unflipped. Counts route runners who
// get within half a yard of a sideline while running their routes (before
// the throw), and players who step out during the play.
//   node tools/run-ts.mjs tools/sim/oob.ts [seedsPerCell]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, FIELD_HALF_W, NEUTRAL, PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { routeOf } from '../../src/sim/ai.ts';
import { sidesFor } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const n = Number(process.argv[2] ?? 1);
let plays = 0;
let near = 0;
let stepped = 0;
const where = new Map<string, number>();
for (const play of PLAYS) {
  for (const def of DEF_CALLS) {
    for (const ballY of [3.08, 0, -3.08]) {
      for (const flip of [false, true]) {
        for (let k = 0; k < n; k++) {
          const sd = sidesFor(r, play, def);
          const s = createPlay({ seed: 77 + k * 131 + plays, offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY, flip, toGo: 10, user: false });
          plays++;
          let flagged = false;
          const seen = new Set<number>();
          while (!s.result && s.tick < 2400) {
            stepPlay(s, NEUTRAL);
            for (const a of s.agents) {
              if (a.mem.outOfPlay && !seen.has(a.i)) {
                seen.add(a.i);
                if (process.argv.includes('--detail')) console.log(`  ${play.id} ${def.id} hash ${ballY} flip ${flip} ${a.slot} out at t=${(s.t - s.snapT).toFixed(2)} ${s.phase} target ${s.ball.target === a.i} pos ${(a.pos.x - 35).toFixed(1)},${a.pos.y.toFixed(1)} vel ${a.vel.x.toFixed(1)},${a.vel.y.toFixed(1)} route ${a.route ? a.route.idx + '/' + a.route.pts.length : '-'} anim ${a.anim} busy ${a.busy}`);
              }
            }
            if (s.phase === 'snap' || s.phase === 'dropback' || s.phase === 'pocket') {
              for (const i of s.off) {
                const a = s.agents[i]!;
                if (!a.route || flagged) continue;
                if (Math.abs(a.pos.y) > FIELD_HALF_W - 0.5) {
                  near++;
                  flagged = true;
                  const key = `${play.id} ${a.slot} ${routeOf(s, a)} hash ${ballY} flip ${flip}`;
                  where.set(key, (where.get(key) ?? 0) + 1);
                }
              }
            }
          }
          const outs = s.agents.filter((a) => a.mem.outOfPlay);
          if (outs.length) {
            stepped++;
            for (const a of outs) {
              const key = `OUT ${a.side} ${a.slot} ${a.side === 'off' ? routeOf(s, a) : ''} (${s.result?.reason})`;
              where.set(key, (where.get(key) ?? 0) + 1);
            }
          }
        }
      }
    }
  }
}
console.log(`${plays} plays: a route runner within 0.5 yd of the sideline on ${near}; someone stepped out on ${stepped}`);
for (const [k, v] of where) console.log(`  ${k}: ${v}`);
