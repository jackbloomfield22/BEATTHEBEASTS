// Passing round 4 (docs/passing/PASSING4.md): the player's deep ball. The
// go, the post, the seam and the fade thrown by the player on the cue (the
// key down a release before the ball should be out: src/sim/cue.ts), a tap
// and a held touch, against four coverages, and for each throw where the ball
// came down against the man (along his run: + ahead, − behind; across it:
// + toward the sideline he's nearer, − inside) and against the defender
// nearest him, and what happened.
//   node tools/run-ts.mjs tools/sim/deepball.ts [--seeds=N] [--qb=Name] [--detail]
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
const CASES: { id: string; play: string; icon: number; hot?: RouteName }[] = [
  { id: 'go', play: 'trips-four-verts', icon: 4 },
  { id: 'go-x', play: 'trips-four-verts', icon: 1 },
  { id: 'post', play: 'singleback-pa-post', icon: 1 },
  { id: 'seam', play: 'trips-four-verts', icon: 2 },
  { id: 'fade', play: 'doubles-curls', icon: 1, hot: 'fade' },
];
const DEFS = (args.get('defs') ?? 'cover3,cover1,cover2,cover4').split(',');
const HOLDS: [string, number][] = [['tap', 4], ['touch', 16]];

interface Row { out: string; along: number; across: number; dAlong: number; dAcross: number; dBall: number; vArr: number; air: number; hang: number }
const all: Record<string, Row[]> = {};
for (const c of CASES)
  for (const [hn, hold] of HOLDS)
    for (const def of DEFS)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s: PlayState = createPlay({ seed, offense, defense: base.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
        let press = -1;
        let tgt = -1;
        let arr: Row | null = null;
        let rel: { air: number; hang: number } | null = null;
        for (let k = 0; k < 900 && !s.result; k++) {
          let f: InputFrame;
          if (s.phase === 'presnap') f = input({ snap: true, hotRoute: c.hot ? { icon: c.icon, route: c.hot } : null });
          else if (s.phase === 'carrier') f = input({ move: { x: 1, y: 0 } });
          else {
            const a = s.agents[s.icons[c.icon - 1]!]!;
            tgt = a.i;
            const q = throwCue(s, a);
            if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.t;
            f = input({ throwHeld: press >= 0 && s.t < press + hold / 60 ? c.icon : 0 });
          }
          const wasAir = s.phase === 'air';
          if (wasAir && !rel) rel = { air: s.ball.aim.x - s.setup.los, hang: s.ball.arrive - s.ball.releaseT };
          // At the arrival: the ball against the man and the nearest defender.
          if (wasAir && s.t <= s.ball.arrive + 1e-9) {
            const r = s.agents[tgt]!;
            const sp = Math.hypot(r.vel.x, r.vel.y) || 1;
            const ux = sp > 1 ? r.vel.x / sp : 1;
            const uy = sp > 1 ? r.vel.y / sp : 0;
            const side = Math.sign(r.pos.y) || 1;
            // across: + toward his sideline (the perpendicular to his run that points at it)
            let px = -uy;
            let py = ux;
            if (py * side < 0) {
              px = -px;
              py = -py;
            }
            // (Where he'll be at the ball's arrival, on his run now: the ball's measured at its aim, not along its flight.)
            const lt = Math.max(0, s.ball.arrive - s.t);
            const rx = r.pos.x + r.vel.x * lt;
            const ry = r.pos.y + r.vel.y * lt;
            const fix = (p: { x: number; y: number }) => {
              const dx = p.x - rx;
              const dy = p.y - ry;
              return { al: dx * ux + dy * uy, ac: dx * px + dy * py };
            };
            let near = -1;
            let nd = 1e9;
            for (const i of s.def) {
              const d = Math.hypot(s.agents[i]!.pos.x - r.pos.x, s.agents[i]!.pos.y - r.pos.y);
              if (d < nd) {
                nd = d;
                near = i;
              }
            }
            const b = fix(s.ball.aim);
            const dn = s.agents[near]!;
            const d = fix({ x: dn.pos.x + dn.vel.x * lt, y: dn.pos.y + dn.vel.y * lt });
            arr = { out: '', along: b.al, across: b.ac, dAlong: d.al, dAcross: d.ac, dBall: Math.hypot(dn.pos.x + dn.vel.x * lt - s.ball.aim.x, dn.pos.y + dn.vel.y * lt - s.ball.aim.y), vArr: sp, air: rel?.air ?? 0, hang: rel?.hang ?? 0 };
          }
          stepPlay(s, f);
          if (wasAir && s.phase !== 'air' && arr) break;
        }
        while (!s.result) stepPlay(s, s.phase === 'carrier' ? input({ move: { x: 1, y: 0 } }) : input({}));
        if (!arr || !s.result?.pass?.attempted) continue;
        const res = s.result.pass;
        const ev = s.events.find((e) => ['drop', 'deflection', 'interception'].includes(e.type));
        arr.out = res.complete ? 'catch' : res.intercepted ? 'INT' : (ev?.type ?? 'inc');
        (all[`${c.id}/${hn}`] ??= []).push(arr);
        if (DETAIL) console.log(`${c.id}/${hn}/${def}/${seed} ball along ${arr.along.toFixed(2)} across ${arr.across.toFixed(2)} | def along ${arr.dAlong.toFixed(1)} across ${arr.dAcross.toFixed(1)} to ball ${arr.dBall.toFixed(1)} | v ${arr.vArr.toFixed(1)} air ${arr.air.toFixed(0)} hang ${arr.hang.toFixed(2)} | ${arr.out}`);
      }
const m = (R: Row[], f: (r: Row) => number) => R.reduce((a, r) => a + f(r), 0) / Math.max(1, R.length);
console.log('case        n   cmp   INT  brk  drop | ball along (ahead+) across (out+) | |behind>1| ahead>1 | def to ball  def along  def across | air  hang');
for (const [k, R] of Object.entries(all)) {
  const n = R.length;
  const pc = (o: string) => `${((100 * R.filter((r) => r.out === o).length) / n).toFixed(0).padStart(3)}%`;
  console.log(
    `${k.padEnd(11)} ${String(n).padStart(3)} ${pc('catch')} ${pc('INT')} ${pc('deflection')} ${pc('drop')} |   ${m(R, (r) => r.along).toFixed(2).padStart(6)}        ${m(R, (r) => r.across).toFixed(2).padStart(6)}        |   ${((100 * R.filter((r) => r.along < -1).length) / n).toFixed(0).padStart(3)}%    ${((100 * R.filter((r) => r.along > 1).length) / n).toFixed(0).padStart(3)}% |   ${m(R, (r) => r.dBall).toFixed(2)}      ${m(R, (r) => r.dAlong).toFixed(2).padStart(5)}    ${m(R, (r) => r.dAcross).toFixed(2).padStart(5)}    | ${m(R, (r) => r.air).toFixed(0)}  ${m(R, (r) => r.hang).toFixed(2)}`,
  );
}
