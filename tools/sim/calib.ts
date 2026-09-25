// Calibrate the QB's openness estimate against what actually happens: throw at
// random times to random receivers (scripted input) and bin the outcomes.
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, input, PASS_PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { sidesFor } from '../../src/sim/outcomes.ts';
import { openness } from '../../src/sim/ai.ts';
import { makeRng } from '../../src/engine/rng/index.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const rng = makeRng(7);
const rows: { sep: number; res: string; air: number; real: number }[] = [];
for (let k = 0; k < Number(process.argv[2] ?? 1500); k++) {
  const PLAYS = PASS_PLAYS.filter((p) => !p.situ);
  const play = PLAYS[k % PLAYS.length]!;
  const sd = sidesFor(r, play, DEF_CALLS[Math.floor(k / PLAYS.length) % DEF_CALLS.length]!);
  const s = createPlay({ seed: 5000 + k * 104729, offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, toGo: 10, user: true });
  const icon = 1 + Math.floor(rng() * s.icons.length);
  const at = 0.9 + rng() * 2.4;
  const touch = rng() < 0.5;
  let released = false; let sep = 0; let air = 0;
  while (!s.result && s.tick < 2400) {
    const t = s.tick / 60;
    const holding = !released && t >= at && t < at + (touch ? 0.45 : 0.08);
    if (!released && t >= at + (touch ? 0.45 : 0.08)) {
      released = true;
      const o = openness(s, s.agents[s.qb]!, s.agents[s.icons[icon - 1]!]!);
      sep = o.sep; air = o.at.x - 35;
    }
    stepPlay(s, input({ snap: s.tick === 0, throwHeld: holding ? icon : 0 }));
  }
  if (!released || !s.pass) continue;
  rows.push({ sep, air, real: s.pass.sep ?? NaN, res: s.sack ? 'sack' : s.pass.intercepted ? 'int' : s.pass.complete ? 'comp' : 'inc' });
}
const bins = [-99, -4, -2, -1, 0, 1, 2, 3, 5, 99];
for (let b = 0; b < bins.length - 1; b++) {
  const inb = rows.filter((x) => x.sep >= bins[b]! && x.sep < bins[b + 1]!);
  if (!inb.length) continue;
  const c = (t: string) => inb.filter((x) => x.res === t).length;
  console.log(`sep [${bins[b]},${bins[b + 1]}) n=${String(inb.length).padStart(4)} comp ${(100 * c('comp') / inb.length).toFixed(0).padStart(3)}% int ${(100 * c('int') / inb.length).toFixed(0).padStart(3)}% sack ${(100 * c('sack') / inb.length).toFixed(0)}% air ${(inb.reduce((a, x) => a + x.air, 0) / inb.length).toFixed(1)} real sep ${(() => { const r = inb.filter((x) => !Number.isNaN(x.real)).map((x) => x.real).sort((a, b) => a - b); return r.length ? r[r.length >> 1]!.toFixed(1) : '-'; })()}`);
}
console.log('overall', rows.length, 'comp', (100 * rows.filter((x) => x.res === 'comp').length / rows.length).toFixed(0), 'int', (100 * rows.filter((x) => x.res === 'int').length / rows.length).toFixed(0));
