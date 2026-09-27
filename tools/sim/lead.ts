// Playtest 1: "throws lead the receiver far more than intended." For the
// player's throws (a tap, a short hold, a full hold) to each receiver at a
// range of times, where the ball arrives against where the receiver is when
// it gets there: ahead of him along his run (+) or behind (−), and how far
// off his line. Also how far the lead point is from where he was at the
// release, and how often the ball arrives more than 2 yd ahead of him.
//   node tools/run-ts.mjs tools/sim/lead.ts [seeds]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { routeOf } from '../../src/sim/ai.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const SEEDS = Number(process.argv[2] ?? 6);

interface Row { play: string; route: string; at: number; hold: string; ahead: number; side: number; leadDist: number; air: number; T: number }
const rows: Row[] = [];
for (const play of PLAYS.filter((p) => !p.run && !p.hailMary)) {
  for (const hold of [['tap', 3], ['hold', 20], ['full', 45]] as const) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const at of [45, 75, 105]) {
        const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play, def: defById('cover3'), los: 30, toGo: 10, user: true });
        const icon = 1 + (seed % s.icons.length);
        let relPos: { x: number; y: number } | null = null;
        for (let k = 0; k < 60 * 8 && !s.result; k++) {
          const t = s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60);
          stepPlay(s, input({ snap: s.phase === 'presnap', throwHeld: t >= at && t < at + hold[1] ? icon : 0 }));
          if (s.phase === 'air' && !relPos) relPos = { ...s.agents[s.ball.target]!.pos };
          // At the ball's arrival, or the tick it's caught (it can be caught a beat early), stop.
          if (relPos && (s.phase !== 'air' || s.t >= s.ball.arrive - 1e-6)) break;
        }
        if (!relPos || s.ball.target < 0) continue;
        const r = s.agents[s.ball.target]!;
        const sp = Math.hypot(r.vel.x, r.vel.y);
        if (sp < 1) continue;
        const hx = r.vel.x / sp;
        const hy = r.vel.y / sp;
        const dx = s.ball.aim.x - r.pos.x;
        const dy = s.ball.aim.y - r.pos.y;
        rows.push({ play: play.id, route: String(r.mem.routeName ?? routeOf(s, r) ?? '?'), at, hold: hold[0], ahead: dx * hx + dy * hy, side: Math.abs(-dx * hy + dy * hx), leadDist: Math.hypot(s.ball.aim.x - relPos.x, s.ball.aim.y - relPos.y), air: s.ball.aim.x - 30, T: s.ball.arrive - s.ball.releaseT });
      }
    }
  }
}
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))] ?? NaN;
for (const h of ['tap', 'hold', 'full']) {
  const g = rows.filter((r) => r.hold === h);
  console.log(`${h.padEnd(5)} n ${g.length}  ball vs receiver at arrival: ahead median ${q(g.map((r) => r.ahead), 0.5).toFixed(2)} yd (p10 ${q(g.map((r) => r.ahead), 0.1).toFixed(2)}, p90 ${q(g.map((r) => r.ahead), 0.9).toFixed(2)}), >2 yd ahead ${((100 * g.filter((r) => r.ahead > 2).length) / g.length).toFixed(0)}%, off his line median ${q(g.map((r) => r.side), 0.5).toFixed(2)}; lead from release ${q(g.map((r) => r.leadDist), 0.5).toFixed(1)} yd over ${q(g.map((r) => r.T), 0.5).toFixed(2)} s`);
}
if (process.argv.includes('--worst')) {
  const w = [...rows].sort((a, b) => a.ahead - b.ahead).slice(0, 25);
  for (const r of w) console.log(`  ${r.play} ${r.route} at ${r.at} ${r.hold}: ${r.ahead.toFixed(1)} yd, lead ${r.leadDist.toFixed(1)} yd, T ${r.T.toFixed(2)}`);
  const by: Record<string, number> = {};
  for (const r of rows.filter((x) => x.ahead < -3)) by[r.route] = (by[r.route] ?? 0) + 1;
  console.log('behind by 3+ yd, by route:', JSON.stringify(by));
}
