// Passing round 9 (docs/passing/PASSING9.md): what Tyreek Hill's yards after
// the catch are made of against Wes Welker's, on identity.ts's X sample: his
// speed at the catch and 0.5 s / 1 s after it, the ground to the nearest
// defender at the catch and a second later (does he pull away?), when the
// first hand lands on him, and the yards after the catch by play.
//   node tools/run-ts.mjs tools/sim/p9_yac.ts "Tyreek Hill,WR" "Wes Welker,WR" [repsMul]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { cellSeed } from '../../src/sim/outcomes.ts';
import type { PlayState } from '../../src/sim/state.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const [A, B, MUL] = process.argv.slice(2);
const mul = Number(MUL ?? 6);
const plays = ['doubles-slants', 'doubles-quick-outs', 'doubles-curls', 'singleback-pa-post'];
const covers = ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man'].map(defById);
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));
const nearest = (s: PlayState) => {
  const c = s.agents[s.carrier]!;
  let d = Infinity;
  for (const i of s.def) if (!s.agents[i]!.down) d = Math.min(d, Math.hypot(s.agents[i]!.pos.x - c.pos.x, s.agents[i]!.pos.y - c.pos.y));
  return d;
};
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
for (const who of [A!, B!]) {
  const [name, pos] = who.split(',');
  const p = simPlayer(findStint(snap, name!, pos)!, 99);
  const off = { ...base.offense, X: p };
  const all: Record<string, number[]> = { yac: [], v0: [], v05: [], v1: [], d0: [], d1: [], contact: [], vmax: [] };
  const byPlay: string[] = [];
  for (const id of plays) {
    const play = PLAYS.find((q) => q.id === id)!;
    const ys: number[] = [];
    for (const def of covers) for (let k = 0; k < mul; k++) for (const at of [45, 70, 95]) {
      const s = createPlay({ seed: cellSeed(play, def, k), offense: off, defense: base.defense, play, def, los: 35, toGo: 10, user: true });
      const icon = s.icons.findIndex((i) => s.agents[i]!.slot === 'X') + 1;
      const me = s.agents.find((a) => a.slot === 'X')!;
      let t0 = -1;
      const rec: Record<string, number> = {};
      for (let n = 0; n < 1800 && !s.result; n++) {
        const t = since(s);
        const inp = s.phase === 'air' ? input({ catchType: 'rac' }) : s.phase === 'carrier' ? input({ move: { x: 1, y: 0 }, sprint: nearest(s) >= 2.6 }) : input({ snap: s.phase === 'presnap', throwHeld: icon > 0 && t >= at && t < at + 3 ? icon : 0 });
        stepPlay(s, inp);
        if (s.phase === 'carrier' && s.carrier === me.i) {
          if (t0 < 0) {
            t0 = s.t;
            rec.v0 = Math.hypot(me.vel.x, me.vel.y);
            rec.d0 = nearest(s);
          }
          const dt = s.t - t0;
          if (rec.v05 === undefined && dt >= 0.5) rec.v05 = Math.hypot(me.vel.x, me.vel.y);
          if (rec.v1 === undefined && dt >= 1) {
            rec.v1 = Math.hypot(me.vel.x, me.vel.y);
            rec.d1 = nearest(s);
          }
          if (rec.contact === undefined && s.events.some((e) => e.t >= t0 && (e.type === 'hit' || e.type === 'brokenTackle' || e.type === 'missedTackle') && e.who?.includes(me.i))) rec.contact = dt;
        }
      }
      const pr = s.result?.pass;
      if (!pr?.attempted || pr.target !== me.i || !pr.complete) continue;
      const y = s.result!.yards - pr.airYards;
      ys.push(y);
      all.yac!.push(y);
      all.vmax!.push(me.fx.vmax);
      for (const k of ['v0', 'v05', 'v1', 'd0', 'd1', 'contact']) if (rec[k] !== undefined) all[k]!.push(rec[k]!);
    }
    const big = ys.filter((y) => y >= 10).length;
    byPlay.push(`${id.padEnd(20)} n ${String(ys.length).padStart(4)} yac ${mean(ys).toFixed(2)} med ${([...ys].sort((a, b) => a - b)[Math.floor(ys.length / 2)] ?? NaN).toFixed(1)} 10+ ${((100 * big) / Math.max(1, ys.length)).toFixed(0)}%`);
  }
  console.log(`${name}: yac ${mean(all.yac!).toFixed(2)} (n ${all.yac!.length}) vmax ${mean(all.vmax!).toFixed(2)} | speed at catch ${mean(all.v0!).toFixed(2)}, +0.5 s ${mean(all.v05!).toFixed(2)}, +1 s ${mean(all.v1!).toFixed(2)} yd/s | nearest at catch ${mean(all.d0!).toFixed(2)}, +1 s ${mean(all.d1!).toFixed(2)} yd | first contact ${mean(all.contact!).toFixed(2)} s after (n ${all.contact!.length})`);
  for (const o of byPlay) console.log('  ' + o);
}
