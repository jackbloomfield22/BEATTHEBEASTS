// Passing round 8: on the player's cue throws, where is the receiver when the ball gets to its meant spot?
// The meant spot is the lead to his hands (passing.ts planThrow: his spot at full speed on his route, plus LEAD_HANDS);
// this prints, at the ball's planned arrival, the meant spot against his hands point (along his run, + the ball ahead of
// his hands), and against where leadRun put his centre.
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';
import { handsAt } from '../../src/sim/passing.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const [playId, iconS, ...defs] = (process.argv[2] ?? 'doubles-slants:1:cover3,cover1,cover2,cover4').split(':');
const icon = Number(iconS);
const rows: number[] = [];
const err: number[] = [];
for (const def of (defs.join(':') || 'cover3').split(',')) for (let seed = 1; seed <= 16; seed++) {
  const s = createPlay({ seed, offense: base.offense, defense: base.defense, play: playById(playId!), def: defById(def), los: 30, toGo: 10, user: true });
  let press = -1;
  let done = false;
  let thr: { meant: { x: number; y: number }; aim: { x: number; y: number }; arrive: number } | null = null;
  for (let k = 0; k < 1200 && !s.result && !done; k++) {
    const a = s.agents[s.icons[icon - 1]!]!;
    if (!thr && s.phase === 'air' && s.ball.target === a.i) thr = { meant: { ...s.ball.meant }, aim: { ...s.ball.aim }, arrive: s.ball.arrive };
    if (thr && s.t >= thr.arrive - 1e-9) {
      const sp = Math.hypot(a.vel.x, a.vel.y);
      const ux = a.vel.x / sp, uy = a.vel.y / sp;
      const h = handsAt(a);
      rows.push((thr.meant.x - h.x) * ux + (thr.meant.y - h.y) * uy);
      err.push((thr.aim.x - thr.meant.x) * ux + (thr.aim.y - thr.meant.y) * uy);
      done = true;
      break;
    }
    let f;
    if (s.phase === 'presnap') f = input({ snap: true });
    else {
      const q = throwCue(s, a);
      if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.t;
      f = input({ throwHeld: press >= 0 && s.t < press + 4 / 60 ? icon : 0 });
    }
    stepPlay(s, f);
  }
}
const m = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
console.log(`${playId} icon ${icon}: ${rows.length} throws; at the arrival the meant spot is ${m(rows).toFixed(2)} yd ahead of his hands along his run (sd ${Math.sqrt(m(rows.map((r) => (r - m(rows)) ** 2))).toFixed(2)}); the throw's error along his run ${m(err).toFixed(2)} yd`);
