// Passing round 9: a quick out (or slant) caught by both Tyreek Hill and Wes Welker on the same snap, for the
// side-by-side broadcast video of the run after the catch (src/game/clips.ts PASSING9 p9-rac-a/-b).
//   node tools/run-ts.mjs tools/sim/p9_racfind.ts [play] [def] [at]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { userThrow, withSwap } from '../../src/game/clips.ts';
import { defenseFor, offenseFor, playById } from '../../src/sim/index.ts';
void input;

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const [PLAY = 'doubles-quick-outs', DEF = 'cover3', AT = '30'] = process.argv.slice(2);
const play = PLAYS.find((q) => q.id === PLAY)!;
const run = (name: string, seed: number) => {
  // As the clip runs it (src/game/clips.ts withSwap: his best stint, the number of the man he replaces).
  void simPlayer;
  void findStint;
  const t = withSwap({ team: rosters.team, beasts: rosters.beasts }, PLAY, { off: 'X', name, pos: 'WR' }, snap);
  const s = createPlay({ seed, offense: offenseFor(playById(PLAY), t.team), defense: defenseFor(defById(DEF), t.beasts), play, def: defById(DEF), los: 30, toGo: 10, user: true });
  const icon = s.icons.findIndex((i) => s.agents[i]!.slot === 'X') + 1;
  const sc = userThrow({ icon, at: Number(AT) });
  for (let k = 0; k < 1500 && !s.result; k++) stepPlay(s, sc(s));
  if (process.env.P9_EVENTS) console.log(name, seed, s.events.filter((e) => ['throw', 'catch', 'drop', 'deflection', 'bobble', 'brokenTackle', 'missedTackle', 'hit'].includes(e.type)).map((e) => `${e.type}@${e.t.toFixed(2)}`).join(' '), s.result?.reason, s.result?.yards);
  const p = s.result?.pass;
  const x = s.agents.find((a) => a.slot === 'X')!;
  // A clean catch only (no tip, no bobble): the pair is the same ball to two men.
  const clean = !s.events.some((e) => e.type === 'deflection' || e.type === 'bobble');
  const c = s.events.find((e) => e.type === 'catch');
  const hit = s.events.find((e) => c && e.t >= c.t && (e.type === 'hit' || e.type === 'missedTackle' || e.type === 'brokenTackle'));
  free = c && hit ? hit.t - c.t : 9;
  return p?.complete && p.target === x.i && clean ? s.result!.yards - p.airYards : NaN;
};
/** Seconds from the catch to the first hand on him (the last run's). */
let free = 0;
for (let seed = Number(process.env.P9_SEED ?? 1); seed <= Number(process.env.P9_SEED ?? 60); seed++) {
  const h = run('Tyreek Hill', seed);
  const hf = free;
  const w = run('Wes Welker', seed);
  const wf = free;
  if (Number.isFinite(h) && Number.isFinite(w)) console.log(`seed ${seed}: Hill ${h.toFixed(1)} Welker ${w.toFixed(1)} diff ${(h - w).toFixed(1)} free ${hf.toFixed(2)} ${wf.toFixed(2)}`);
}
