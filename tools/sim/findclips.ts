// Find seeds for the feel videos (src/game/clips.ts): a completion with a
// run after the catch, a sack at about the new pocket time, and a broken
// tackle that keeps going. Prints candidates per play, coverage and icon.
//   node tools/run-ts.mjs tools/sim/findclips.ts
import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { holdIt, throwAndRun } from '../../src/game/clips.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const run = (play: string, def: string, seed: number, script: Parameters<typeof runToWhistle>[1]) => {
  const s = createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(play), def: defById(def), los: 30, toGo: 10, user: true });
  runToWhistle(s, script);
  const c = s.events.find((e) => e.type === 'catch');
  return { s, rac: c ? s.agents[s.carrier]!.pos.x - c.at!.x : 0, caught: !!c };
};
const rac: string[] = [];
const broken: string[] = [];
for (const play of ['trips-four-verts', 'trips-stick', 'doubles-smash', 'doubles-mesh']) {
  for (const def of ['cover1', 'cover2', 'cover3']) {
    for (const icon of [1, 2, 3, 4]) {
      for (const move of ['juke', 'stiffArm', 'spin'] as const) {
        for (let seed = 1; seed < 80; seed++) {
          const at = play === 'trips-four-verts' ? 100 : 84;
          const { s, rac: y, caught } = run(play, def, seed, throwAndRun(icon, at, move));
          if (!caught) continue;
          const tag = `${play} ${def} icon ${icon} ${move} seed ${seed}: ${s.result!.reason} ${s.result!.yards.toFixed(1)} yd (${y.toFixed(1)} after the catch) ${s.t.toFixed(1)} s`;
          if (y > 12 && y < 40 && s.result!.reason === 'tackle' && s.t < 9) rac.push(tag);
          if (s.events.some((e) => e.type === 'brokenTackle') && y > 6 && s.t < 10) broken.push(tag);
        }
      }
    }
  }
}
console.log('completion + run after the catch:\n  ' + rac.slice(0, 12).join('\n  '));
console.log('broken tackle:\n  ' + broken.slice(0, 12).join('\n  '));
const sacks: string[] = [];
for (let seed = 1; seed < 40; seed++) {
  const { s } = run('trips-four-verts', 'cover1', seed, holdIt);
  if (s.result!.sack) sacks.push(`seed ${seed}: ${s.result!.yards.toFixed(1)} yd at ${s.t.toFixed(2)} s`);
}
console.log('sack (trips-four-verts, cover1):\n  ' + sacks.slice(0, 8).join('\n  '));
