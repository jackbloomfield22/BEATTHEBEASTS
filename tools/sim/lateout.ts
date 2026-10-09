// Passing round 4 (docs/passing/PASSING4.md): the late out. The out
// (hot-routed on Doubles Curls, the X and the slot's out on Quick Outs)
// thrown by the player after the man's break (the key 0.33 s and 0.67 s
// past it), and for each throw, his last tick before the ball got to him:
// how far inside the sideline he was, how fast he was running toward it
// (+) or back from it (−), toward the line of scrimmage (−x), and what
// happened.
//   node tools/run-ts.mjs tools/sim/lateout.ts [--seeds=N]
import { readFileSync } from 'node:fs';
import { createPlay, defById, FIELD_HALF_W, input, playById, practiceRosters, stepPlay, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { userThrow } from '../../src/game/clips.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 8);
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const CASES: { id: string; play: string; icon: number; hot?: RouteName; brk: number }[] = [
  { id: 'out (X)', play: 'doubles-curls', icon: 1, hot: 'out', brk: 100 },
  { id: 'qout', play: 'singleback-quick-outs', icon: 1, brk: 64 },
];
console.log('case      late   n   cmp  | inside sideline (yd)  toward it (yd/s)  downfield (yd/s) | caught within 1.2 of it');
for (const c of CASES)
  for (const late of [20, 40]) {
    const rows: { room: number; vOut: number; vx: number; out: string }[] = [];
    for (const def of ['cover3', 'cover1', 'cover2', 'cover4'])
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s = createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
        const f = userThrow({ icon: c.icon, at: c.brk + late, hot: c.hot });
        let last: { room: number; vOut: number; vx: number } | null = null;
        let tgt = -1;
        for (let k = 0; k < 900 && !s.result; k++) {
          if (s.phase === 'air' && s.ball.target >= 0) {
            tgt = s.ball.target;
            const a = s.agents[tgt]!;
            const side = Math.sign(a.pos.y) || 1;
            last = { room: FIELD_HALF_W - Math.abs(a.pos.y), vOut: a.vel.y * side, vx: a.vel.x };
          }
          stepPlay(s, s.phase === 'carrier' ? input({ move: { x: 1, y: 0 } }) : f(s));
        }
        if (!last || !s.result?.pass?.attempted) continue;
        const ev = s.events.find((e) => ['drop', 'deflection', 'interception'].includes(e.type));
        rows.push({ ...last, out: s.result.pass.complete ? 'catch' : s.result.pass.intercepted ? 'INT' : (ev?.type ?? 'inc') });
      }
    const m = (g: (x: (typeof rows)[number]) => number) => (rows.reduce((a, x) => a + g(x), 0) / Math.max(1, rows.length)).toFixed(2).padStart(6);
    const pc = (p: (x: (typeof rows)[number]) => boolean) => `${((100 * rows.filter(p).length) / Math.max(1, rows.length)).toFixed(0).padStart(3)}%`;
    console.log(`${c.id.padEnd(9)} +${(late / 60).toFixed(2)} ${String(rows.length).padStart(3)}  ${pc((x) => x.out === 'catch')}  |  ${m((x) => x.room)}               ${m((x) => x.vOut)}            ${m((x) => x.vx)}      |  ${pc((x) => x.room < 1.2)}`);
  }
