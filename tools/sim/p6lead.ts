// Passing round 6 (docs/passing/PASSING6.md): does the QB visibly lead his
// man, and does the man run under it without breaking stride? The player
// throws on the cue (a tap) to the go, the post, the corner, the crosser
// and the out, against four coverages; for each throw:
// - the lead: how far ahead of the man (along his run at the release) the
//   QB put the ball, against how far he runs in the ball's hang (lead/run:
//   1 = thrown to where he's going, 0 = thrown at him);
// - his stride: his speed at the catch and the slowest he ran in the air, as
//   a share of his speed at the release, and the time he spent under half
//   of it (waiting);
// - where it met him: the ball's spot against his centre at the sim's
//   catch (along his run, + ahead; across; its height) and how long before
//   the ball's arrival at its aim the sim called it.
//   node tools/run-ts.mjs tools/sim/p6lead.ts [--seeds=N] [--qb=Name] [--detail] [--cases=go,post]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 8);
const DETAIL = args.has('detail');
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const QB = args.get('qb');
const offense = QB ? { ...base.offense, QB: simPlayer(findStint(snap, QB, 'QB')!, 16) } : base.offense;
const ALL: { id: string; play: string; icon: number; hot?: RouteName }[] = [
  { id: 'go', play: 'trips-four-verts', icon: 4 },
  { id: 'post', play: 'singleback-pa-post', icon: 1 },
  { id: 'corner', play: 'doubles-smash', icon: 1 },
  { id: 'cross', play: 'trips-y-cross', icon: 1 },
  { id: 'out', play: 'doubles-curls', icon: 1, hot: 'out' },
  { id: 'dig', play: 'singleback-drive', icon: 2 },
  { id: 'curl', play: 'doubles-curls', icon: 1 },
  { id: 'comeback', play: 'doubles-curls', icon: 2, hot: 'comeback' },
  { id: 'hitch', play: 'doubles-hitch-seam', icon: 1 },
  { id: 'flat', play: 'doubles-curls', icon: 3 },
  { id: 'slant', play: 'doubles-slants', icon: 1 },
];
const want = args.get('cases')?.split(',');
const CASES = want ? ALL.filter((c) => want.includes(c.id)) : ALL;
const DEFS = (args.get('defs') ?? 'cover3,cover1,cover2,cover4').split(',');
const HOLD = Number(args.get('hold') ?? 4);

interface Row {
  out: string;
  lead: number;
  run: number;
  hang: number;
  vRel: number;
  vCatch: number;
  vMin: number;
  wait: number;
  bAlong: number;
  bAcross: number;
  bZ: number;
  early: number;
  miss: number;
  turn: number;
  stood: number;
}
const all: Record<string, Row[]> = {};
for (const c of CASES)
  for (const def of DEFS)
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s: PlayState = createPlay({ seed, offense, defense: base.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
      let press = -1;
      let tgt = -1;
      let rel: { t: number; x: number; y: number; ux: number; uy: number; v: number; mx: number; my: number; hang: number; miss: number } | null = null;
      let vMin = Infinity;
      let wait = 0;
      let stood = 0;
      let row: Row | null = null;
      for (let k = 0; k < 900 && !s.result; k++) {
        let f: InputFrame;
        if (s.phase === 'presnap') f = input({ snap: true, hotRoute: c.hot ? { icon: c.icon, route: c.hot } : null });
        else if (s.phase === 'carrier') f = input({ move: { x: 1, y: 0 } });
        else {
          const a = s.agents[s.icons[c.icon - 1]!]!;
          tgt = a.i;
          const q = throwCue(s, a);
          if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.t;
          f = input({ throwHeld: press >= 0 && s.t < press + HOLD / 60 ? c.icon : 0 });
        }
        const r = tgt >= 0 ? s.agents[tgt]! : null;
        if (s.phase === 'air' && r && s.ball.target === tgt) {
          const sp = Math.hypot(r.vel.x, r.vel.y);
          if (!rel) {
            const ux = sp > 1 ? r.vel.x / sp : 1;
            const uy = sp > 1 ? r.vel.y / sp : 0;
            const ev = [...s.events].reverse().find((e) => e.type === 'throw');
            rel = { t: s.t, x: r.pos.x, y: r.pos.y, ux, uy, v: sp, mx: s.ball.meant.x, my: s.ball.meant.y, hang: s.ball.arrive - s.t, miss: Math.hypot(s.ball.aim.x - s.ball.meant.x, s.ball.aim.y - s.ball.meant.y) };
            void ev;
          }
          vMin = Math.min(vMin, sp);
          if (rel.v > 4 && sp < 0.5 * rel.v) wait += 1 / 60;
          // Stood under it: barely moving with the ball still more than a quarter second away.
          if (sp < 1.5 && s.ball.arrive - s.t > 0.25) stood += 1 / 60;
          // The tick the sim calls it (the ball reaches someone this step): read before, check after.
          const bx = s.ball.pos.x;
          void bx;
        }
        const wasAir = s.phase === 'air';
        const pre = r ? { x: r.pos.x, y: r.pos.y, vx: r.vel.x, vy: r.vel.y } : null;
        stepPlay(s, f);
        if (wasAir && r && rel && !row && (s.phase !== 'air' || s.ball.target !== tgt)) {
          // His run into the catch: his velocity before the catch tick's contact and carry (the catch can stop him in the same tick).
          const sp = Math.hypot(pre!.vx, pre!.vy);
          const ux = sp > 1 ? pre!.vx / sp : rel.ux;
          const uy = sp > 1 ? pre!.vy / sp : rel.uy;
          const dx = s.ball.pos.x - r.pos.x;
          const dy = s.ball.pos.y - r.pos.y;
          const turn = (Math.acos(Math.max(-1, Math.min(1, ux * rel.ux + uy * rel.uy))) * 180) / Math.PI;
          row = {
            out: '',
            lead: (rel.mx - rel.x) * rel.ux + (rel.my - rel.y) * rel.uy,
            run: rel.v * rel.hang,
            hang: rel.hang,
            vRel: rel.v,
            vCatch: sp,
            vMin,
            wait,
            bAlong: dx * ux + dy * uy,
            bAcross: -dx * uy + dy * ux,
            bZ: s.ball.pos.z,
            early: rel.t + rel.hang - s.t,
            miss: rel.miss,
            turn,
            stood,
          };
        }
      }
      while (!s.result) stepPlay(s, s.phase === 'carrier' ? input({ move: { x: 1, y: 0 } }) : input({}));
      if (!row || !s.result?.pass?.attempted) continue;
      const res = s.result.pass;
      const ev = s.events.find((e) => ['drop', 'deflection', 'interception'].includes(e.type));
      row.out = res.complete ? 'catch' : res.intercepted ? 'INT' : (ev?.type ?? 'inc');
      (all[c.id] ??= []).push(row);
      if (DETAIL)
        console.log(
          `${c.id}/${def}/${seed} lead ${row.lead.toFixed(1)} of run ${row.run.toFixed(1)} (hang ${row.hang.toFixed(2)}) v ${row.vRel.toFixed(1)} -> catch ${row.vCatch.toFixed(1)} min ${row.vMin.toFixed(1)} wait ${row.wait.toFixed(2)} | ball at catch along ${row.bAlong.toFixed(2)} across ${row.bAcross.toFixed(2)} z ${row.bZ.toFixed(2)} early ${row.early.toFixed(2)} turn ${row.turn.toFixed(0)} miss ${row.miss.toFixed(2)} stood ${row.stood.toFixed(2)} | ${row.out}`,
        );
    }
const m = (R: Row[], f: (r: Row) => number) => R.reduce((a, r) => a + f(r), 0) / Math.max(1, R.length);
console.log(`QB ${QB ?? 'practice'} (tap on the cue)`);
console.log('case     n  cmp | lead  run  lead/run hang | v rel  v catch/rel  v min/rel  wait s | ball at catch: along across  z    early s | turn deg  miss yd | stood s');
for (const [k, R] of Object.entries(all)) {
  const n = R.length;
  const pc = (o: string) => `${((100 * R.filter((r) => r.out === o).length) / n).toFixed(0).padStart(3)}%`;
  console.log(
    `${k.padEnd(7)} ${String(n).padStart(3)} ${pc('catch')} | ${m(R, (r) => r.lead).toFixed(1).padStart(4)} ${m(R, (r) => r.run).toFixed(1).padStart(4)}  ${m(R, (r) => r.lead / Math.max(0.1, r.run)).toFixed(2)}  ${m(R, (r) => r.hang).toFixed(2)} | ${m(R, (r) => r.vRel).toFixed(1).padStart(5)}  ${m(R, (r) => r.vCatch / Math.max(0.1, r.vRel)).toFixed(2).padStart(9)}  ${m(R, (r) => r.vMin / Math.max(0.1, r.vRel)).toFixed(2).padStart(9)}  ${m(R, (r) => r.wait).toFixed(2).padStart(6)} |  ${m(R, (r) => r.bAlong).toFixed(2).padStart(6)} ${m(R, (r) => r.bAcross).toFixed(2).padStart(6)} ${m(R, (r) => r.bZ).toFixed(2)}  ${m(R, (r) => r.early).toFixed(2).padStart(5)} | ${m(R, (r) => r.turn).toFixed(0).padStart(5)}  ${m(R, (r) => r.miss).toFixed(2)} | ${m(R, (r) => r.stood).toFixed(2)}`,
  );
}
