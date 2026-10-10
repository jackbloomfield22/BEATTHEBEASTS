// Passing round 6: each round-6 clip run in Node as the Practice Field runs it: the throw, the catch (or what happened) and its look.
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING5, PASSING6, withSwap } from '../../src/game/clips.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
for (const c of [...PASSING6, ...PASSING5.filter((x) => ['p5-contested', 'p5-scoop'].includes(x.id))]) {
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  const s = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  for (let k = 0; k < 1500 && !s.result; k++) stepPlay(s, c.script(s));
  const ev = s.events.filter((e) => ['throw', 'catch', 'drop', 'deflection', 'interception', 'bobble'].includes(e.type)).map((e) => `${e.type}@${e.t.toFixed(2)}${e.data?.look ? ':' + e.data.look : ''}`);
  console.log(`${c.id}: ${ev.join(' ')} -> ${s.result?.reason} ${s.result?.yards}`);
}
