// The determinism check (TECH_PLAN §16, M5 exit): the same plays, seeds and
// inputs give the same state hash on every engine. Node (vitest) pins the
// hashes in tests/golden/sim-hashes.json; the browser test runs this same
// function in the page and must match them bit for bit.

import { createPlay, DEF_CALLS, defById, input, playById, PLAYS, runToWhistle, type DefSlot, type InputFrame, type OffSlot, type PlayState, type SimPlayer } from '@/sim';
import { hashPlay } from '@/sim/hash';

export interface HashCase {
  play: string;
  def: string;
  seed: number;
  /** A scripted user (snap, a throw to icon 2, then run) instead of the AI QB. */
  user: boolean;
}

export const HASH_CASES: HashCase[] = PLAYS.flatMap((p) => DEF_CALLS.flatMap((d) => [11, 4242].map((seed, k) => ({ play: p.id, def: d.id, seed, user: k === 1 }))));

/** A fixed user script: snap, drift right, throw to icon 2 at 1.5 s, then run and juke. */
function script(s: PlayState): InputFrame {
  const t = s.tick;
  if (s.phase === 'carrier') return input({ move: { x: 1, y: 0.2 }, jukeL: t % 40 === 0 });
  return input({ snap: t === 0, move: t > 40 && t < 70 ? { x: 0, y: -0.5 } : { x: 0, y: 0 }, throwHeld: t >= 90 && t < 96 ? 2 : 0, aim: { x: 0.3, y: 0.1 } });
}

export function simHashes(rosters: { offense: Record<OffSlot, SimPlayer>; defense: Record<DefSlot, SimPlayer> }, cases: HashCase[] = HASH_CASES): { key: string; hash: number; ticks: number; reason: string }[] {
  return cases.map((c) => {
    const s = createPlay({ seed: c.seed, offense: rosters.offense, defense: rosters.defense, play: playById(c.play), def: defById(c.def), los: 30, toGo: 10, user: c.user });
    runToWhistle(s, c.user ? script : () => input({}));
    return { key: `${c.play}/${c.def}/${c.seed}${c.user ? '/user' : ''}`, hash: hashPlay(s), ticks: s.tick, reason: s.result?.reason ?? 'none' };
  });
}
