// The run game's shape: a histogram of carries, yards before first contact
// and after it, and the plays behind the explosive ones.
//   node tools/run-ts.mjs tools/sim/runhist.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { formatRunDist, runDistribution } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const d = runDistribution(practiceRosters(snap), Number(process.argv[2] ?? 10));
console.log(formatRunDist(d));
// Whole yards, as the stat sheet spots them, beside an NFL reference: RB
// carries 2018–23 (nflverse play-by-play, designed runs), approximate shares
// to the nearest point. A reference for the shape, not a target to the decimal.
const BINS: [string, number, number, number][] = [
  ['loss', -99, -1, 10],
  ['0', 0, 0, 8],
  ['1–3', 1, 3, 34],
  ['4–6', 4, 6, 25],
  ['7–9', 7, 9, 11],
  ['10–19', 10, 19, 9.5],
  ['20–39', 20, 39, 2.2],
  ['40+', 40, 999, 0.5],
];
const ys = d.samples.map((p) => Math.round(p.yards));
console.log('yards    sim     NFL');
for (const [name, lo, hi, ref] of BINS) {
  const n = ys.filter((y) => y >= lo && y <= hi).length;
  const pc = (100 * n) / ys.length;
  console.log(`${name.padEnd(6)} ${pc.toFixed(1).padStart(5)}%  ${ref.toFixed(1).padStart(4)}%  ${'#'.repeat(Math.round(pc))}`);
}
const sorted = [...ys].sort((a, b) => a - b);
console.log(`median (whole yards) ${sorted[sorted.length >> 1]}; 4–7 yd ${((100 * ys.filter((y) => y >= 4 && y <= 7).length) / ys.length).toFixed(1)}%`);
const byPlay = new Map<string, number[]>();
for (const p of d.samples) byPlay.set(p.play, [...(byPlay.get(p.play) ?? []), p.yards]);
for (const [k, v] of byPlay) {
  const s = [...v].sort((a, b) => a - b);
  console.log(`${k.padEnd(24)} ypc ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1).padStart(5)} median ${s[s.length >> 1]!.toFixed(1).padStart(5)} stuff ${Math.round((100 * v.filter((y) => y <= 0).length) / v.length)}% 10+ ${Math.round((100 * v.filter((y) => y >= 10).length) / v.length)}%`);
}
const ac = d.samples.map((p) => p.yards - Math.max(0, p.contact));
console.log(`yards after first contact: ${(ac.reduce((a, b) => a + b, 0) / ac.length).toFixed(2)} (NFL ~2.8–3.0 per carry)`);
const long = d.samples.filter((p) => p.yards >= 10);
console.log(`10+ runs: ${long.length}, with a broken or missed tackle ${long.filter((p) => p.broken > 0).length}, first contact past 5 yd ${long.filter((p) => p.contact > 5).length}`);
