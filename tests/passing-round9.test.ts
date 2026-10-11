import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, input, PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '@/sim';
import { findStint, simPlayer } from '@/sim/roster';
import { racGather } from '@/sim/play';
import type { Agent } from '@/sim/types';
import { reachDepth } from '@/render/game/choreo';

// Passing round 9 (docs/passing/PASSING9.md): the catch in stride by Run
// After Catch, and the forward reach blended by how far out the ball is.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const man = (name: string, pos: string) => ({ p: simPlayer(findStint(snap, name, pos)!, 99) }) as unknown as Agent;

describe('the catch in stride (Run After Catch)', () => {
  it('Tyreek Hill takes it in stride; Wes Welker gathers it; a man with no rating is as before', () => {
    expect(racGather(man('Tyreek Hill', 'WR'))).toBe(0);
    const welker = racGather(man('Wes Welker', 'WR'));
    expect(welker).toBeGreaterThan(0.5);
    expect(welker).toBeLessThan(0.8);
    expect(racGather({ p: { attrs: {} } } as unknown as Agent)).toBe(0);
  });

  it('a gathering receiver comes out of a catch-and-run slower than he went in; one who catches in stride does not', () => {
    const play = PLAYS.find((q) => q.id === 'doubles-quick-outs')!;
    const def = defById('cover3');
    const dip = (name: string): number[] => {
      const out: number[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const s = createPlay({ seed, offense: { ...rosters.offense, X: simPlayer(findStint(snap, name, 'WR')!, 99) }, defense: rosters.defense, play, def, los: 35, toGo: 10, user: true });
        const icon = s.icons.findIndex((i) => s.agents[i]!.slot === 'X') + 1;
        const x = s.agents.find((a) => a.slot === 'X')!;
        for (let k = 0; k < 900 && !s.result; k++) {
          const t = Math.round((s.t - s.snapT) * 60);
          const v = Math.hypot(x.vel.x, x.vel.y);
          const air = s.phase === 'air';
          stepPlay(s, air ? input({ catchType: 'rac' }) : input({ snap: s.phase === 'presnap', throwHeld: s.snapT >= 0 && t >= 70 && t < 73 ? icon : 0 }));
          if (air && s.phase === 'carrier' && s.carrier === x.i) {
            out.push(Math.hypot(x.vel.x, x.vel.y) / Math.max(1e-6, v));
            break;
          }
        }
      }
      return out;
    };
    const hill = dip('Tyreek Hill');
    const welker = dip('Wes Welker');
    expect(hill.length).toBeGreaterThan(3);
    expect(welker.length).toBeGreaterThan(3);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    // (The catch tick's own step moves him too: compare the two, Welker a clear step slower out of it.)
    expect(mean(hill) - mean(welker)).toBeGreaterThan(0.05);
  });
});

describe('the forward reach by depth', () => {
  it('is the chest catch at its own reach, all of the reach at the full one, and in between in between', () => {
    expect(reachDepth(0.6)).toBe(0);
    expect(reachDepth(0.67)).toBe(0);
    expect(reachDepth(1.05)).toBe(1);
    expect(reachDepth(1.3)).toBe(1);
    const mid = reachDepth(0.85);
    expect(mid).toBeGreaterThan(0.35);
    expect(mid).toBeLessThan(0.6);
  });
});
