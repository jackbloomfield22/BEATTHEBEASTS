// Calibrate the Beasts' strength bar and the Daily's handicap on the new OVR
// (GDD §5.1, TECH_PLAN §17 R2/R3). Prints the numbers src/game/beasts.ts and
// src/game/daily.ts cite.
//   node tools/run-ts.mjs tools/sim/calibrate-beasts.ts
import { readFileSync } from 'node:fs';
import { assembleBeastsOnce, rateBeasts } from '../../src/engine/legacy/beasts.ts';
import { makeRng } from '../../src/engine/rng/index.ts';
import { assembleRatedBeasts } from '../../src/game/beasts.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as { entries: { id: string; ovr: number }[] };
const ovr = new Map(snap.entries.map((e) => [e.id, e.ovr]));
const N = 20000;
const legacy: number[] = [];
for (let i = 0; i < N; i++) legacy.push(rateBeasts(assembleBeastsOnce(makeRng(1000 + i))).rating);
// First rolls of the new assembly: bar 999 never accepts, so read the first roll's rating via a 1-attempt probe.
const firsts: number[] = [];
for (let i = 0; i < N; i++) firsts.push(assembleRatedBeasts(makeRng(1000 + i), (id) => ovr.get(id), -1).rating.rating);
const share = legacy.filter((r) => r >= 88).length / N;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`legacy: ${(100 * share).toFixed(1)}% of first rolls rate 88+ (mean ${mean(legacy).toFixed(1)})`);
for (let bar = 86; bar <= 96; bar++) console.log(`  OVR bar ${bar}: ${(100 * firsts.filter((r) => r >= bar).length / N).toFixed(1)}% of first rolls (mean ${mean(firsts).toFixed(1)})`);

// ---- The Daily's diffAdj on the new scale -----------------------------------
import { getDailyChallenge } from '../../src/engine/legacy/daily.ts';
import { rateBeasts as rate } from '../../src/engine/legacy/beasts.ts';
import { makeCatalog } from '../../src/game/draft.ts';
import { newDaily } from '../../src/game/daily.ts';
const numbers = JSON.parse(readFileSync('data/augment/jerseys.json', 'utf8')).numbers;
const cat = makeCatalog(JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')), numbers);
const rows: { y: number; b: number; a: number; lb: number; li: number }[] = [];
const d0 = Date.UTC(2026, 0, 1);
for (let i = 0; i < 400; i++) {
  const dt = new Date(d0 + i * 86400000);
  const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  const L = getDailyChallenge(key);
  const imps = L.perfect.map((p) => p.player?.imp ?? 75);
  const li = imps.reduce((a, b) => a + b, 0) / imps.length;
  const lb = rate(L.beasts).rating;
  const n = newDaily(key, cat);
  const a = n.perfect.reduce((s, p) => s + (p.pick?.ovr ?? 75), 0) / n.perfect.length;
  rows.push({ y: lb - (0.68 * li + 16.3), b: n.beasts.rating.rating, a, lb, li });
}
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
// Beasts rating, new scale → legacy scale: match mean and spread over the same dates.
const p = sd(rows.map((r) => r.lb)) / sd(rows.map((r) => r.b));
const q = mean(rows.map((r) => r.lb)) - p * mean(rows.map((r) => r.b));
// The day's pool: legacy perfect-team impact from the new perfect-team OVR (regression over the dates).
const ma = mean(rows.map((r) => r.a));
const mi = mean(rows.map((r) => r.li));
const u = rows.reduce((s, r) => s + (r.a - ma) * (r.li - mi), 0) / rows.reduce((s, r) => s + (r.a - ma) ** 2, 0);
const v = mi - u * ma;
const clamp = (x: number) => Math.max(0, Math.min(20, x));
const fitted = rows.map((r) => p * r.b + q - (0.68 * (u * r.a + v) + 16.3));
console.log(`diffAdj: beastRating_legacy ≈ ${p.toFixed(3)}·beastRating_OVR + ${q.toFixed(2)};  avgImp ≈ ${u.toFixed(3)}·avgOVR + ${v.toFixed(2)}`);
console.log(`  => diffAdj = clamp(${p.toFixed(3)}·B + ${(q - 0.68 * v - 16.3).toFixed(2)} − ${(0.68 * u).toFixed(3)}·A, 0, 20)`);
console.log(`legacy diffAdj mean ${mean(rows.map((r) => clamp(r.y))).toFixed(2)} (sd ${sd(rows.map((r) => clamp(r.y))).toFixed(2)}), new ${mean(fitted.map(clamp)).toFixed(2)} (sd ${sd(fitted.map(clamp)).toFixed(2)})`);
