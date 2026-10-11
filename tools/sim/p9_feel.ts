// Passing round 6: the M5.5 feel clips (tests/sim.test.ts) on this sim, and a search for a broken-tackle seed when it's moved.
import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { CLIPS, throwAndRun } from '../../src/game/clips.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const mk = (seed: number, play: string, def: string) => createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(play), def: defById(def), los: 30, toGo: 10, user: true });
for (const c of CLIPS) {
  const s = runToWhistle(mk(c.seed, c.play, c.def), c.script);
  console.log(c.id, s.result?.reason, s.result?.yards, 'sack', s.result?.sack, 'broken', s.events.some((e) => e.type === 'brokenTackle'), 'td', s.result?.touchdown);
}
const found: string[] = [];
for (const def of ['cover1', 'cover2', 'cover3'])
  for (const icon of [2, 1, 3])
    for (let seed = 1; seed < 60 && found.length < 8; seed++) {
      const s = runToWhistle(mk(seed, 'trips-stick', def), throwAndRun(icon, 84, 'stiffArm'));
      if (s.events.some((e) => e.type === 'brokenTackle') && s.result?.pass?.complete) found.push(`${def} icon ${icon} seed ${seed} (${s.result.yards} yd)`);
    }
console.log('broken tackle (stick, stiff arm):', found.join(', '));
const tds: string[] = [];
for (const def of ['cover2', 'cover3', 'cover1'])
  for (const icon of [1, 2])
    for (let seed = 1; seed < 120 && tds.length < 8; seed++) {
      const s = runToWhistle(mk(seed, 'trips-four-verts', def), throwAndRun(icon, 100, 'juke'));
      if (s.result?.touchdown) tds.push(`${def} icon ${icon} seed ${seed}`);
    }
console.log('touchdowns (four verts, juke):', tds.join(', '));
