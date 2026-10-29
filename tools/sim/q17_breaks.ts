// Animation round 17 (docs/passing/PASSING17.md): the defenders' breaks on the ball, in Node as the Practice Field runs
// each recorded play: a back or linebacker going from his pedal (along his facing under -1 yd/s) or a shuffle (more than
// 58 deg off his facing) to driving forward (over 2 yd/s along it) within half a second, with the time, his speeds and
// where the ball is, to choose the close-up of a break on the ball.
//   node tools/run-ts.mjs tools/sim/q17_breaks.ts [--ids=p9-out,...]
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { CLIPS, PASSING9, PASSING17, withSwap, type Clip } from '../../src/game/clips.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const ids = process.argv.find((a) => a.startsWith('--ids='))?.slice(6).split(',');
const list: Clip[] = [...CLIPS, ...PASSING9, ...PASSING17].filter((c) => !ids || ids.includes(c.id));
for (const c of list) {
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  const s: PlayState = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  const last = new Map<number, { t: number; kind: string }>();
  const out: string[] = [];
  for (let k = 0; k < 1500 && !s.result; k++) {
    stepPlay(s, c.script(s));
    if (s.snapT < 0) continue;
    for (const i of s.def) {
      const d = s.agents[i]!;
      const sp = Math.hypot(d.vel.x, d.vel.y);
      const along = d.vel.x * Math.cos(d.face) + d.vel.y * Math.sin(d.face);
      const off = sp > 0.5 ? Math.abs(Math.atan2(Math.sin(Math.atan2(d.vel.y, d.vel.x) - d.face), Math.cos(Math.atan2(d.vel.y, d.vel.x) - d.face))) : 0;
      if (along < -1) last.set(i, { t: s.t, kind: 'pedal' });
      else if (off > 1.01 && off < 2.13 && sp > 1) last.set(i, { t: s.t, kind: 'shuffle' });
      const l = last.get(i);
      if (l && along > 2 && s.t - l.t < 0.5) {
        out.push(`${d.slot} ${l.kind}->drive at ${(s.t - s.snapT).toFixed(2)} (${l.kind} until ${(l.t - s.snapT).toFixed(2)}) ball ${s.ball.mode}${s.ball.mode === 'air' ? ` to ${s.agents[s.ball.target]?.slot}` : ''}`);
        last.delete(i);
      }
    }
  }
  console.log(`== ${c.id}\n${out.join('\n')}`);
}
