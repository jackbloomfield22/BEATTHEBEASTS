// M6.5 #8: how long run blocks hold. For every run-block engagement in the
// run harness: when it ended (shed, or the whistle), relative to the handoff
// and to the carrier reaching the line; a run-block win is holding 2.5 s or
// to the whistle (ESPN's RBWR; NFL teams ~70%).
//   node tools/run-ts.mjs tools/sim/runblocks.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { DEF_CALLS, RUN_PLAYS } from '../../src/sim/plays.ts';
import { createPlay } from '../../src/sim/state.ts';
import { stepPlay } from '../../src/sim/play.ts';
import { NEUTRAL } from '../../src/sim/input.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const N = Number(process.argv[2] ?? 10);
const HASHES = [3.08, 0, -3.08];
let total = 0;
let wins = 0;
const shedAfter: number[] = [];
const shedVsLos: number[] = [];
const byPos = new Map<string, { n: number; w: number }>();
for (const play of RUN_PLAYS.filter((p) => !p.situ))
  for (const def of DEF_CALLS)
    for (let k = 0; k < N; k++) {
      const sd = sidesFor(rosters, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      let losT = -1;
      for (let t = 0; t < 60 * 40 && !s.result; t++) {
        stepPlay(s, NEUTRAL);
        if (losT < 0 && s.carrier >= 0 && s.agents[s.carrier]!.side === 'off' && s.runReadT >= 0 && s.agents[s.carrier]!.pos.x >= s.setup.los) losT = s.t;
      }
      const end = s.whistleT > 0 ? s.whistleT : s.t;
      const engages = s.events.filter((e) => e.type === 'engage' && s.agents[e.who![0]!]!.side === 'off' && s.agents[e.who![0]!]!.p.pos === 'OL');
      for (const e of engages) {
        const [b, d] = e.who!;
        const shed = s.events.find((x) => x.type === 'shed' && x.who![0] === d && x.who![1] === b && x.t >= e.t);
        const held = (shed ? shed.t : end) - e.t;
        const win = !shed || held >= 2.5;
        total++;
        if (win) wins++;
        const key = s.agents[d!]!.p.pos;
        const r = byPos.get(key) ?? { n: 0, w: 0 };
        r.n++;
        if (win) r.w++;
        byPos.set(key, r);
        if (shed) {
          shedAfter.push(held);
          if (losT >= 0) shedVsLos.push(shed.t - losT);
          const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
          if (c && shed.at === undefined) void 0;
          if (shed.data && typeof shed.data.after === 'number') void 0;
        }
      }

    }
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))] ?? NaN;
console.log(`OL run blocks ${total}: RBWR ${((100 * wins) / total).toFixed(1)}% (NFL team ~70%)`);
console.log(`by the defender's position: ${[...byPos].map(([k, v]) => `${k} ${((100 * v.w) / v.n).toFixed(0)}% of ${v.n}`).join(', ')}`);
console.log(`sheds ${shedAfter.length}: held before the shed p25 ${q(shedAfter, 0.25).toFixed(2)} s, median ${q(shedAfter, 0.5).toFixed(2)}, p75 ${q(shedAfter, 0.75).toFixed(2)}`);
console.log(`shed time minus the carrier reaching the line: p25 ${q(shedVsLos, 0.25).toFixed(2)} s, median ${q(shedVsLos, 0.5).toFixed(2)}, p75 ${q(shedVsLos, 0.75).toFixed(2)}; shed before he gets there ${((100 * shedVsLos.filter((x) => x < 0).length) / Math.max(1, shedVsLos.length)).toFixed(0)}%, within 0.5 s after ${((100 * shedVsLos.filter((x) => x >= 0 && x < 0.5).length) / Math.max(1, shedVsLos.length)).toFixed(0)}%`);
