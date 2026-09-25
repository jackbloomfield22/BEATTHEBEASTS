// The AI QB's view of a play, tick by tick: each receiver's openness (yd of
// separation at the catch point, after the closing defenders and the lanes)
// and the read he's on. For tuning the reads against the coverage.
//   node tools/run-ts.mjs tools/sim/reads.ts <play> <def> [seed] [every-ticks]
import { readFileSync } from 'node:fs';
import { createPlay, defById, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { openness, routeOf } from '../../src/sim/ai.ts';
import { sidesFor } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const [playId = 'trips-stick', defId = 'cover3', seed = '1000', every = '6'] = process.argv.slice(2);
const play = playById(playId);
const sd = sidesFor(r, play, defById(defId));
const s = createPlay({ seed: Number(seed), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, toGo: 10, user: false });
while (!s.result && s.tick < 2400) {
  stepPlay(s, NEUTRAL);
  if (s.snapT < 0 || s.phase === 'dead') continue;
  if (s.tick % Number(every) !== 0 && !s.events.some((e) => e.t === s.t && e.type === 'throw')) continue;
  const qb = s.agents[s.qb]!;
  const cells = s.icons.map((i, j) => {
    const a = s.agents[i]!;
    const why: string[] = [];
    const o = openness(s, qb, a, true, why);
    return `${j === s.read.idx % s.icons.length ? '>' : ' '}${routeOf(s, a)} ${o.sep.toFixed(1).padStart(5)}${process.argv.includes('--why') ? ' [' + why.slice(-2).join(' ') + ']' : ''}`;
  });
  const ev = s.events.filter((e) => e.t === s.t && e.type === 'throw').map((e) => `THROW to ${routeOf(s, s.agents[e.who![1]!]!)}`);
  console.log(`${(s.t - s.snapT).toFixed(2)} ${s.phase.padEnd(7)} ${cells.join(' |')} ${ev.join('')}`);
}
console.log(JSON.stringify(s.result));
