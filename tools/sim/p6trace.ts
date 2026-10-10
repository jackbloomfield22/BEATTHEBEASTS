// Passing round 6: one throw's flight, tick by tick (the man's speed, his distance to the ball's aim, the ball).
//   node tools/run-ts.mjs tools/sim/p6trace.ts --play=trips-four-verts --icon=4 --def=cover3 --seed=1 [--qb=Name] [--hot=out]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type InputFrame, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const QB = args.get('qb');
const offense = QB ? { ...base.offense, QB: simPlayer(findStint(snap, QB, 'QB')!, 16) } : base.offense;
const icon = Number(args.get('icon') ?? 1);
const hot = args.get('hot') as RouteName | undefined;
const s = createPlay({ seed: Number(args.get('seed') ?? 1), offense, defense: base.defense, play: playById(args.get('play') ?? 'trips-four-verts'), def: defById(args.get('def') ?? 'cover3'), los: 30, toGo: 10, user: true });
let press = -1;
const HOLD = Number(args.get('hold') ?? 4);
for (let k = 0; k < 900 && !s.result; k++) {
  let f: InputFrame;
  const a = s.agents[s.icons[icon - 1]!]!;
  if (s.phase === 'presnap') f = input({ snap: true, hotRoute: hot ? { icon, route: hot } : null });
  else if (s.phase === 'carrier') f = input({ move: { x: 1, y: 0 } });
  else {
    const q = throwCue(s, a);
    if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.t;
    f = input({ throwHeld: press >= 0 && s.t < press + HOLD / 60 ? icon : 0 });
  }
  if (s.phase === 'air') {
    const b = s.ball;
    const sp = Math.hypot(a.vel.x, a.vel.y);
    const dAim = Math.hypot(b.aim.x - a.pos.x, b.aim.y - a.pos.y);
    const dBall = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
    console.log(`t ${(s.t - b.releaseT).toFixed(2)} left ${(b.arrive - s.t).toFixed(2)} v ${sp.toFixed(2)} pos ${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)} aim ${b.aim.x.toFixed(2)},${b.aim.y.toFixed(2)},${b.aim.z.toFixed(2)} meant ${b.meant.x.toFixed(2)},${b.meant.y.toFixed(2)} dAim ${dAim.toFixed(2)} ball ${b.pos.x.toFixed(2)},${b.pos.y.toFixed(2)},${b.pos.z.toFixed(2)} dBall ${dBall.toFixed(2)} route ${a.route?.idx}/${a.route?.pts.length}`);
  }
  stepPlay(s, f);
}
console.log(s.events.filter((e) => ['throw', 'catch', 'drop', 'deflection', 'interception'].includes(e.type)).map((e) => `${e.t.toFixed(2)} ${e.type} ${JSON.stringify(e.data ?? {})}`).join('\n'));
