// Find a scripted run for the carrier-animation captures (M6.5 #11,
// tools/shots/carriergame.spec.ts): a designed run the player steers with a
// hard cut and a lighter one (src/game/clips.ts runAndCut) that gets through
// both cuts, bursts out of them, and meets a tackler closing in front (the
// dip). Also counts any downed man in his path (a hurdle chance).
//   node tools/run-ts.mjs tools/sim/findcarry.ts
import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { threatOf } from '../../src/sim/moves.ts';
import { runAndCut } from '../../src/game/clips.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const out: string[] = [];
for (const play of ['singleback-inside-zone', 'iform-iso', 'singleback-power', 'doubles-draw']) {
  for (const def of ['cover2', 'cover3', 'cover1']) {
    for (const [cutPast, cutY] of [[2, 3], [2, -4], [3, 4], [1.5, 3.5]] as const) {
      for (let seed = 1; seed < 30; seed++) {
        const s = createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(play), def: defById(def), los: 30, toGo: 10, user: true });
        const script = runAndCut(cutPast, cutY);
        let dips = 0;
        let hurdle = 0;
        for (let k = 0; k < 60 * 14 && !s.result; k++) {
          stepPlay(s, script(s));
          if (s.phase !== 'carrier' || s.carrier < 0) continue;
          const c = s.agents[s.carrier]!;
          const d = threatOf(s, c);
          if (d && Math.hypot(d.pos.x - c.pos.x, d.pos.y - c.pos.y) < 1.4) dips++;
          const sp = Math.hypot(c.vel.x, c.vel.y);
          for (const o of s.agents) {
            if (!o.down || o === c || sp < 5) continue;
            const rx = o.pos.x - c.pos.x;
            const ry = o.pos.y - c.pos.y;
            const tc = (rx * c.vel.x + ry * c.vel.y) / (sp * sp);
            if (tc > 0.3 && tc < 0.62 && Math.hypot(rx - c.vel.x * tc, ry - c.vel.y * tc) < 0.8) hurdle++;
          }
        }
        const cuts = s.events.filter((e) => e.type === 'move' && e.data?.move === 'cut');
        const bursts = s.events.filter((e) => e.type === 'move' && e.data?.move === 'burst').length;
        if (cuts.length < 2 || !s.result) continue;
        const degs = cuts.map((e) => e.data!.deg).join('/');
        const tag = `${play} ${def} cut ${cutPast},${cutY} seed ${seed}: ${s.result.reason} ${s.result.yards.toFixed(1)} yd, ${s.t.toFixed(1)} s, cuts ${degs}, bursts ${bursts}, dip ticks ${dips}, hurdle ticks ${hurdle}`;
        if (s.result.yards > 6 && dips > 3) out.push(tag);
      }
    }
  }
}
console.log(out.slice(0, 40).join('\n'));
