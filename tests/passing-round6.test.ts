import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '@/sim';
import { catchAhead, handsAt, HANDS_FAR, HANDS_NEAR, pluckOf } from '@/sim/passing';
import { PASSING6, withSwap } from '@/game/clips';
import { familyWeights } from '@/anim/blend';

// Passing round 6 (docs/passing/PASSING6.md): the catch at his hands, the
// QB leading him there, the man under a short ball, the deep ball's clips
// and the ball in the left arm.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

function clipPlay(id: string): PlayState {
  const c = PASSING6.find((x) => x.id === id)!;
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  return createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
}

/** A clip run to the whistle: at the release, where the man was and where the QB meant the ball; the predicted and the real catch; the ball against his hands at the catch. */
function follow(id: string) {
  const s = clipPlay(id);
  const c = PASSING6.find((x) => x.id === id)!;
  let rel: { x: number; y: number; ux: number; uy: number; v: number; mx: number; my: number; hang: number } | null = null;
  let predicted: number | null = null;
  let caught: { t: number; along: number; toHands: number } | null = null;
  let speedAt23 = -1;
  for (let k = 0; k < 1500 && !s.result; k++) {
    const air = s.phase === 'air' && s.ball.target >= 0;
    const r = air ? s.agents[s.ball.target]! : null;
    if (r && !rel) {
      const v = Math.hypot(r.vel.x, r.vel.y);
      rel = { x: r.pos.x, y: r.pos.y, ux: r.vel.x / v, uy: r.vel.y / v, v, mx: s.ball.meant.x, my: s.ball.meant.y, hang: s.ball.arrive - s.t };
    }
    if (r && rel && speedAt23 < 0 && s.t - (s.ball.arrive - rel.hang) >= (2 / 3) * rel.hang) speedAt23 = Math.hypot(r.vel.x, r.vel.y);
    // The catch as the drawing predicts it a quarter second out (choreo.ts paces the clip to it).
    if (r && predicted === null && s.ball.arrive - s.t <= 0.25) {
      const a = catchAhead(s, r);
      if (a) predicted = s.t + a.dt;
    }
    stepPlay(s, c.script(s));
    if (r && !caught && s.ball.mode === 'held' && s.ball.holder === r.i) {
      // The ball against the line from his chest out to his hands (on the ground).
      const h = handsAt(r);
      const sp = Math.hypot(r.vel.x, r.vel.y) || 1;
      const ux = h.x - r.pos.x;
      const uy = h.y - r.pos.y;
      const u = Math.max(0, Math.min(1, ((s.ball.pos.x - r.pos.x) * ux + (s.ball.pos.y - r.pos.y) * uy) / (ux * ux + uy * uy)));
      caught = { t: s.t, along: ((s.ball.pos.x - r.pos.x) * r.vel.x + (s.ball.pos.y - r.pos.y) * r.vel.y) / sp, toHands: Math.hypot(s.ball.pos.x - r.pos.x - ux * u, s.ball.pos.y - r.pos.y - uy * u) };
    }
  }
  return { s, rel: rel!, predicted, caught, speedAt23 };
}

describe('the catch at his hands', () => {
  it('the deep ball on the cue is taken out in front of him, at his hands, on the tick the drawing paced the clip to', () => {
    for (const id of ['p6-go', 'p6-post', 'p6-corner']) {
      const f = follow(id);
      expect(f.s.result?.pass?.complete, id).toBe(true);
      expect(f.caught, id).not.toBeNull();
      // In front of his centre and within a hand of the line from his chest to his hands, where the ball comes closest to them (round five: 0.4 yd behind his shoulder, a yard off them).
      expect(f.caught!.along, id).toBeGreaterThan(0);
      expect(f.caught!.toHands, id).toBeLessThan(0.7);
      // The drawing's prediction (sim/passing.ts catchAhead) a quarter second out is the sim's catch to within a tick or two.
      expect(Math.abs(f.predicted! - f.caught!.t), id).toBeLessThan(2.5 / 60);
    }
  });

  it('the QB leads him: the ball is meant for where he is going, a full run ahead of him', () => {
    for (const id of ['p6-go', 'p6-post', 'p6-corner', 'p6-cross']) {
      const { rel } = follow(id);
      const lead = (rel.mx - rel.x) * rel.ux + (rel.my - rel.y) * rel.uy;
      expect(lead / (rel.v * rel.hang), id).toBeGreaterThan(0.95);
    }
  });

  it('a sure hand meets it farther out than a poor one', () => {
    const s = clipPlay('p6-go');
    const rice = s.agents.find((a) => a.p.name === 'Jerry Rice')!;
    expect(pluckOf(rice)).toBeGreaterThan(0.95);
    const h = handsAt(rice);
    expect(Math.hypot(h.x - rice.pos.x, h.y - rice.pos.y)).toBeCloseTo(HANDS_FAR, 1);
    expect(HANDS_NEAR).toBeLessThan(HANDS_FAR);
  });
});

describe('the man under the ball', () => {
  it('under the weak arm\'s short go he keeps his stride through most of the flight', () => {
    const f = follow('p6-weak-go');
    expect(f.speedAt23 / f.rel.v).toBeGreaterThan(0.9);
  });
});

describe('the clips', () => {
  it('the deep ball catches and the left-arm carry are in the library, with their events', () => {
    const json = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { clips: Record<string, { kind: string; events?: Record<string, number> }> };
    for (const n of ['catch_over_shoulder_l', 'catch_over_shoulder_r', 'catch_high_point', 'catch_toe_tap_l', 'catch_toe_tap_r']) {
      expect(json.clips[n]?.events?.secure, n).toBeGreaterThan(0);
      expect(json.clips[n]!.events!.tuck!, n).toBeGreaterThan(json.clips[n]!.events!.secure!);
    }
    for (const n of ['carry_jog_l', 'carry_run_l', 'carry_sprint_l', 'carry_traffic_jog_l', 'carry_traffic_run_l', 'carry_drive_jog_l', 'carry_drive_run_l', 'carry_drive_sprint_l']) expect(json.clips[n]?.kind, n).toBe('locomotion');
    expect(json.clips.ovl_carry_l?.kind).toBe('overlay');
  });

  it('the ball in the left arm moves the carrier families to their left-arm twins', () => {
    const w = [0, 0, 0, 0, 0, 0, 0];
    familyWeights(1, 0, 0, w, 1);
    expect(w).toEqual([0, 0, 0, 0, 1, 0, 0]);
    familyWeights(1, 0, 0, w, 0);
    expect(w).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });
});
