import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, DEF_CALLS, input, PLAYS, practiceRosters, TICK, type PlayResult, type SnapshotLike } from '@/sim';
import { SimRunner } from '@/game/runner';
import { stepPlay } from '@/sim';
import { hashPlay } from '@/sim/hash';
import { nextSituation, startSituation, downLabel, spotLabel, HASH_Y } from '@/game/situation';
import { placementFrom, stickToField } from '@/game/controls';
import { lerpAngle } from '@/game/snapshot';
import { fieldDir, worldDir, worldX, worldZ, yawOf } from '@/game/coords';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const setup = (seed: number) => createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: PLAYS[0]!, def: DEF_CALLS[0]!, los: 25, toGo: 10, user: true });

describe('game: the fixed-step runner', () => {
  it('steps 60 Hz whatever the frame rate, and the recording replays to the same state', () => {
    const script = (s: { tick: number }) => input({ snap: s.tick === 0, throwHeld: s.tick > 90 && s.tick < 100 ? 2 : 0 });
    // Uneven frames: 144 Hz, 30 Hz, a hitch.
    const r = new SimRunner(setup(3));
    const frames = [1 / 144, 1 / 30, 0.2, 1 / 60, 1 / 144, 1 / 90];
    for (let k = 0; r.state.tick < 400; k++) r.advance(frames[k % frames.length]!, script);
    const replay = setup(3);
    for (const f of r.frames) stepPlay(replay, f);
    expect(hashPlay(replay)).toBe(r.hash());
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThanOrEqual(1);
  });

  it('runs at most five ticks per frame and never spirals', () => {
    const r = new SimRunner(setup(4));
    expect(r.advance(1, () => input({}))).toBe(5);
    expect(r.advance(TICK, () => input({}))).toBeLessThanOrEqual(2);
  });

  it('keeps the previous and current snapshots one tick apart', () => {
    const r = new SimRunner(setup(5));
    r.advance(TICK * 10.5, (s) => input({ snap: s.tick === 0 }));
    expect(r.cur.tick - r.prev.tick).toBe(1);
  });
});

describe('game: down, distance and the spot', () => {
  const res = (p: Partial<PlayResult>): PlayResult => ({ reason: 'tackle', spot: 30, yards: 5, offenseBall: true, touchdown: false, sack: false, ticks: 1, ...p });
  it('moves the chains and the downs like a series', () => {
    const s = startSituation(0, 0); // 1st & 10 at the 25
    const a = nextSituation(s, res({ spot: 30 }), 0)!;
    expect(a).toMatchObject({ los: 30, down: 2, toGo: 5 });
    const b = nextSituation(a, res({ spot: 36, reason: 'outOfBounds' }), 20)!;
    expect(b).toMatchObject({ los: 36, down: 1, toGo: 10 });
    expect(b.ballY).toBeCloseTo(HASH_Y);
    const c = nextSituation(b, res({ reason: 'incomplete', spot: 36 }), 0)!;
    expect(c).toMatchObject({ los: 36, down: 2 });
    expect(nextSituation({ ...c, down: 4 }, res({ spot: 38 }), 0)).toBeNull();
    expect(nextSituation(c, res({ touchdown: true, spot: 100 }), 0)).toBeNull();
    expect(nextSituation(c, res({ offenseBall: false }), 0)).toBeNull();
  });
  it('labels goal to go and field position', () => {
    expect(downLabel({ los: 95, ballY: 0, down: 1, toGo: 5 })).toBe('1st & Goal');
    expect(spotLabel(25)).toBe('Own 25');
    expect(spotLabel(65)).toBe('Opp 35');
    expect(spotLabel(50)).toBe('the 50');
  });
});

describe('game: input and view mapping', () => {
  it('turns a camera-relative stick into the field frame', () => {
    // Camera behind the offense looking downfield: up is +x, right is −y (the offense's right).
    expect(stickToField(0, 1, { x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(stickToField(1, 0, { x: 1, y: 0 })).toEqual({ x: 0, y: -1 });
    // Camera on the offense's left sideline looking across (−y): downfield is to the viewer's left.
    const r = stickToField(1, 0, { x: 0, y: -1 });
    expect(r.x).toBeCloseTo(-1);
    expect(r.y).toBeCloseTo(0);
  });
  it("reads placement along the receiver's motion", () => {
    // Receiver crossing left to right on screen: a cursor right of the icon is lead, above it is high.
    expect(placementFrom(56, 0, 1, 0)).toEqual({ x: 1, y: -0 });
    expect(placementFrom(0, -56, 1, 0).y).toBeCloseTo(1);
    // Straight up the screen (a go route): above the icon is lead, and there's no separate "high".
    const go = placementFrom(0, -56, 0, -1);
    expect(go.x).toBeCloseTo(1);
    expect(go.y).toBeCloseTo(0);
  });
  it('maps the field to the world consistently', () => {
    expect(worldZ(50)).toBeCloseTo(0);
    expect(worldZ(0)).toBeGreaterThan(0); // the offense's goal line is the south one
    expect(worldX(10)).toBeLessThan(0); // the offense's left is −X
    const [wx, wz] = worldDir(1, 0);
    const [fx, fy] = fieldDir(wx, wz);
    expect(fx).toBeCloseTo(1);
    expect(fy).toBeCloseTo(0);
    // Facing downfield turns the model (which faces +Z) half a turn, toward −Z.
    expect(Math.cos(yawOf(0))).toBeCloseTo(-1);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
  });
});
