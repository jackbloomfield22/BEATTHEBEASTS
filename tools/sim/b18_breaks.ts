// Animation round 18 (docs/anim/BREAK18.md): the defenders' breaks on the ball in the sim, to choose the break-heavy
// plays and to see what the sim's velocity does through a break. Round 17's finder (q17_breaks.ts) counted any tick
// that was both past 58 deg off the facing and over 2 yd/s along it, so most of its "breaks" were one tick long. Here a
// break is a back or linebacker in his pedal (backward along his facing faster than 0.8 yd/s, the render's pedal line,
// choreo.ts drive) or his shuffle (58-122 deg off his facing, 1-4.3 yd/s: the side layer) whose velocity then comes
// within 50 deg of his facing at over 2 m/s within 0.6 s, his facing turning less than 60 deg meanwhile. For each: when,
// who, from what, how long it took, how far the velocity swung (deg), the facing's turn, and the ball.
//   node tools/run-ts.mjs tools/sim/b18_breaks.ts [--ids=p9-curl,...] [--slot=RCB --from=1.9 --to=2.6] [--all]
//   (--slot: that man's speed along his facing (m/s), ground speed, velocity angle off the facing and facing every tick
//   in the window; --all: every clip in the library, else the ids given)
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { CLIPS, CONCEPTS, PHYSICS, PASSING, PASSING2, PASSING3, PASSING5, PASSING6, PASSING7, PASSING8, PASSING9, PASSING10, PASSING17, withSwap, type Clip } from '../../src/game/clips.ts';

const YD = 0.9144;
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const ids = process.argv.find((a) => a.startsWith('--ids='))?.slice(6).split(',');
const list: Clip[] = [...CLIPS, ...CONCEPTS, ...PHYSICS, ...PASSING, ...PASSING2, ...PASSING3, ...PASSING5, ...PASSING6, ...PASSING7, ...PASSING8, ...PASSING9, ...PASSING10, ...PASSING17].filter((c, k, all) => (!ids || ids.includes(c.id)) && all.findIndex((o) => o.id === c.id) === k);
const slot = process.argv.find((a) => a.startsWith('--slot='))?.slice(7);
const from = Number(process.argv.find((a) => a.startsWith('--from='))?.slice(7) ?? 0);
const to = Number(process.argv.find((a) => a.startsWith('--to='))?.slice(5) ?? 99);
const BACK7 = /LB|CB|^S$|FS|SS|NB/;
const deg = (r: number) => Math.round((r * 180) / Math.PI);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
let total = 0;
for (const c of list) {
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  const s: PlayState = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  const last = new Map<number, { t: number; kind: string; face: number; dir: number; sp: number }>();
  const out: string[] = [];
  for (let k = 0; k < 1500 && !s.result; k++) {
    stepPlay(s, c.script(s));
    if (s.snapT < 0) continue;
    for (const i of s.def) {
      const d = s.agents[i]!;
      if (!BACK7.test(d.slot as string)) continue;
      const ts = s.t - s.snapT;
      const sp = Math.hypot(d.vel.x, d.vel.y);
      const along = d.vel.x * Math.cos(d.face) + d.vel.y * Math.sin(d.face);
      const dir = Math.atan2(d.vel.y, d.vel.x);
      const off = sp > 0.3 ? Math.abs(wrap(dir - d.face)) : 0;
      if (slot === d.slot && ts >= from && ts <= to) out.push(`  ${ts.toFixed(3)} along ${(along * YD).toFixed(2)} ground ${(sp * YD).toFixed(2)} off ${deg(wrap(dir - d.face))} face ${deg(d.face)} anim ${d.anim}`);
      if (along < -0.8 && sp < 5.2) last.set(i, { t: s.t, kind: 'pedal', face: d.face, dir, sp });
      else if (off > (58 * Math.PI) / 180 && off < (122 * Math.PI) / 180 && sp > 1 && sp < 4.3) last.set(i, { t: s.t, kind: 'shuffle', face: d.face, dir, sp });
      const l = last.get(i);
      if (l && sp * YD > 2 && off < (50 * Math.PI) / 180 && s.t - l.t < 0.6) {
        const turned = Math.abs(wrap(d.face - l.face));
        if (turned < (60 * Math.PI) / 180) {
          total++;
          const side = Math.sign(wrap(dir - d.face)) > 0 ? 'L' : 'R';
          out.push(`${d.slot} ${l.kind}->drive at ${ts.toFixed(2)} (${l.kind} at ${(l.sp * YD).toFixed(1)} m/s until ${(l.t - s.snapT).toFixed(2)}, ${Math.round((s.t - l.t) * 60)} ticks; velocity swung ${deg(Math.abs(wrap(dir - l.dir)))} deg, now ${deg(off)}${side} off the facing; facing turned ${deg(turned)}) ball ${s.ball.mode}${s.ball.mode === 'air' ? ` to ${s.agents[s.ball.target]?.slot}` : ''} anim ${d.anim}`);
        }
        last.delete(i);
      }
    }
  }
  if (out.length) console.log(`== ${c.id}\n${out.join('\n')}`);
}
console.log(`${total} breaks`);
