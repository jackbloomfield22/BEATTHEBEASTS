// The bobble and the re-catch (docs/passing/PASSING2.md, item 4): how often a
// ball is juggled in the AI pass game, and what becomes of it (secured a beat
// later, dropped, knocked loose, picked), by the receiver's hands.
//   node tools/run-ts.mjs tools/sim/bobbles.ts [playsPerCell] [--list]
import { readFileSync } from 'node:fs';
import { createPlay, practiceRosters, stepPlay, NEUTRAL, PASS_PLAYS, DEF_CALLS, type SnapshotLike } from '../../src/sim/index.ts';
import { sidesFor, cellSeed } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const n = Number(process.argv[2] ?? 10);
const HASHES = [3.08, 0, -3.08];
let targets = 0;
let catches = 0;
const after = new Map<string, number>();
const byWho = new Map<string, { t: number; b: number; c: number }>();
const list: string[] = [];
for (const play of PASS_PLAYS.filter((p) => !p.situ && !p.unlock)) {
  for (const def of DEF_CALLS) {
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(r, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      for (let t = 0; t < 60 * 40 && !s.result; t++) stepPlay(s, NEUTRAL);
      const res = s.result!;
      if (!res.pass?.attempted || res.pass.target < 0) continue;
      targets++;
      if (res.pass.complete) catches++;
      const tg = s.agents[res.pass.target]!;
      const w = byWho.get(tg.p.name) ?? { t: 0, b: 0, c: 0 };
      w.t++;
      const i = s.events.findIndex((e) => e.type === 'bobble');
      if (i >= 0) {
        w.b++;
        const next = s.events.slice(i + 1).find((e) => ['catch', 'drop', 'deflection', 'interception', 'whistle'].includes(e.type));
        const how = next?.type === 'whistle' ? `ground` : (next?.type ?? '?');
        after.set(how, (after.get(how) ?? 0) + 1);
        if (how === 'catch') w.c++;
        if (list.length < 20) list.push(`${play.id} ${def.id} ${k}: ${tg.p.name} → ${how} (${(next!.t - s.events[i]!.t).toFixed(2)} s later) ${res.yards} yd`);
      }
      byWho.set(tg.p.name, w);
    }
  }
}
const nb = [...after.values()].reduce((a, b) => a + b, 0);
console.log(`targets ${targets}, completions ${catches} (${((100 * catches) / targets).toFixed(1)}%), bobbles ${nb} (${((100 * nb) / targets).toFixed(1)}% of targets)`);
console.log('after the bobble: ' + [...after].map(([k, v]) => `${k} ${v} (${((100 * v) / nb).toFixed(0)}%)`).join(', '));
for (const [k, v] of [...byWho].sort((a, b) => b[1].t - a[1].t)) if (v.t >= 30) console.log(`${k.padEnd(18)} targets ${v.t} bobbled ${((100 * v.b) / v.t).toFixed(1)}%, secured ${v.b ? ((100 * v.c) / v.b).toFixed(0) : '-'}%`);
if (process.argv.includes('--list')) console.log(list.join('\n'));
