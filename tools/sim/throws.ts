// M6.5 #1: where every throw's error comes from. Runs the pass plays against
// every call with the AI on both sides and reads each throw's error sources
// off its event (passing.ts throwErrData): the cone's 1σ and what scaled it
// (distance, throwing on the move, pressure, a bad platform) and the
// mechanics miss (a sail or a short hop). Reports how far off the ball
// landed from where he meant it, by condition, and the brief's check: a
// 95-accuracy QB in a clean pocket puts a 15-yard throw within a yard.
// (Seeded per cell: the pass harness's shared seeds gave every play the same
// throw rolls for a given rep, so one rep in ten missed on every play.)
//   node tools/run-ts.mjs tools/sim/throws.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, PLAYS, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const N = Number(process.argv[2] ?? 20);

interface Throw { sep: number; hard: string; dropped: boolean; hands: number; acc: number; air: number; off: number; sigma: number; fDist: number; fMoving: number; fPressure: number; fPlatform: number; pMiss: number; mech: string; complete: boolean }
const out: Throw[] = [];
for (const play of PLAYS.filter((p) => !p.run)) {
  for (const def of DEF_CALLS) {
    for (let k = 0; k < N; k++) {
      const s = createPlay({ seed: cellSeed(play, def, k), offense: rosters.offense, defense: rosters.defense, play, def, los: 35, toGo: 10, user: false });
      runToWhistle(s, () => NEUTRAL);
      const e = s.events.find((ev) => ev.type === 'throw');
      if (!e || s.ball.target === -3 || e.data?.off === undefined) continue;
      const d = e.data as Record<string, number | string>;
      const drop = s.events.some((ev) => ev.type === 'drop');
      const rec = s.agents[e.who![1]!]!;
      out.push({ sep: s.result?.pass?.sep ?? -1, hard: s.result?.pass?.hard ?? '', dropped: drop, hands: rec.fx.a('catching'), acc: d.acc as number, air: d.air as number, off: d.off as number, sigma: d.sigma as number, fDist: d.fDist as number, fMoving: d.fMoving as number, fPressure: d.fPressure as number, fPlatform: d.fPlatform as number, pMiss: d.pMiss as number, mech: d.mech as string, complete: !!s.result?.pass?.complete });
    }
  }
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
const q = (xs: number[], p: number) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]! : NaN;
};
const clean = (t: Throw) => t.fPressure < 1.02 && t.fMoving < 1.02 && t.fPlatform === 1;
const row = (name: string, g: Throw[]) =>
  console.log(
    `${name.padEnd(34)} n ${String(g.length).padStart(5)}  off median ${q(g.map((t) => t.off), 0.5).toFixed(2)}  p90 ${q(g.map((t) => t.off), 0.9).toFixed(2)}  within 1 yd ${pct(g.filter((t) => t.off < 1).length, g.length).padStart(6)}  mechanics miss ${pct(g.filter((t) => t.mech).length, g.length).padStart(6)}  σ ${(g.reduce((a, t) => a + t.sigma, 0) / Math.max(1, g.length)).toFixed(2)}  cmp ${pct(g.filter((t) => t.complete).length, g.length)}`,
  );

console.log(`throws ${out.length} (the practice QB's accuracy by depth: ${[...new Set(out.map((t) => t.acc))].sort().join(', ')})`);
row('all', out);
row('clean pocket, set, not moving', out.filter(clean));
row('  clean, 10–20 air yd', out.filter((t) => clean(t) && t.air >= 10 && t.air <= 20));
row('under pressure', out.filter((t) => t.fPressure >= 1.02));
row('  heavy pressure (cone ×1.3+)', out.filter((t) => t.fPressure >= 1.3));
row('on the move', out.filter((t) => t.fMoving >= 1.02));
row('off platform', out.filter((t) => t.fPlatform > 1));
for (const [lo, hi] of [[-5, 0], [0, 10], [10, 20], [20, 30], [30, 99]] as const) row(`air ${lo}–${hi}`, out.filter((t) => t.air >= lo && t.air < hi));

// Error by source: the share of the cone's variance each factor adds over a
// clean 20-yard throw, and the mechanics misses (which aren't on the cone).
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const logs = (f: (t: Throw) => number) => mean(out.map((t) => Math.log(f(t))));
console.log('\nwhat widens the cone (mean multiplier over every throw): ' + [['distance', (t: Throw) => t.fDist], ['on the move', (t: Throw) => t.fMoving], ['pressure', (t: Throw) => t.fPressure], ['platform', (t: Throw) => t.fPlatform]].map(([n, f]) => `${n as string} ×${Math.exp(logs(f as (t: Throw) => number)).toFixed(2)}`).join(', '));
const mech = out.filter((t) => t.mech);
console.log(`mechanics misses: ${mech.length} (${pct(mech.length, out.length)}): sailed ${mech.filter((t) => t.mech === 'sail').length}, short-hopped ${mech.filter((t) => t.mech === 'short').length}; of them on a clean pocket ${pct(mech.filter(clean).length, mech.length)}`);
console.log(`throws more than 2 yd off: ${pct(out.filter((t) => t.off > 2).length, out.length)}, of them a mechanics miss ${pct(out.filter((t) => t.off > 2 && t.mech).length, out.filter((t) => t.off > 2).length)}`);

// Catching (M6.5 #3): balls that got to him open (2+ yd from the nearest defender), and what the drops were.
const reached = out.filter((t) => t.sep >= 0);
const open = reached.filter((t) => t.sep >= 2);
console.log(`\nreached the target ${reached.length}; open (2+ yd) ${open.length}: caught ${pct(open.filter((t) => t.complete).length, open.length)}, dropped ${pct(open.filter((t) => t.dropped).length, open.length)}`);
for (const [n, lo, hi] of [['sure hands (Catching 0.8+)', 0.8, 2], ['middling (0.5–0.8)', 0.5, 0.8], ['poor (<0.5)', -1, 0.5]] as const) {
  const g = open.filter((t) => t.hands >= lo && t.hands < hi);
  console.log(`  ${n.padEnd(28)} n ${String(g.length).padStart(4)}  caught ${pct(g.filter((t) => t.complete).length, g.length)}  dropped ${pct(g.filter((t) => t.dropped).length, g.length)}`);
}
const drops = reached.filter((t) => t.dropped);
console.log(`drops ${drops.length} (${pct(drops.length, reached.length)} of balls that got to him), by cause: ${[...new Set(drops.map((t) => t.hard))].map((h) => `${h || '?'} ${drops.filter((t) => t.hard === h).length}`).join(', ')}`);
