// Passing round 7: the AI book's throws to a corner route: how each ended
// (caught, broken up, picked, dropped, nobody got there), the ball's meant
// spot against where he'd be (ahead, outside), and the nearest defender to
// the ball where it came down.
//   node tools/run-ts.mjs tools/sim/p7cornerbook.ts [--seeds=20] [--route=corner]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, input, PASS_PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 20);
const ROUTE = args.get('route') ?? 'corner';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const outs = new Map<string, number>();
let n = 0;
let ahead = 0;
let outside = 0;
let nearSum = 0;
for (const play of PASS_PLAYS.filter((p) => !p.hailMary && p.type !== 'screen'))
  for (const def of DEF_CALLS)
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createPlay({ seed, offense: base.offense, defense: base.defense, play, def, los: 30, toGo: 10, user: false });
      let tgt = -1;
      let rel: { a: number; o: number } | null = null;
      for (let k = 0; k < 1500 && !s.result; k++) {
        const was = s.phase;
        stepPlay(s, input({}));
        if (was !== 'air' && s.phase === 'air' && s.ball.target >= 0) {
          const r = s.agents[s.ball.target]!;
          const as = s.setup.play.assign[r.slot as keyof typeof s.setup.play.assign] as { route?: string };
          if (((s.hot as Record<string, string>)[r.slot] ?? as.route) !== ROUTE) break;
          tgt = r.i;
          const T = s.ball.arrive - s.t;
          const px = r.pos.x + r.vel.x * T;
          const py = r.pos.y + r.vel.y * T;
          const sp = Math.hypot(r.vel.x, r.vel.y) || 1;
          const ux = r.vel.x / sp;
          const uy = r.vel.y / sp;
          const side = Math.sign(r.pos.y) || 1;
          let ox = -uy;
          let oy = ux;
          if (oy * side < 0) {
            ox = -ox;
            oy = -oy;
          }
          rel = { a: (s.ball.meant.x - px) * ux + (s.ball.meant.y - py) * uy, o: (s.ball.meant.x - px) * ox + (s.ball.meant.y - py) * oy };
        }
      }
      if (tgt < 0 || !rel) continue;
      while (!s.result && s.t < 40) stepPlay(s, input({}));
      const p = s.result?.pass;
      const ev = s.events.find((e) => ['drop', 'deflection', 'interception', 'catch'].includes(e.type));
      const o = p?.complete ? 'catch' : p?.intercepted ? 'int' : ev?.type === 'deflection' ? (ev.data?.batted ? 'bat' : 'pbu') : (ev?.type ?? 'nobody');
      outs.set(o, (outs.get(o) ?? 0) + 1);
      n++;
      ahead += rel.a;
      outside += rel.o;
      let near = 99;
      for (const i of s.def) near = Math.min(near, Math.hypot(s.agents[i]!.pos.x - s.ball.aim.x, s.agents[i]!.pos.y - s.ball.aim.y));
      nearSum += Math.min(near, 10);
    }
console.log(`${ROUTE} in the AI book: n ${n} | ${[...outs].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / n).toFixed(1)}%`).join('  ')} | meant: ahead ${(ahead / n).toFixed(2)} outside ${(outside / n).toFixed(2)} | nearest defender to the landing (at the end) ${(nearSum / n).toFixed(2)}`);
