// The one action button (the owner's call after M6.6): Space / A in the air
// makes the catch call and with the ball makes the move, the game choosing
// from the picture in front of him.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, input, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '@/sim';
import { autoMove } from '@/sim/moves';

const rosters = practiceRosters(JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike);

describe('the one action button', () => {
  it('in the air, a press makes a catch call', () => {
    let called = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 35, toGo: 10, user: true });
      stepPlay(s, input({ snap: true }));
      for (let t = 0; t < 600 && !s.result; t++) {
        const f = t >= 30 && t < 32 ? input({ throwHeld: 1 }) : s.phase === 'air' ? input({ auto: true }) : NEUTRAL;
        stepPlay(s, f);
        if (s.phase === 'air' && s.catchType) {
          called++;
          expect(['aggressive', 'possession', 'rac']).toContain(s.catchType);
          break;
        }
      }
    }
    expect(called).toBeGreaterThan(10);
  });
  it('with the ball, a press makes a move when a tackler is close (and waits when nobody is)', () => {
    let moved = 0;
    let waited = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 35, toGo: 10, user: true });
      stepPlay(s, input({ snap: true }));
      for (let t = 0; t < 900 && !s.result; t++) {
        const f = t >= 30 && t < 32 ? input({ throwHeld: 1 }) : s.phase === 'carrier' ? input({ auto: true, move: { x: 1, y: 0 } }) : NEUTRAL;
        const c = s.phase === 'carrier' ? s.agents[s.carrier]! : null;
        const pick = c ? autoMove(s, c) : null;
        const n = s.events.length;
        stepPlay(s, f);
        if (c && pick === null) waited++;
        if (s.events.slice(n).some((e) => e.type === 'move' && e.who?.[0] === c?.i && e.data?.move !== 'burst')) moved++;
      }
    }
    expect(moved).toBeGreaterThan(3);
    expect(waited).toBeGreaterThan(0);
  });
});
