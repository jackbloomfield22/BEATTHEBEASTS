// Fit the legacy-sim adapter (src/engine/legacy/adapter.ts).
//
//   node tools/run-ts.mjs tools/ratings/fit-adapter.ts [--check]
//
// For every rated player, legacy's own ability fields (rateOffense /
// rateDefenders on the corrected legacy entry) are the targets; each field is
// fitted by least squares (small ridge) on the new attributes listed in
// ADAPTER_INPUTS. Writes data/ratings/adapter.v1.json and prints a seeded sim
// comparison (legacy ratings vs adapted ratings, same rosters and Beasts).
// "Fit, not yet tuned": calibration to the PPG targets waits for sign-off.

import { readFileSync, writeFileSync } from 'node:fs';
import { DEFENSE, OL_UNITS, PLAYERS } from '../../data/legacy/index.ts';
import { ADAPTER_INPUTS, adaptDefenders, adaptOffense, unitAttrs, type AdapterFile, type FieldFit } from '../../src/engine/legacy/adapter.ts';
import { assembleBeastsSeeded } from '../../src/engine/legacy/beasts.ts';
import { rateDefenders, rateOffense, simulateBeatdown } from '../../src/engine/legacy/sim.ts';
import type { Roster, RosterEntry } from '../../src/engine/legacy/types.ts';
import { rateAll } from '../../src/engine/ratings/engine.ts';
import { buildInputs } from '../../src/engine/ratings/inputs.ts';
import { makeRng } from '../../src/engine/rng/index.ts';
import { loadSources, ROOT } from './sources.ts';

const S = loadSources();
const run = rateAll(buildInputs(S).inputs);
const attrsById = new Map<string, Record<string, number>>();
for (const e of run.entries) {
  const a: Record<string, number> = {};
  for (const [k, v] of Object.entries(e.attrs)) a[k] = v.value;
  attrsById.set(e.id, a);
}
const byId = (id: string) => attrsById.get(id);

// ---------------------------------------------------------------- targets

type Row = { x: Record<string, number>; y: Record<string, number> };
const rows: Record<keyof AdapterFile & string, Row[]> = { QB: [], RB: [], WR: [], TE: [], OL: [], DEF: [], version: [] } as never;
const qbFill = S.players.find((p) => p.p === 'QB' && !S.excluded.has(p.id))!;
const olFill = S.olUnits[0]!;
const base = { QB: qbFill, RB: null, RB2: null, WR1: null, WR2: null, WR3: null, TE: null, TE2: null, OL: olFill } as unknown as Record<string, RosterEntry | null>;

for (const p of S.players) {
  const x = attrsById.get(p.id);
  if (!x) continue;
  const slot = p.p === 'QB' ? 'QB' : p.p === 'RB' ? 'RB' : p.p === 'WR' ? 'WR1' : 'TE';
  const off = rateOffense({ ...base, [slot]: p } as unknown as Roster);
  const r = slot === 'QB' ? off.QB : slot === 'RB' ? off.RB1 : slot === 'WR1' ? off.WR1 : off.TE;
  if (!r) continue;
  (rows[p.p as 'QB' | 'RB' | 'WR' | 'TE'] as Row[]).push({ x, y: r as unknown as Record<string, number> });
}
for (const u of S.olUnits) {
  const x = unitAttrs(u.id, byId);
  if (!x) continue;
  const off = rateOffense({ ...base, OL: u } as unknown as Roster);
  rows.OL.push({ x, y: off.OL as unknown as Record<string, number> });
}
for (const d of S.defense) {
  const x = attrsById.get(d.id);
  if (!x) continue;
  const [r] = rateDefenders([{ ...d, slot: 'X', role: d.p }]);
  rows.DEF.push({ x, y: r as unknown as Record<string, number> });
}

// ---------------------------------------------------------------- least squares

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / r[i]!);
}

const RANGES: Record<string, [number, number]> = {
  arm: [35, 97], acc: [35, 97], care: [35, 97], explos: [35, 97], legs: [30, 97],
  power: [35, 97], vol: [35, 97], recv: [25, 97], score: [35, 97],
  sep: [35, 97], big: [35, 97], hands: [30, 97], block: [25, 97],
  pass: [38, 96], run: [38, 96],
  rush: [45, 92], cover: [45, 90], runD: [45, 94], tackle: [40, 90],
};

function fit(rs: Row[], field: string, inputs: readonly string[]): FieldFit {
  const keys = [...inputs];
  const X = rs.map((r) => [1, ...keys.map((k) => r.x[k] ?? 0)]);
  const y = rs.map((r) => r.y[field]!);
  const p = keys.length + 1;
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[i]! * r[j]!, 0) + (i === j && i > 0 ? 1e-3 * rs.length : 0)));
  const Xty = Array.from({ length: p }, (_, i) => X.reduce((a, r, n) => a + r[i]! * y[n]!, 0));
  const beta = solve(XtX, Xty);
  const pred = X.map((r) => r.reduce((a, v, i) => a + v * beta[i]!, 0));
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  const ssr = y.reduce((a, v, i) => a + (v - pred[i]!) ** 2, 0);
  const sst = y.reduce((a, v) => a + (v - my) ** 2, 0);
  const [lo, hi] = RANGES[field]!;
  return { b0: +beta[0]!.toFixed(4), w: Object.fromEntries(keys.map((k, i) => [k, +beta[i + 1]!.toFixed(5)])), lo, hi, r2: +(1 - ssr / sst).toFixed(3) };
}

const out = { version: 1 } as AdapterFile;
for (const [grp, fieldsMap] of Object.entries(ADAPTER_INPUTS) as [keyof typeof ADAPTER_INPUTS, Record<string, readonly string[]>][]) {
  const fits: Record<string, FieldFit> = {};
  for (const [field, inputs] of Object.entries(fieldsMap)) fits[field] = fit(rows[grp], field, inputs);
  (out as unknown as Record<string, unknown>)[grp] = fits;
}

// ---------------------------------------------------------------- sim check

const key = (e: { n: string; p: string; t: string; d: string }) => `${e.n}|${e.p}|${e.t}|${e.d}`;
const byKey = new Map<string, Record<string, number>>();
for (const e of [...PLAYERS, ...DEFENSE]) {
  const a = attrsById.get(e.id);
  if (a) byKey.set(key(e), a);
}
for (const u of OL_UNITS) {
  const a = unitAttrs(u.id, byId);
  if (a) byKey.set(key(u), a);
}
const attrsOf = (e: { n: string; p: string; t: string; d: string }) => byKey.get(key(e));

const rng = makeRng(20260923);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]!;
const pool = (pos: string) => PLAYERS.filter((p) => p.p === pos && byKey.has(key(p)));
const P = { QB: pool('QB'), RB: pool('RB'), WR: pool('WR'), TE: pool('TE') };
const units = OL_UNITS.filter((u) => byKey.has(key(u)));
let legacyPts = 0;
let newPts = 0;
let n = 0;
const games = process.argv.includes('--check') ? 0 : 400;
for (let g = 0; g < games; g++) {
  const roster = { QB: pick(P.QB), RB: pick(P.RB), RB2: pick(P.RB), WR1: pick(P.WR), WR2: pick(P.WR), WR3: pick(P.WR), TE: pick(P.TE), TE2: pick(P.TE), OL: pick(units) } as unknown as Roster;
  const beasts = assembleBeastsSeeded(makeRng(1000 + g));
  if (beasts.some((b) => !attrsOf(b))) continue;
  const a = simulateBeatdown(roster, beasts);
  const b = simulateBeatdown(roster, beasts, false, 0, { off: adaptOffense(roster, attrsOf, out), defenders: adaptDefenders(beasts, attrsOf, out) });
  legacyPts += a.yourScore;
  newPts += b.yourScore;
  n++;
}

const text = JSON.stringify(out, null, 1) + '\n';
const dest = ROOT + 'data/ratings/adapter.v1.json';
if (process.argv.includes('--check')) {
  if (readFileSync(dest, 'utf8') !== text) {
    console.error('data/ratings/adapter.v1.json is stale: run node tools/run-ts.mjs tools/ratings/fit-adapter.ts');
    process.exit(1);
  }
} else {
  writeFileSync(dest, text);
  const r2 = Object.entries(out)
    .filter(([k]) => k !== 'version')
    .flatMap(([g, f]) => Object.entries(f as Record<string, FieldFit>).map(([k, v]) => `${g}.${k} ${v.r2}`));
  console.log(`wrote data/ratings/adapter.v1.json · R² ${r2.join(', ')}`);
  const summary = `Sim check over ${n} random rosters (any player in the pool, backups included) against seeded Beasts: legacy ratings ${(legacyPts / n).toFixed(1)} points per game, adapted ratings ${(newPts / n).toFixed(1)}.`;
  console.log(summary);
  writeFileSync(ROOT + 'data/ratings/adapter.v1.check.txt', summary + '\n');
}
