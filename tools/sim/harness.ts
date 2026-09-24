// Headless sim harness (TECH_PLAN §10 "Headless"): runs the M5 plays against
// each coverage with the AI on both sides and prints the outcome spread.
//   node tools/run-ts.mjs tools/sim/harness.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, PLAYS, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const N = Number(process.argv[2] ?? 60);

interface Cell { plays: number; att: number; comp: number; int: number; sacks: number; yards: number; passYds: number; runs: number; runYds: number; td: number; timeouts: number; ticks: number; reasons: Record<string, number> }
const total: Cell = { plays: 0, att: 0, comp: 0, int: 0, sacks: 0, yards: 0, passYds: 0, runs: 0, runYds: 0, td: 0, timeouts: 0, ticks: 0, reasons: {} };
const rows: string[] = [];
for (const play of PLAYS) {
  for (const def of DEF_CALLS) {
    const c: Cell = { plays: 0, att: 0, comp: 0, int: 0, sacks: 0, yards: 0, passYds: 0, runs: 0, runYds: 0, td: 0, timeouts: 0, ticks: 0, reasons: {} };
    for (let k = 0; k < N; k++) {
      const s = createPlay({ seed: 1000 + k * 7919, offense: rosters.offense, defense: rosters.defense, play, def, los: 35, toGo: 10, user: false });
      runToWhistle(s, () => NEUTRAL);
      const r = s.result!;
      for (const cc of [c, total]) {
        cc.plays++;
        cc.ticks += r.ticks;
        cc.reasons[r.reason] = (cc.reasons[r.reason] ?? 0) + 1;
        if (r.reason === 'timeout') cc.timeouts++;
        if (r.touchdown && r.offenseBall) cc.td++;
        if (r.sack) cc.sacks++;
        if (r.pass?.attempted) {
          cc.att++;
          if (r.pass.complete) { cc.comp++; cc.passYds += r.yards; }
          if (r.pass.intercepted) cc.int++;
        } else if (!r.sack) { cc.runs++; cc.runYds += r.yards; }
        cc.yards += r.offenseBall ? r.yards : 0;
      }
    }
    rows.push(`${play.id.padEnd(18)} ${def.id.padEnd(7)} cmp ${pct(c.comp, c.att)} ypa ${(c.passYds / Math.max(1, c.att)).toFixed(1).padStart(5)} int ${pct(c.int, c.att)} sack ${pct(c.sacks, c.plays)} ypc ${c.runs ? (c.runYds / c.runs).toFixed(1).padStart(5) : '    -'} ypp ${(c.yards / c.plays).toFixed(1).padStart(5)} td ${c.td} len ${(c.ticks / c.plays / 60).toFixed(1)}s ${JSON.stringify(c.reasons)}`);
  }
}
function pct(a: number, b: number) { return b ? `${Math.round((100 * a) / b)}%`.padStart(4) : '   -'; }
console.log(rows.join('\n'));
const t = total;
console.log(`\nALL: plays ${t.plays} cmp ${pct(t.comp, t.att)} ypa ${(t.passYds / Math.max(1, t.att)).toFixed(1)} int ${pct(t.int, t.att)} sack ${pct(t.sacks, t.plays)} ypc ${(t.runYds / Math.max(1, t.runs)).toFixed(1)} timeouts ${t.timeouts} ${JSON.stringify(t.reasons)}`);
