// Passing round 5 (docs/passing/PASSING5.md): the late out's wait. Round
// four's late out comes back to the ball inside the sideline, but on a
// ball lofted over the flat defender his plant was timed on the driven
// ball and he stood waiting for it. For each late out (tools/sim/lateout.ts's
// cases), the throw's hang and kind, how long he stood (under WAIT_V yd/s)
// in the last second before the ball got to him, his speed back toward the
// line as it got there, and what happened.
//   node tools/run-ts.mjs tools/sim/p5lateout.ts [--seeds=N]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, TICK, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { userThrow } from '../../src/game/clips.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 8);
/** Standing: slower than this (yd/s). */
const WAIT_V = 1.5;
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const CASES: { id: string; play: string; icon: number; hot?: RouteName; brk: number }[] = [
  { id: 'out (X)', play: 'doubles-curls', icon: 1, hot: 'out', brk: 100 },
  { id: 'qout', play: 'singleback-quick-outs', icon: 1, brk: 64 },
];
console.log('case      late  kind     n   cmp  hang(s)  stood(s)  back to the line at the catch (yd/s)');
for (const c of CASES)
  for (const late of [20, 40]) {
    const rows = new Map<string, { hang: number; stood: number; back: number; ok: boolean }[]>();
    for (const def of ['cover3', 'cover1', 'cover2', 'cover4'])
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s = createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
        const f = userThrow({ icon: c.icon, at: c.brk + late, hot: c.hot });
        const trace: { t: number; sp: number; vx: number }[] = [];
        let kind = '';
        let hang = 0;
        for (let k = 0; k < 900 && !s.result; k++) {
          if (s.phase === 'air' && s.ball.target >= 0) {
            const a = s.agents[s.ball.target]!;
            trace.push({ t: s.t, sp: Math.hypot(a.vel.x, a.vel.y), vx: a.vel.x });
            if (!kind) {
              kind = String(s.ball.kind);
              hang = s.ball.arrive - s.ball.releaseT;
            }
          }
          stepPlay(s, s.phase === 'carrier' ? input({ move: { x: 1, y: 0 } }) : f(s));
        }
        if (!trace.length || !s.result?.pass?.attempted) continue;
        const end = trace[trace.length - 1]!;
        const stood = trace.filter((p) => end.t - p.t <= 1 && p.sp < WAIT_V).length * TICK;
        const list = rows.get(kind) ?? [];
        list.push({ hang, stood, back: -end.vx, ok: !!s.result.pass.complete });
        rows.set(kind, list);
      }
    for (const [kind, list] of rows) {
      const m = (f: (x: (typeof list)[number]) => number) => (list.reduce((t, x) => t + f(x), 0) / list.length).toFixed(2);
      console.log(`${c.id.padEnd(9)} ${String(late).padStart(3)}  ${kind.padEnd(7)} ${String(list.length).padStart(3)}  ${((100 * list.filter((x) => x.ok).length) / list.length).toFixed(0).padStart(3)}%  ${m((x) => x.hang).padStart(6)}  ${m((x) => x.stood).padStart(7)}  ${m((x) => x.back).padStart(6)}`);
    }
  }
