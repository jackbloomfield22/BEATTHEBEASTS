// The drop's rhythm against the routes' (docs/passing/PASSING2.md): for each
// pass play, when the QB's drop sets, when the ball comes out, and when the
// man it goes to came out of his break (the route's points). A 3-step's ball
// should come out on the slant's break; a 5-step and hitch on the dig's.
//   node tools/run-ts.mjs tools/sim/droprhythm.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { createPlay, practiceRosters, stepPlay, NEUTRAL, PASS_PLAYS, DEF_CALLS, type SnapshotLike } from '../../src/sim/index.ts';
import { sidesFor, cellSeed } from '../../src/sim/outcomes.ts';
import { routeOf } from '../../src/sim/ai.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const n = Number(process.argv[2] ?? 6);
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN);
type Row = { set: number[]; thr: number[]; brk: Map<string, number[]> };
for (const play of PASS_PLAYS.filter((p) => !p.situ && !p.unlock)) {
  const row: Row = { set: [], thr: [], brk: new Map() };
  for (const def of DEF_CALLS) {
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(r, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, toGo: 10, user: false });
      const brk = new Map<number, number>();
      let setAt = -1;
      const dropX = 35 - play.drop.depth;
      for (let t = 0; t < 60 * 12 && !s.result && s.phase !== 'air'; t++) {
        stepPlay(s, NEUTRAL);
        const qb = s.agents[s.qb]!;
        if (setAt < 0 && s.snapT >= 0 && qb.pos.x <= dropX + 0.15) setAt = s.t - s.snapT;
        for (const i of s.off) {
          const a = s.agents[i]!;
          if (a.route && a.route.idx >= 1 && !brk.has(i)) brk.set(i, s.t - s.snapT);
        }
      }
      if (setAt >= 0) row.set.push(setAt);
      if (s.phase === 'air' && s.ball.target >= 0) {
        row.thr.push(s.ball.releaseT - s.snapT);
        const tg = s.agents[s.ball.target]!;
        const name = routeOf(s, tg) ?? '?';
        const b = brk.get(tg.i);
        if (b !== undefined) row.brk.set(name, [...(row.brk.get(name) ?? []), s.ball.releaseT - s.snapT - b]);
      }
    }
  }
  console.log(
    `${play.id.padEnd(20)} ${play.drop.kind} set ${play.drop.set.toFixed(2)} (reached ${med(row.set).toFixed(2)}) throw med ${med(row.thr).toFixed(2)} | release − target's break: ` +
      [...row.brk]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([k, v]) => `${k} ${med(v) >= 0 ? '+' : ''}${med(v).toFixed(2)} (${v.length})`)
        .join(', '),
  );
}
