// Passing round 7 (docs/passing/PASSING7.md): the batted slant. The player
// taps the slant on the throw-timing cue (p6lead.ts's case), and for every
// throw, every defensive lineman the ball goes by in its first BAT_T of
// flight: how close it passed him (on the ground), how high it was then
// against the top of his reach and the bottom of the battable band, whether
// he was blocked and how far from the QB, and whether he batted it. Also the
// AI book's batted share (every base pass play against every call).
//   node tools/run-ts.mjs tools/sim/p7bat.ts [--seeds=16] [--qb=Name] [--cases=slant] [--book=4] [--detail]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, defById, input, PASS_PLAYS, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { blockOf } from '../../src/sim/blocks.ts';
import { reach } from '../../src/sim/passing.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 16);
const BOOK = Number(args.get('book') ?? 0);
const DETAIL = args.has('detail');
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const QB = args.get('qb') ?? 'Joe Montana';
const offense = { ...base.offense, QB: simPlayer(findStint(snap, QB, 'QB')!, 16) };
const ALL: { id: string; play: string; icon: number; hot?: RouteName }[] = [
  { id: 'slant', play: 'doubles-slants', icon: 1 },
  { id: 'slant2', play: 'doubles-slants', icon: 2 },
  { id: 'cross', play: 'trips-y-cross', icon: 1 },
  { id: 'dig', play: 'singleback-drive', icon: 2 },
];
const want = (args.get('cases') ?? 'slant').split(',');
const DEFS = (args.get('defs') ?? 'cover3,cover1,cover2,cover4').split(',');

interface Pass {
  i: number;
  dh: number;
  z: number;
  top: number;
  engaged: boolean;
  toQb: number;
  t: number;
}
function watch(s: PlayState, near: Map<number, Pass>): void {
  const b = s.ball;
  if (s.phase !== 'air' || s.t - b.releaseT > 0.3 || b.target < 0) return;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down || (d.p.pos !== 'DE' && d.p.pos !== 'DT')) continue;
    const dh = Math.hypot(b.pos.x - d.pos.x, b.pos.y - d.pos.y);
    const prev = near.get(i);
    if (!prev || dh < prev.dh) near.set(i, { i, dh, z: b.pos.z, top: reach(d).top, engaged: !!blockOf(s, i), toQb: Math.hypot(d.pos.x - s.agents[b.thrower]!.pos.x, d.pos.y - s.agents[b.thrower]!.pos.y), t: s.t - b.releaseT });
  }
}
let n = 0;
let bats = 0;
let inLane = 0;
for (const c of ALL.filter((c) => want.includes(c.id)))
  for (const def of DEFS)
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s: PlayState = createPlay({ seed, offense, defense: base.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
      let press = -1;
      const near = new Map<number, Pass>();
      let batted = -1;
      let rel: { qx: number; qy: number; z: number; tx: number; ty: number; tz: number } | null = null;
      for (let k = 0; k < 900 && !s.result; k++) {
        let f: InputFrame;
        if (s.phase === 'presnap') f = input({ snap: true, hotRoute: c.hot ? { icon: c.icon, route: c.hot } : null });
        else if (s.phase === 'carrier') f = input({ move: { x: 1, y: 0 } });
        else {
          const a = s.agents[s.icons[c.icon - 1]!]!;
          const q = throwCue(s, a);
          if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.t;
          f = input({ throwHeld: press >= 0 && s.t < press + 4 / 60 ? c.icon : 0 });
        }
        watch(s, near);
        const ne = s.events.length;
        stepPlay(s, f);
        if (s.phase === 'air' && !rel) rel = { qx: s.ball.pos.x, qy: s.ball.pos.y, z: s.ball.pos.z, tx: s.ball.aim.x, ty: s.ball.aim.y, tz: s.ball.aim.z };
        for (const e of s.events.slice(ne)) if (e.type === 'deflection' && e.data?.batted) batted = e.who?.[0] ?? 0;
      }
      if (!rel) continue;
      n++;
      if (batted >= 0) bats++;
      const lane = [...near.values()].filter((p) => p.dh < 0.7 && p.z < p.top && p.z > 1.4);
      if (lane.length) inLane++;
      if (DETAIL && (lane.length || batted >= 0))
        console.log(
          `${c.id}/${def}/${seed} ${batted >= 0 ? 'BATTED' : '      '} release z ${rel.z.toFixed(2)} aim (${(rel.tx - rel.qx).toFixed(1)}, ${(rel.ty - rel.qy).toFixed(1)}, ${rel.tz.toFixed(2)}) | ` +
            [...near.values()]
              .filter((p) => p.dh < 1.5)
              .map((p) => `${s.agents[p.i]!.slot} ${s.agents[p.i]!.p.heightIn}in dh ${p.dh.toFixed(2)} z ${p.z.toFixed(2)} top ${p.top.toFixed(2)} ${p.engaged ? 'blocked' : 'FREE'} toQb ${p.toQb.toFixed(1)} t ${p.t.toFixed(2)}`)
              .join(' ; '),
        );
    }
console.log(`${QB} on the cue (${want.join(',')}): ${n} throws, batted ${bats} (${((100 * bats) / Math.max(1, n)).toFixed(1)}%), a lineman in the lane on ${inLane}`);
if (BOOK > 0) {
  let att = 0;
  let bat = 0;
  for (const play of PASS_PLAYS.filter((p) => !p.hailMary))
    for (const def of DEF_CALLS)
      for (let seed = 1; seed <= BOOK; seed++) {
        const s = createPlay({ seed, offense: base.offense, defense: base.defense, play, def, los: 30, toGo: 10, user: false });
        let b = false;
        for (let k = 0; k < 1800 && !s.result; k++) {
          const ne = s.events.length;
          stepPlay(s, input({}));
          for (const e of s.events.slice(ne)) if (e.type === 'deflection' && e.data?.batted) b = true;
        }
        if (!s.result?.pass?.attempted) continue;
        att++;
        if (b) bat++;
      }
  console.log(`AI book: ${att} attempts, batted ${bat} (${((100 * bat) / Math.max(1, att)).toFixed(2)}%)`);
}
