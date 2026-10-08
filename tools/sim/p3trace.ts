// Passing round 3: a tick trace of one recorded clip (src/game/clips.ts
// PASSING3) around the throw and the catch: the QB, the target, the ball
// and the other route runners, so a video frame can be read against the sim.
//   node tools/run-ts.mjs tools/sim/p3trace.ts p3-slant [every=3]
import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING3 } from '../../src/game/clips.ts';

const id = process.argv[2] ?? 'p3-slant';
const every = Number(process.argv[3] ?? 3);
const c = PASSING3.find((x) => x.id === id)!;
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const s = createPlay({ seed: c.seed, offense: r.offense, defense: r.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: true });
let tgt = -1;
const f1 = (x: number) => x.toFixed(1).padStart(5);
const deg = (vx: number, vy: number) => Math.round((Math.atan2(vy, vx) * 180) / Math.PI);
let seen = 0;
for (let k = 0; k < 60 * 10 && !s.result; k++) {
  stepPlay(s, c.script(s));
  for (; seen < s.events.length; seen++) {
    const e = s.events[seen]!;
    if (['snap', 'throw', 'catch', 'drop', 'bobble', 'deflection', 'interception', 'tackle', 'hit', 'move'].includes(e.type)) console.log(`   ${(e.t - s.snapT).toFixed(2)} EVENT ${e.type} ${JSON.stringify(e.who)} ${e.data ? JSON.stringify(e.data).slice(0, 160) : ''}`);
    if (e.type === 'throw') tgt = e.who![1]!;
  }
  if (s.snapT < 0 || (s.tick - Math.round(s.snapT * 60)) % every) continue;
  const t = s.t - s.snapT;
  const qb = s.agents[s.qb]!;
  const b = s.ball;
  const T = tgt >= 0 ? s.agents[tgt]! : s.agents[s.icons[0]!]!;
  const others = s.icons
    .filter((i) => i !== T.i)
    .map((i) => {
      const a = s.agents[i]!;
      return `${a.slot}:${f1(Math.hypot(a.vel.x, a.vel.y))}@${deg(a.vel.x, a.vel.y)}`;
    })
    .join(' ');
  console.log(
    `${t.toFixed(2)} ${s.phase.padEnd(7)} qb(${f1(qb.pos.x)},${f1(qb.pos.y)}) v${f1(Math.hypot(qb.vel.x, qb.vel.y))} ${qb.anim} | ${T.slot} (${f1(T.pos.x)},${f1(T.pos.y)}) v${f1(Math.hypot(T.vel.x, T.vel.y))}@${deg(T.vel.x, T.vel.y)} face${Math.round((T.face * 180) / Math.PI)} idx${T.route?.idx ?? '-'} ${T.anim} busy${T.busy} | ball ${b.mode} (${f1(b.pos.x)},${f1(b.pos.y)},${b.pos.z.toFixed(2)}) ${b.mode === 'air' ? `arr ${(b.arrive - s.snapT).toFixed(2)} aim(${f1(b.aim.x)},${f1(b.aim.y)}) meant(${f1(b.meant.x)},${f1(b.meant.y)})` : ''} | ${others}`,
  );
}
console.log(s.result);
