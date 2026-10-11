// Passing round 11 (docs/passing/PASSING11.md): the open ball in the AI book (2+ yd of separation as it gets to him, the
// outcomes harness's line), what happens to the ones not caught, and the defender coming at him as it arrives: how far,
// how fast he's closing and how soon he'll be on him; and the catch rate by that. Read-only on the sim.
//   node tools/run-ts.mjs tools/sim/p11_open.ts [reps a cell, 4]
import { readFileSync } from 'node:fs';
import { createPlay, NEUTRAL, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { DEF_CALLS, PASS_PLAYS } from '../../src/sim/plays.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const n = Number(process.argv[2] ?? 4);
const HASHES = [3.08, 0, -3.08];
type Row = { sep: number; out: string; arrive: number; hard: string; middle: boolean; behind: number };
const rows: Row[] = [];
for (const play of PASS_PLAYS.filter((p) => !p.situ && !p.unlock))
  for (const def of DEF_CALLS)
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(rosters, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      let row: Row | null = null;
      for (let t = 0; t < 60 * 40 && !s.result; t++) {
        stepPlay(s, NEUTRAL);
        if (!row && s.pass?.sep !== undefined && s.pass.target >= 0) {
          const a = s.agents[s.pass.target]!;
          // The defender who'll be on him soonest: his distance over his closing speed (s).
          let arrive = 99;
          for (const i of s.def) {
            const o = s.agents[i]!;
            if (o.down) continue;
            const dx = a.pos.x - o.pos.x;
            const dy = a.pos.y - o.pos.y;
            const d = Math.hypot(dx, dy);
            const close = ((o.vel.x - a.vel.x) * dx + (o.vel.y - a.vel.y) * dy) / Math.max(1e-6, d);
            if (close > 0.5) arrive = Math.min(arrive, Math.max(0, d - 1) / close);
          }
          const sp = Math.hypot(a.vel.x, a.vel.y);
          const b = s.ball;
          const behind = sp > 3 ? -((b.pos.x - a.pos.x) * a.vel.x + (b.pos.y - a.pos.y) * a.vel.y) / sp : 0;
          row = { sep: s.pass.sep, out: '', arrive, hard: s.pass.hard ?? '-', middle: Math.abs(a.pos.y) < 9, behind };
        }
      }
      if (row) {
        const ev = s.events.find((e) => ['catch', 'drop', 'deflection', 'interception'].includes(e.type));
        row.out = s.pass?.complete ? 'catch' : ev ? ev.type : 'miss';
        rows.push(row);
      }
    }
const open = rows.filter((r) => r.sep >= 2);
const rate = (xs: Row[]) => `${xs.length ? ((100 * xs.filter((r) => r.out === 'catch').length) / xs.length).toFixed(1) : '-'}% of ${xs.length}`;
console.log(`${rows.length} balls to a man; open (2+ yd) ${open.length}, caught ${rate(open)}`);
const outs = new Map<string, number>();
for (const r of open) if (r.out !== 'catch') outs.set(r.out, (outs.get(r.out) ?? 0) + 1);
console.log(`open, not caught: ${[...outs].map(([k, v]) => `${k} ${v}`).join(', ')}`);
const hards = new Map<string, number>();
for (const r of open) if (r.out !== 'catch') hards.set(r.hard, (hards.get(r.hard) ?? 0) + 1);
console.log(`open, not caught, by the biggest catch cost: ${[...hards].map(([k, v]) => `${k} ${v}`).join(', ')}`);
for (const [lo, hi] of [[0, 0.3], [0.3, 0.6], [0.6, 1], [1, 99], [99, 100]] as const) {
  const xs = open.filter((r) => r.arrive >= lo && r.arrive < hi);
  console.log(`  a defender on him in ${lo}-${hi} s: ${rate(xs)} (over the middle ${rate(xs.filter((r) => r.middle))})`);
}
for (const [lo, hi] of [[-99, 0.3], [0.3, 1], [1, 99]] as const) console.log(`  thrown ${lo}-${hi} yd behind him: ${rate(open.filter((r) => r.behind >= lo && r.behind < hi))}`);
