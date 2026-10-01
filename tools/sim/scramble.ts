// Playtest 1/2: "scrambling is too easy (Montana leaked out for 14 and
// walked in); contain and pursuit should punish a slow QB, a mobile one
// earns his yards; scrambles on deep plays are too easy." The player's
// scramble (the key at TAKE_OFF, then the stick upfield, or angled to a
// side) on deep and quick plays against every coverage, with the practice
// QB's legs set slow (Speed 55, Agility 55, Acceleration 55) and mobile
// (90/90/90): yards, how often he gets 10+ and 20+, and how often he's
// sacked or dropped for no gain.
//   node tools/run-ts.mjs tools/sim/scramble.ts [seeds]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, input, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { effects } from '../../src/sim/effects.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const SEEDS = Number(process.argv[2] ?? 8);
const TAKE_OFF = 90;

export function scramble(legs: number, play: string, def: string, seed: number, dirY: number) {
  const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: playById(play), def: DEF_CALLS.find((d) => d.id === def)!, los: 30, toGo: 10, user: true });
  const qb = s.agents[s.qb]!;
  qb.p = { ...qb.p, attrs: { ...qb.p.attrs, speed: legs, agility: legs, acceleration: legs } };
  qb.fx = effects(qb.p);
  for (let k = 0; k < 60 * 12 && !s.result; k++) {
    const t = s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60);
    stepPlay(s, input({ snap: s.phase === 'presnap', scramble: t === TAKE_OFF, move: t >= TAKE_OFF ? { x: 1, y: dirY } : { x: 0, y: 0 }, sprint: t >= TAKE_OFF }));
  }
  return s.result!;
}

if (process.argv[1]?.endsWith('scramble.ts')) {
  for (const [label, plays] of [['deep', ['trips-four-verts', 'doubles-dagger', 'singleback-pa-post']], ['quick', ['doubles-slants', 'trips-stick', 'doubles-quick-outs']]] as const) {
    for (const legs of [55, 90]) {
      const ys: number[] = [];
      for (const play of plays) for (const d of DEF_CALLS) for (let seed = 1; seed <= SEEDS; seed++) for (const dirY of [0, 0.6, -0.6]) ys.push(scramble(legs, play, d.id, seed, dirY).yards);
      const pct = (f: (y: number) => boolean) => ((100 * ys.filter(f).length) / ys.length).toFixed(0) + '%';
      const med = [...ys].sort((a, b) => a - b)[Math.floor(ys.length / 2)]!;
      console.log(`${label.padEnd(5)} legs ${legs}: n ${ys.length}  mean ${(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(1)} yd  median ${med.toFixed(1)}  10+ ${pct((y) => y >= 10)}  20+ ${pct((y) => y >= 20)}  loss/none ${pct((y) => y <= 0)}`);
    }
  }
}
