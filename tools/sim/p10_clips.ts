// Passing round 10 (docs/passing/PASSING10.md; round 9's p9_clips.ts with the touch hold in a scan): candidate plays for the videos,
// run in Node as the Practice Field runs them: the throw (its lane: the
// release moved off a lineman, yd, + his left), the catch clip the drawing
// draws a fifth of a second out (its style) and where (render/game/choreo.ts catchPoint)
// the sim takes the ball against him (m ahead, height m), the box-out, and
// how it ended.
//   node tools/run-ts.mjs tools/sim/p8_clips.ts [--ids=p8-reach,...] [--scan=slant:cover3:1-16:21]
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, NEUTRAL, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING9, PASSING10, userThrow, withSwap, type Clip } from '../../src/game/clips.ts';
import { catchStyle, contactAt } from '../../src/sim/catchstyle.ts';
import { catchAhead } from '../../src/sim/passing.ts';
import type { Agent } from '../../src/sim/types.ts';
import { boxOut } from '../../src/sim/bodies.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const ids = process.argv.find((a) => a.startsWith('--ids='))?.slice(6).split(',');
const scan = process.argv.find((a) => a.startsWith('--scan='))?.slice(7);
const user = !process.argv.includes('--ai');
let list: Clip[] = [...PASSING9, ...PASSING10].filter((c) => !ids || ids.includes(c.id));
if (scan) {
  // play:def:seedFrom-seedTo:icon:at[:hold]
  const [play, def, seeds, icon, at, hold] = scan.split(':');
  const [a, b] = seeds!.split('-').map(Number);
  list = [];
  for (let seed = a!; seed <= b!; seed++) list.push({ id: `${play}/${def}#${seed}`, title: '', seed, play: play!, def: def!, los: 30, script: user ? userThrow({ icon: Number(icon), at: Number(at), hold: hold ? Number(hold) : undefined }) : () => NEUTRAL, user });
}
/** render/game/choreo.ts catchPoint (not imported: the render pulls in Vite's types). */
function catchPoint(s: PlayState, a: Agent): { ahead: number; z: number } {
  const c = catchAhead(s, a);
  const dt = c ? c.dt : Math.max(0, s.ball.arrive - s.t);
  const p = c ? c.pos : s.ball.aim;
  const sp = Math.hypot(a.vel.x, a.vel.y);
  const hx = sp > 1 ? a.vel.x / sp : Math.cos(a.face);
  const hy = sp > 1 ? a.vel.y / sp : Math.sin(a.face);
  return { ahead: ((p.x - (a.pos.x + a.vel.x * dt)) * hx + (p.y - (a.pos.y + a.vel.y * dt)) * hy) * 0.9144, z: p.z };
}
for (const c of list) {
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  const s: PlayState = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  let drawn = '';
  // (Round 10) The throw as it leaves his hand: its distance to the aim (yd) and launch angle (deg), as render/game/choreo.ts throwFinish reads them.
  let out = '';
  let box = '';
  for (let k = 0; k < 1500 && !s.result; k++) {
    const b = s.ball;
    if (!out && b.mode === 'air') out = `d ${Math.hypot(b.aim.x - b.pos.x, b.aim.y - b.pos.y).toFixed(1)} yd, ${((Math.atan2(b.vel.z, Math.hypot(b.vel.x, b.vel.y)) * 180) / Math.PI).toFixed(0)} deg | `;
    if (!drawn && b.mode === 'air' && b.target >= 0 && s.agents[b.target]!.side === 'off' && b.arrive - s.t <= 0.2) {
      const a = s.agents[b.target]!;
      const st = catchStyle(s, a);
      const at = catchPoint(s, a);
      drawn = `${st} ahead ${at.ahead.toFixed(2)} m z ${(at.z * 0.9144).toFixed(2)} m`;
      const d = contactAt(s, a);
      if (d) box = ` box ${boxOut(a, d).toFixed(2)} on ${d.p.name}`;
    }
    stepPlay(s, c.script(s));
  }
  const th = s.events.find((e) => e.type === 'throw');
  const ev = s.events.filter((e) => ['catch', 'drop', 'deflection', 'interception', 'bobble', 'batted'].includes(e.type)).map((e) => `${e.type}@${e.t.toFixed(2)}${e.data?.look ? ':' + e.data.look : ''}`);
  const rec = s.pass ? s.agents[s.pass.target] : undefined;
  const rel = rec?.mem.catchRel as { x: number; y: number } | undefined;
  const tev = th?.data as { kind?: string; air?: number } | undefined;
  const rel0 = s.ball.releaseT;
  console.log(`${c.id}: ${out}${tev?.kind ?? '-'} air ${tev?.air ?? '-'} hang ${(s.ball.arrive - rel0).toFixed(2)} | lane ${th?.data?.lane ?? 0} | ${drawn}${box} | ${ev.join(' ')} -> ${s.result?.reason} ${s.result?.yards}${rel ? ` (caught ${Math.hypot(rel.x, rel.y).toFixed(2)} yd off his centre)` : ''}`);
}
