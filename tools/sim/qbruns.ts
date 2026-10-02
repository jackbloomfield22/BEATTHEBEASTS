// A Designed Runner's plays (the trait catalog: "Unlocks QB draws and
// zone-read keepers in the playbook; ball security on QB runs uses his full
// rating"; Run-Pass Nightmare: "read-option keepers freeze the edge defender
// 0.1 s longer"): the QB draw and the zone read, AI-run against every call,
// for a QB with the trait, the same QB without it, and a pocket passer.
//   node tools/run-ts.mjs tools/sim/qbruns.ts [reps]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, playById, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import type { SimPlayer } from '../../src/sim/types.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const REPS = Number(process.argv[2] ?? 20);

const qb = (name: string): SimPlayer => simPlayer(findStint(snap, name, 'QB')!, 7);
const vick = qb('Michael Vick');
const strip = (p: SimPlayer, ids: string[], add: string[] = []): SimPlayer => ({ ...p, traits: [...(p.traits ?? []).filter((t) => !ids.includes(t)), ...add] });
const QBS: [string, SimPlayer][] = [
  ['Vick (Run-Pass Nightmare)', vick],
  ['Vick, the parts only (no freeze)', strip(vick, ['run-pass-nightmare'], ['dual-threat', 'designed-runner'])],
  ['Vick without Designed Runner', strip(vick, ['run-pass-nightmare'], ['dual-threat'])],
  ['Joe Montana', base.offense.QB],
];

for (const id of ['doubles-qb-draw', 'doubles-zone-read']) {
  const play = playById(id);
  console.log(`\n${play.name}`);
  for (const [label, q] of QBS) {
    let n = 0;
    let yds = 0;
    let qbCar = 0;
    let qbYds = 0;
    let fum = 0;
    let stuffed = 0;
    let ten = 0;
    for (const def of DEF_CALLS) {
      for (let k = 0; k < REPS; k++) {
        for (const flip of [false, true]) {
          // As the harness plays them: the Beasts' package for the personnel, the ball on each hash and the middle.
          const sd = sidesFor({ ...base, team: { ...base.team, QB: q } }, play, def);
          const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: [3.08, 0, -3.08][k % 3], toGo: 10, user: false, flip });
          runToWhistle(s, () => NEUTRAL);
          const r = s.result!;
          const y = r.offenseBall ? r.yards : 0;
          n++;
          yds += y;
          if (y <= 0) stuffed++;
          if (y >= 10) ten++;
          if (s.carrier === s.qb || s.events.some((e) => e.type === 'move' && e.data?.run)) {
            qbCar++;
            qbYds += y;
          }
          if (s.events.some((e) => e.type === 'fumble')) fum++;
        }
      }
    }
    console.log(`  ${label.padEnd(36)} ypc ${(yds / n).toFixed(2)}  stuffed ${((100 * stuffed) / n).toFixed(0)}%  10+ ${((100 * ten) / n).toFixed(0)}%  QB keeps ${((100 * qbCar) / n).toFixed(0)}% for ${(qbYds / Math.max(1, qbCar)).toFixed(2)} yd, gives for ${((yds - qbYds) / Math.max(1, n - qbCar)).toFixed(2)}  fumbles ${fum}/${n}`);
  }
}
