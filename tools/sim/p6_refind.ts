// Passing round 6: re-find the feel clips the sim change moved (tests/sim.test.ts): the completion with a run after the catch, and the scramble drill.
import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { concept, throwAndRun } from '../../src/game/clips.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const mk = (play: string, def: string, seed: number) => createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(play), def: defById(def), los: 30, toGo: 10, user: true });
const rac: string[] = [];
for (const def of ['cover3', 'cover2', 'cover1'])
  for (const icon of [1, 2])
    for (let seed = 1; seed < 80; seed++) {
      const s = runToWhistle(mk('trips-four-verts', def, seed), throwAndRun(icon, 100, 'juke'));
      const c = s.events.find((e) => e.type === 'catch');
      if (c && s.carrier >= 0 && s.agents[s.carrier]!.pos.x - c.at!.x > 14) rac.push(`${def} icon ${icon} seed ${seed} (${(s.agents[s.carrier]!.pos.x - c.at!.x).toFixed(1)} after)`);
    }
console.log('rac (four verts, cover3, icon 1 at 100, juke):', rac.join(', '));
const scr: string[] = [];
for (let seed = 1; seed < 80; seed++) {
  const s = runToWhistle(mk('trips-y-cross', 'cover4', seed), concept({ icon: 1, at: 150, scramble: { at: 110, dir: { x: 0.25, y: 1 } } }));
  const p = s.result?.pass;
  if (p?.complete && (p.sep ?? 0) > 1 && s.result!.yards > 5 && s.scrambleT > 0) scr.push(`${seed} (${s.result!.yards.toFixed(1)} yd, sep ${p.sep})`);
}
console.log('scramble drill (y-cross, cover4):', scr.join(', '));
