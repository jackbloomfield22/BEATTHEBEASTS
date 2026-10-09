// Passing round 6: a catch on the left side of the field with room to run after it (the carry-arm video): the X's out, his go, the slot's seam.
import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, runToWhistle, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { userThrow } from '../../src/game/clips.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const cases: [string, number, number, RouteName | undefined][] = [['doubles-curls', 1, 84, 'out'], ['doubles-curls', 1, 70, 'out'], ['trips-four-verts', 4, 63, undefined], ['doubles-quick-outs', 1, 40, undefined], ['doubles-slants', 1, 30, undefined]];
for (const [play, icon, at, hot] of cases)
  for (const def of ['cover3', 'cover2', 'cover4', 'cover1', 'tampa2'])
    for (let seed = 1; seed <= 20; seed++) {
      const s = runToWhistle(createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(play), def: defById(def), los: 30, toGo: 10, user: true }), userThrow({ icon, at, hot }));
      const p = s.result?.pass;
      if (!p?.complete) continue;
      const c = s.events.find((e) => e.type === 'catch')!;
      const yac = s.result!.yards - p.airYards;
      if (yac > 8 && c.at!.y > 4) console.log(`${play} ${hot ?? ''} icon ${icon} at ${at} ${def} seed ${seed}: caught at y ${c.at!.y.toFixed(1)}, ${p.airYards} air + ${yac.toFixed(1)} after`);
    }
