// Passing round 6: the man under the ball in the AI book. For every throw
// (every base pass play against every call, a few seeds), from the release
// to the catch: how long the man it's thrown to stood (under 1.5 yd/s with
// the ball more than a quarter second away), how much he slowed (his
// slowest against his speed at the release) and where the ball met him.
// Grouped by how far the ball was off its meant spot.
//   node tools/run-ts.mjs tools/sim/p6stand.ts [--seeds=4] [--detail]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, input, PASS_PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 4);
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
type Row = { off: number; stood: number; slow: number; out: string; id: string; settle: boolean };
const rows: Row[] = [];
for (const play of PASS_PLAYS.filter((p) => !p.hailMary && p.type !== 'screen'))
  for (const def of DEF_CALLS)
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createPlay({ seed, offense: base.offense, defense: base.defense, play, def, los: 30, toGo: 10, user: false });
      let tgt = -1;
      let v0 = 0;
      let vMin = Infinity;
      let stood = 0;
      let off = 0;
      let settle = false;
      for (let k = 0; k < 900 && !s.result; k++) {
        if (s.phase === 'air' && s.ball.target >= 0) {
          const r = s.agents[s.ball.target]!;
          const sp = Math.hypot(r.vel.x, r.vel.y);
          if (tgt < 0) {
            tgt = r.i;
            v0 = sp;
            off = Math.hypot(s.ball.aim.x - s.ball.meant.x, s.ball.aim.y - s.ball.meant.y);
            settle = !!r.route && r.route.sit[r.route.pts.length - 1] === true;
          }
          vMin = Math.min(vMin, sp);
          if (sp < 1.5 && s.ball.arrive - s.t > 0.25) stood += 1 / 60;
        }
        stepPlay(s, input({}));
      }
      if (tgt < 0 || !s.result?.pass?.attempted) continue;
      const res = s.result.pass;
      rows.push({ off, stood, slow: v0 > 3 ? vMin / v0 : 1, out: res.complete ? 'C' : res.intercepted ? 'I' : 'X', id: `${play.id}/${def.id}/${seed}`, settle });
      if (args.has('detail') && stood > 0.2) console.log(`${play.id}/${def.id}/${seed} off ${off.toFixed(2)} stood ${stood.toFixed(2)} slow ${(v0 > 3 ? vMin / v0 : 1).toFixed(2)} settle ${settle} ${rows.at(-1)!.out}`);
    }
const bands: [string, (r: Row) => boolean][] = [
  ['on (<0.7)', (r) => r.off < 0.7],
  ['off 0.7-1.5', (r) => r.off >= 0.7 && r.off < 1.5],
  ['off 1.5-3', (r) => r.off >= 1.5 && r.off < 3],
  ['off 3+', (r) => r.off >= 3],
];
console.log('band          n   stood>0.2s  mean stood  slowest/v0  cmp   (settle routes excluded / only)');
for (const settle of [false, true])
  for (const [k, f] of bands) {
    const R = rows.filter((r) => f(r) && r.settle === settle);
    if (!R.length) continue;
    const m = (g: (r: Row) => number) => R.reduce((a, r) => a + g(r), 0) / R.length;
    console.log(`${(settle ? 'S ' : '  ') + k.padEnd(12)} ${String(R.length).padStart(4)}   ${((100 * R.filter((r) => r.stood > 0.2).length) / R.length).toFixed(0).padStart(4)}%      ${m((r) => r.stood).toFixed(2)}        ${m((r) => r.slow).toFixed(2)}     ${((100 * R.filter((r) => r.out === 'C').length) / R.length).toFixed(0)}%`);
  }
