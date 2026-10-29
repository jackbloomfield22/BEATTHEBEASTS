// Animation round 17 (docs/passing/PASSING17.md): the quarterback's movement in the pocket, in Node as the Practice
// Field runs it. Two modes:
//   node tools/run-ts.mjs tools/sim/q17_pocket.ts --ids=p17-slide-l,...      each clip's QB tick by tick (every 0.05 s from
//       the set): phase, ground speed (m/s), his velocity's angle off his facing (deg, + left), facing, windup and ball;
//   node tools/run-ts.mjs tools/sim/q17_pocket.ts --scan=play:def:seeds       the AI's pockets (user false): each seed's
//       time the QB moves faster than 0.8 m/s after the set, by kind (a slide: 58-122 deg off his facing; up; back), the
//       longest stretch of each, and the outcome, to choose the AI's slide, climb and escape.
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, NEUTRAL, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { CLIPS, PASSING9, PASSING17, withSwap, type Clip } from '../../src/game/clips.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const YARD = 0.9144;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const deg = (r: number) => Math.round((r * 180) / Math.PI);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function make(c: Clip): PlayState {
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  return createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
}

const scan = arg('scan');
if (scan) {
  const [play, def, seeds] = scan.split(':');
  const [a, b] = seeds!.split('-').map(Number);
  for (let seed = a!; seed <= b!; seed++) {
    const s = make({ id: 'scan', title: '', seed, play: play!, def: def!, los: 30, user: false, script: () => NEUTRAL });
    const kinds: Record<string, { t: number; run: number; best: number }> = { slideL: { t: 0, run: 0, best: 0 }, slideR: { t: 0, run: 0, best: 0 }, up: { t: 0, run: 0, best: 0 }, back: { t: 0, run: 0, best: 0 } };
    let maxSp = 0;
    let rel = -1;
    for (let k = 0; k < 1500 && !s.result; k++) {
      stepPlay(s, NEUTRAL);
      const qb = s.agents[s.qb]!;
      if (s.ball.mode === 'air' && rel < 0) rel = s.t - s.snapT;
      if (s.phase !== 'pocket' || s.scrambleT >= 0) {
        for (const v of Object.values(kinds)) v.run = 0;
        continue;
      }
      const sp = Math.hypot(qb.vel.x, qb.vel.y) * YARD;
      maxSp = Math.max(maxSp, sp);
      const th = sp > 0.8 ? wrap(Math.atan2(qb.vel.y, qb.vel.x) - qb.face) : NaN;
      const kind = Number.isNaN(th) ? null : Math.abs(th) < 1.01 ? 'up' : Math.abs(th) > 2.13 ? 'back' : th > 0 ? 'slideL' : 'slideR';
      for (const [n, v] of Object.entries(kinds)) {
        if (n === kind) {
          v.t += 1 / 60;
          v.run += 1 / 60;
          v.best = Math.max(v.best, v.run);
        } else v.run = 0;
      }
    }
    const res = s.result as unknown as { kind?: string; yards?: number } | null;
    const f = (v: { t: number; best: number }) => `${v.t.toFixed(2)}/${v.best.toFixed(2)}`;
    console.log(`${play}:${def}:${seed} slideL ${f(kinds.slideL!)} slideR ${f(kinds.slideR!)} up ${f(kinds.up!)} back ${f(kinds.back!)} | max ${maxSp.toFixed(1)} m/s | ball ${rel.toFixed(2)} | scramble ${s.scrambleT >= 0 ? (s.scrambleT - s.snapT).toFixed(2) : '-'} | ${res?.kind ?? '?'} ${res?.yards ?? ''}`);
  }
} else {
  const ids = arg('ids')?.split(',');
  const list: Clip[] = [...CLIPS, ...PASSING9, ...PASSING17].filter((c) => !ids || ids.includes(c.id));
  for (const c of list) {
    const s = make(c);
    const lines: string[] = [];
    let last = -1;
    for (let k = 0; k < 1500 && !s.result; k++) {
      stepPlay(s, c.script(s));
      if (s.snapT < 0) continue;
      const t = s.t - s.snapT;
      const q = s.agents[s.qb]!;
      const n = Math.floor(t / 0.05);
      if (n === last) continue;
      last = n;
      const sp = Math.hypot(q.vel.x, q.vel.y) * YARD;
      const th = sp > 0.3 ? `${deg(wrap(Math.atan2(q.vel.y, q.vel.x) - q.face))}` : '-';
      lines.push(`${t.toFixed(2)} ${s.phase.padEnd(8)} sp ${sp.toFixed(2)} off ${th.padStart(4)} face ${deg(q.face)} pos ${q.pos.x.toFixed(1)},${q.pos.y.toFixed(1)}${s.windup ? ` W(${(s.windup.at - s.snapT).toFixed(2)})` : ''}${s.ball.mode === 'air' ? ' AIR' : ''}${s.scrambleT >= 0 ? ' SCR' : ''} anim ${q.anim}`);
      if (s.ball.mode === 'air' && t > s.ball.releaseT - s.snapT + 0.6) break;
    }
    const res = s.result as unknown as { kind?: string; yards?: number } | null;
    console.log(`== ${c.id} (set ${s.setup.play.drop.set}) -> ${res?.kind ?? 'running'} ${res?.yards ?? ''}`);
    if (!arg('quiet')) console.log(lines.join('\n'));
  }
}
