// Find the plays for the side-by-side identity videos (Playtest 2): for each
// of the five recorded pairs, the same play, seed and coverage run with each
// man, and kept where the contrast shows on that one snap (what the harness
// says on average: tools/sim/identity.ts). Prints the best few per pair.
//   node tools/run-ts.mjs tools/sim/findidentity.ts [seeds] [--only=speed]
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, input, NEUTRAL, offenseFor, playById, PLAYS, practiceRosters, runToWhistle, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { concept, withSwap, type Swap } from '../../src/game/clips.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const SEEDS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 30);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

/** A play as callClip sets it up in the browser (the clip defaults). */
export function playClip(playId: string, def: string, seed: number, user: boolean, swap: Swap, script: (s: PlayState) => ReturnType<typeof input>): PlayState {
  const teams = withSwap({ team: base.team, beasts: base.beasts }, playId, swap, snap);
  const play = playById(playId);
  const call = defById(def);
  const s = createPlay({ seed, offense: offenseFor(play, teams.team), defense: defenseFor(call, teams.beasts), play, def: call, los: 30, ballY: 0, toGo: 10, user, down: 1 });
  return runToWhistle(s, script);
}

const iconOf = (playId: string, slot: string) => {
  const s = createPlay({ seed: 1, offense: offenseFor(playById(playId), base.team), defense: base.defense, play: playById(playId), def: defById('cover1'), los: 30, toGo: 10, user: true });
  return s.icons.findIndex((i) => s.agents[i]!.slot === slot) + 1;
};
const holdBall = (s: PlayState) => input({ snap: s.phase === 'presnap' });
const count = (s: PlayState, type: string, who: number, at = 0) => s.events.filter((e) => e.type === type && e.who?.[at] === who).length;
const slotI = (s: PlayState, slot: string) => s.agents.find((a) => a.slot === slot)!.i;

interface Spec {
  id: string;
  a: Swap;
  b: Swap;
  plays: string[];
  defs: string[];
  user: boolean;
  script(playId: string): (s: PlayState) => ReturnType<typeof input>;
  /** How clearly this snap shows the contrast (higher is better; null: it doesn't). */
  score(a: PlayState, b: PlayState): number | null;
  note(a: PlayState, b: PlayState): string;
}
const yards = (s: PlayState) => s.result?.yards ?? 0;
const pass = (s: PlayState) => s.result?.pass;

export const SPECS: Spec[] = [
  {
    id: 'speed',
    a: { off: 'X', name: 'Tyreek Hill', pos: 'WR' },
    b: { off: 'X', name: 'Wes Welker', pos: 'WR' },
    plays: ['trips-four-verts', 'doubles-dagger', 'singleback-pa-post'],
    defs: ['cover1', 'cover3', 'cover2man', 'cover2'],
    user: true,
    script: (p) => concept({ icon: iconOf(p, 'X'), at: p === 'trips-four-verts' ? 100 : 90, hold: 16 }),
    score: (a, b) => (pass(a)?.complete && pass(a)!.target === slotI(a, 'X') && yards(a) >= yards(b) + 10 ? yards(a) - yards(b) + 5 * ((pass(a)!.sep ?? 0) - (pass(b)?.sep ?? 0)) : null),
    note: (a, b) => `Hill ${yards(a)} yd sep ${pass(a)?.sep}, Welker ${yards(b)} yd sep ${pass(b)?.sep} ${pass(b)?.complete ? 'caught' : 'incomplete'}`,
  },
  {
    id: 'elusive',
    a: { off: 'RB', name: 'Barry Sanders', pos: 'RB' },
    b: { off: 'RB', name: 'Jerome Bettis', pos: 'RB' },
    plays: PLAYS.filter((p) => p.run && p.run.scheme !== 'sneak' && p.run.scheme !== 'toss').map((p) => p.id),
    defs: ['cover1', 'cover3', 'cover2'],
    user: false,
    script: () => () => NEUTRAL,
    score: (a, b) => {
      const ma = count(a, 'missedTackle', slotI(a, 'RB'), 1);
      const bb = count(b, 'brokenTackle', slotI(b, 'RB'));
      return ma >= 1 && bb >= 1 && yards(a) >= 6 ? yards(a) - yards(b) + 3 * ma + 3 * bb : null;
    },
    note: (a, b) => `Barry ${yards(a)} yd, ${count(a, 'missedTackle', slotI(a, 'RB'), 1)} missed; Bettis ${yards(b)} yd, ${count(b, 'brokenTackle', slotI(b, 'RB'))} broken`,
  },
  {
    id: 'accuracy',
    a: { off: 'QB', name: 'Joe Montana', pos: 'QB' },
    b: { off: 'QB', name: 'Joe Namath', pos: 'QB' },
    plays: ['doubles-slants', 'doubles-quick-outs', 'doubles-curls'],
    defs: ['cover3', 'cover4', 'cover2'],
    user: true,
    script: (p) => concept({ icon: 1, at: p === 'doubles-curls' ? 60 : 30 }),
    score: (a, b) => {
      const oa = Number(a.events.find((e) => e.type === 'throw')?.data?.off ?? 9);
      const ob = Number(b.events.find((e) => e.type === 'throw')?.data?.off ?? 0);
      return pass(a)?.complete && !pass(b)?.complete && oa < 0.6 && ob > 1.5 ? ob - oa + yards(a) / 5 : null;
    },
    note: (a, b) => `Montana off ${a.events.find((e) => e.type === 'throw')?.data?.off} ${yards(a)} yd, Namath off ${b.events.find((e) => e.type === 'throw')?.data?.off} ${pass(b)?.complete ? 'caught' : 'incomplete'}`,
  },
  {
    id: 'rush',
    a: { def: 'LE', name: 'Reggie White', pos: 'DE' },
    b: { def: 'LE', name: 'Aaron Smith', pos: 'DE' },
    plays: ['doubles-curls', 'trips-four-verts', 'doubles-dagger'],
    defs: ['cover1', 'cover3', 'cover2'],
    user: true,
    script: () => holdBall,
    score: (a, b) => {
      const w = slotI(a, 'LE');
      const sa = a.events.find((e) => e.type === 'sack');
      const shedA = a.events.find((e) => e.type === 'shed' && e.who?.[0] === w);
      const shedB = b.events.find((e) => e.type === 'shed' && e.who?.[0] === slotI(b, 'LE'));
      return sa?.who?.[0] === w && shedA && (!shedB || shedB.t > shedA.t + 1) ? (shedB ? shedB.t : 6) - shedA.t : null;
    },
    note: (a, b) => `White shed at ${a.events.find((e) => e.type === 'shed' && e.who?.[0] === slotI(a, 'LE'))?.t.toFixed(2)} s, sack ${a.events.find((e) => e.type === 'sack')?.t.toFixed(2)}; Smith shed ${b.events.find((e) => e.type === 'shed' && e.who?.[0] === slotI(b, 'LE'))?.t.toFixed(2) ?? 'never'}, sack by ${b.events.find((e) => e.type === 'sack')?.who?.[0] === slotI(b, 'LE') ? 'him' : 'someone else'}`,
  },
  {
    id: 'coverage',
    a: { def: 'LCB', name: 'Deion Sanders', pos: 'CB' },
    b: { def: 'LCB', name: 'Kam Chancellor', pos: 'S' },
    plays: ['doubles-quick-outs', 'doubles-curls', 'trips-four-verts', 'doubles-slants'],
    defs: ['cover1', 'cover2man'],
    user: true,
    script: (p) => concept({ icon: iconOf(p, 'X'), at: p === 'trips-four-verts' ? 90 : p === 'doubles-curls' ? 60 : 32 }),
    score: (a, b) => (!pass(a)?.complete && pass(b)?.complete && pass(a)?.target === slotI(a, 'X') && (pass(b)?.sep ?? 0) > (pass(a)?.sep ?? 0) + 1 ? yards(b) + 5 * ((pass(b)!.sep ?? 0) - (pass(a)!.sep ?? 0)) : null),
    note: (a, b) => `Deion: ${pass(a)?.intercepted ? 'picked' : 'incomplete'} sep ${pass(a)?.sep}; Kam: caught ${yards(b)} yd sep ${pass(b)?.sep}`,
  },
];

if (process.argv[1]?.endsWith('findidentity.ts')) {
  for (const spec of SPECS.filter((x) => !ONLY || ONLY.split(',').includes(x.id))) {
    const hits: { score: number; play: string; def: string; seed: number; note: string }[] = [];
    for (const play of spec.plays) for (const def of spec.defs) for (let seed = 1; seed <= SEEDS; seed++) {
      const a = playClip(play, def, seed, spec.user, spec.a, spec.script(play));
      const b = playClip(play, def, seed, spec.user, spec.b, spec.script(play));
      const sc = spec.score(a, b);
      if (sc !== null) hits.push({ score: sc, play, def, seed, note: spec.note(a, b) });
    }
    hits.sort((x, y) => y.score - x.score);
    console.log(`\n${spec.id}: ${hits.length} hits`);
    for (const h of hits.slice(0, 4)) console.log(`  ${h.play} ${h.def} seed ${h.seed}: ${h.note} (score ${h.score.toFixed(1)})`);
  }
}
