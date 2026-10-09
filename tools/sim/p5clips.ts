// Passing round 5: each catch clip (src/game/clips.ts PASSING5) run in Node
// as the Practice Field runs it: the catch's drawn style, who caught it and
// the result, so the recordings show what they're named for.
//   node tools/run-ts.mjs tools/sim/p5clips.ts
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING5, withSwap } from '../../src/game/clips.ts';
import { arrivalOf, catchStyle } from '../../src/sim/catchstyle.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
for (const c of PASSING5) {
  const r = c.swap ? withSwap({ team: base.team, beasts: base.beasts }, c.play, c.swap, snap) : null;
  const s = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : base.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : base.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  let line = '';
  for (let k = 0; k < 60 * 20 && !s.result; k++) {
    if (!line && s.ball.mode === 'air' && s.ball.target >= 0 && s.agents[s.ball.target]!.side === 'off' && s.ball.arrive - s.t <= 0.3) {
      const a = s.agents[s.ball.target]!;
      const ar = arrivalOf(s, a);
      line = `${catchStyle(s, a).padEnd(12)} ${a.slot.padEnd(4)} ${a.p.name.padEnd(18)} z ${ar.z.toFixed(2)} across ${ar.across.toFixed(2)} arrive ${(s.ball.arrive - s.snapT).toFixed(2)} s`;
    }
    stepPlay(s, c.script(s));
  }
  const res = s.result!;
  console.log(`${c.id.padEnd(14)} ${line} -> ${res.pass?.complete ? 'complete' : res.pass?.intercepted ? 'INT' : res.reason} ${res.yards.toFixed(1)} yd, whistle ${(s.t - s.snapT).toFixed(2)} s`);
}
