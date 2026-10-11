// Passing round 9: a man's movement effects (vmax, tau, cut) for a few names, and his speed after t s from a standing start / from a slant's pace.
//   node tools/run-ts.mjs tools/sim/p9_fx.ts "Tyreek Hill,WR" "Wes Welker,WR" ...
import { readFileSync } from 'node:fs';
import { type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { effects } from '../../src/sim/effects.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
for (const who of process.argv.slice(2)) {
  const [name, pos] = who.split(',');
  const p = simPlayer(findStint(snap, name!, pos)!, 99);
  const fx = effects(p);
  // From a slant's 7 yd/s after a cut keeping 63%: v(t) = vmax − (vmax − v0)·e^(−t/tau)
  const v0 = 7 * 0.63;
  const at = (t: number) => fx.vmax - (fx.vmax - v0) * Math.exp(-t / fx.tau);
  const dist = (t: number) => fx.vmax * t - (fx.vmax - v0) * fx.tau * (1 - Math.exp(-t / fx.tau));
  console.log(`${name}: speed ${p.attrs.speed} acc ${p.attrs.acceleration} agi ${p.attrs.agility} rac ${p.attrs.rac} | vmax ${fx.vmax.toFixed(2)} yd/s tau ${fx.tau.toFixed(3)} s cut ${fx.cutAccel.toFixed(1)} | out of a cut: v@0.5 ${at(0.5).toFixed(2)} v@1 ${at(1).toFixed(2)} | yd in 1 s ${dist(1).toFixed(2)}, 2 s ${dist(2).toFixed(2)}, 3 s ${dist(3).toFixed(2)}`);
}
