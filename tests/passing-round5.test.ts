import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, defenseFor, input, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '@/sim';
import { bodyCatchShare, catchStyle, pluckOf, type CatchStyle } from '@/sim/catchstyle';
import { findStint, simPlayer } from '@/sim/roster';
import { PASSING5, userThrow, withSwap } from '@/game/clips';
import { boxShare } from '@/render/game/choreo';
import { contactTargets, type ContactBody } from '@/render/game/contact';
import { defaultSettings } from '@/app/settings';
import { defaultBindings } from '@/input/actions';

// Passing round 5 (docs/passing/PASSING5.md): the catch as a moment.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

/** A clip's play as the Practice Field runs it. */
function clipPlay(id: string): PlayState {
  const c = PASSING5.find((x) => x.id === id)!;
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  const s = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  return s;
}

/** The style the render draws, read when it starts the catch (0.3 s out), and whether it was caught. */
function styleOf(id: string): { style: CatchStyle | null; caught: boolean } {
  const s = clipPlay(id);
  const c = PASSING5.find((x) => x.id === id)!;
  let style: CatchStyle | null = null;
  for (let k = 0; k < 1200 && !s.result; k++) {
    if (!style && s.ball.mode === 'air' && s.ball.target >= 0 && s.agents[s.ball.target]!.side === 'off' && s.ball.arrive - s.t <= 0.3) style = catchStyle(s, s.agents[s.ball.target]!);
    stepPlay(s, c.script(s));
  }
  return { style, caught: !!s.result?.pass?.complete };
}

describe('the catch styles', () => {
  it('each catch clip shows the catch it is named for, and is caught', () => {
    const want: Record<string, CatchStyle> = {
      'p5-hands': 'hands',
      'p5-body': 'body',
      'p5-high': 'handsHigh',
      'p5-low': 'handsLow',
      'p5-scoop': 'scoop',
      'p5-reach': 'reach',
      'p5-contested': 'contested',
      'p5-highpoint': 'highPoint',
      'p5-shoulder': 'overShoulder',
      'p5-toetap': 'toeTap',
    };
    for (const [id, style] of Object.entries(want)) {
      const r = styleOf(id);
      expect(r.style, id).toBe(style);
      expect(r.caught, id).toBe(true);
    }
  });

  it('every player is himself: sure hands pluck it, a body catcher lets it in', () => {
    const agent = (name: string, pos: string) => {
      const p = simPlayer(findStint(snap, name, pos)!, 80);
      const s = createPlay({ seed: 1, offense: { ...rosters.offense, X: p }, defense: rosters.defense, play: playById('trips-stick'), def: defById('cover2'), los: 30, toGo: 10, user: false });
      return s.agents.find((a) => a.p.id === p.id)!;
    };
    const rice = agent('Jerry Rice', 'WR');
    const benjamin = agent('Kelvin Benjamin', 'WR');
    expect(pluckOf(rice)).toBeGreaterThan(0.95);
    expect(bodyCatchShare(rice)).toBe(0);
    expect(pluckOf(benjamin)).toBeLessThan(0.2);
    expect(bodyCatchShare(benjamin)).toBeGreaterThanOrEqual(0.85);
    // The same snap, the same ball: Rice catches it in his hands, Benjamin in his chest.
    expect(styleOf('p5-hands').style).toBe('hands');
    expect(styleOf('p5-body').style).toBe('body');
  });

  it('the bigger, stronger man boxes the other out at the catch point', () => {
    const s = clipPlay('p5-contested');
    const gronk = s.agents.find((a) => a.p.name === 'Rob Gronkowski')!;
    const lott = s.agents.find((a) => a.p.name === 'Ronnie Lott')!;
    expect(boxShare(gronk, lott)).toBeGreaterThan(0.6);
    expect(boxShare(lott, gronk)).toBeLessThan(0.45);
    // The lean follows the share (contact.ts): the man boxing out leans in more.
    const body = (x: number, box: number): ContactBody => ({ x, z: 0, fx: 0, fz: 1, ext: { hw: 0.28, hd: 0.16 }, scale: 1, free: true, box });
    const out: { ox: number; oz: number; lx: number; lz: number }[] = [];
    contactTargets([body(0, 0.7), body(0.75, 0.3)], [[0, 1]], out);
    expect(Math.abs(out[0]!.lx)).toBeGreaterThan(Math.abs(out[1]!.lx));
    contactTargets([body(0, 0.5), body(0.75, 0.5)], [[0, 1]], out);
    expect(Math.abs(out[0]!.lx)).toBeCloseTo(Math.abs(out[1]!.lx), 6);
  });
});

describe('the late out', () => {
  it('on a ball lofted over the flat defender, he drives back to it instead of waiting at his plant', () => {
    // The hot-routed out thrown a third of a second late (passing round 4's case), on the seeds where the QB has to loft it.
    let lofted = 0;
    for (const seed of [1, 2, 3, 4, 7, 9, 10, 11]) {
      const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-curls'), def: defById('cover3'), los: 30, toGo: 10, user: true });
      const f = userThrow({ icon: 1, at: 120, hot: 'out' });
      let stood = 0;
      let kind = '';
      let end = 0;
      let off = 0;
      for (let k = 0; k < 900 && !s.result; k++) {
        if (s.phase === 'air' && s.ball.target >= 0) {
          const a = s.agents[s.ball.target]!;
          kind ||= String(s.ball.kind);
          off = Math.hypot(s.ball.aim.x - s.ball.meant.x, s.ball.aim.y - s.ball.meant.y);
          if (s.ball.arrive - s.t <= 1 && Math.hypot(a.vel.x, a.vel.y) < 1.5) stood++;
          end = -a.vel.x;
        }
        stepPlay(s, s.phase === 'carrier' ? input({ move: { x: 1, y: 0 } }) : f(s));
      }
      // (A ball the QB missed by more than his read takes him off his route to it: runToBall's, not the plant's.)
      if (kind !== 'touch' || off > 1.2) continue;
      lofted++;
      // Round four: he stood ~0.43 s of the last second; now no more than a plant's few ticks, and he's coming back at the catch.
      expect(stood / 60, `seed ${seed}`).toBeLessThan(0.25);
      expect(end, `seed ${seed}`).toBeGreaterThan(0.5);
    }
    expect(lofted).toBeGreaterThanOrEqual(2);
  });
});

describe('the throw-timing cue setting', () => {
  it('is on by default', () => {
    expect(defaultSettings(defaultBindings('kb'), defaultBindings('pad')).gameplay.throwCue).toBe(true);
  });
});
