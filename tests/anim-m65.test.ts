import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClipMeta } from '@/anim/library';
import type { PlayState } from '@/sim';
import { catchClip } from '@/render/game/choreo';

// M6.5 #5: the catch set as exported (tools/blender/lib/actions_m65.py) and
// the render's pick of a clip for the sim's catch look.
type Meta = ClipMeta & { gates: { pass: boolean } };
const json = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { fps: number; clips: Record<string, Meta> };
const clips = json.clips;

const OVERLAYS = ['catch_hands_run', 'catch_hands_run_low', 'catch_body', 'catch_over_shoulder_l', 'catch_over_shoulder_r', 'catch_one_hand_l', 'catch_one_hand_r'];
const FULL = ['catch_high_point', 'catch_body_down', 'catch_dive_l', 'catch_dive_r', 'catch_toe_tap_l', 'catch_toe_tap_r'];

describe('the catch clips', () => {
  it('exist, pass their gates, and carry a secure frame before the tuck', () => {
    for (const n of [...OVERLAYS, ...FULL]) {
      const m = clips[n]!;
      expect(m, n).toBeDefined();
      expect(m.gates.pass, n).toBe(true);
      const ev = m.events!;
      expect(ev.secure, n).toBeGreaterThan(0);
      expect(ev.tuck!, n).toBeGreaterThan(ev.secure!);
      expect(ev.tuck!, n).toBeLessThanOrEqual(m.frames);
    }
    expect(clips.stance_down_prone_ball?.kind).toBe('stance');
  });

  it('run-speed catches are overlays; the ones that change the legs are full-body clips out of the run', () => {
    for (const n of OVERLAYS) expect(clips[n]!.kind, n).toBe('overlay');
    for (const n of FULL) {
      expect(clips[n]!.kind, n).toBe('transition');
      expect(clips[n]!.from, n).toBe('loco_run');
    }
    // The high point lands and runs on; the toe-tap gathers at a jog; SECURE in traffic and the dive end lying on the ball.
    expect(clips.catch_high_point!.to).toBe('loco_run');
    expect(clips.catch_toe_tap_l!.to).toBe('loco_jog');
    for (const n of ['catch_body_down', 'catch_dive_l', 'catch_dive_r']) expect(clips[n]!.to, n).toBe('stance_down_prone_ball');
    // The dive lays out toward the ball: its landing heading is the clip's turn.
    expect(clips.catch_dive_l!.turn).toBe(35);
    expect(clips.catch_dive_r!.turn).toBe(-35);
  });

  it('time the ball: the high point catches at the top of a ~0.6 s flight, the others within half a second', () => {
    const fps = json.fps;
    expect(clips.catch_high_point!.events!.secure! / fps).toBeGreaterThan(0.6);
    expect(clips.catch_high_point!.events!.secure! / fps).toBeLessThan(0.8);
    for (const n of [...OVERLAYS, 'catch_dive_l', 'catch_toe_tap_l']) expect(clips[n]!.events!.secure! / fps, n).toBeLessThanOrEqual(0.5);
  });
});

describe('the catch clip for a look', () => {
  // A receiver running downfield (+x) at 6 yd/s; the sim's y is to his left.
  const state = (aim: { x: number; y: number; z: number }, ballPos = { x: 10, y: 0 }): PlayState =>
    ({
      t: 0,
      agents: [{ pos: { x: 30, y: 0 }, vel: { x: 6, y: 0 }, face: 0 }],
      ball: { arrive: 1, aim, pos: { ...ballPos, z: 3 } },
    }) as unknown as PlayState;

  it('the call picks the family', () => {
    const s = state({ x: 36, y: 0, z: 1.4 });
    expect(catchClip(s, 0, 'hands')).toBe('catch_hands_run');
    expect(catchClip(state({ x: 36, y: 0, z: 0.8 }), 0, 'hands')).toBe('catch_hands_run_low');
    expect(catchClip(s, 0, 'body')).toBe('catch_body');
    expect(catchClip(state({ x: 36, y: 0, z: 2.4 }), 0, 'highPoint')).toBe('catch_high_point');
    // GO UP on a ball at his chest: no leap over it, the hands attack it.
    expect(catchClip(s, 0, 'highPoint')).toBe('catch_hands_run');
  });

  it('the side follows the ball', () => {
    expect(catchClip(state({ x: 36, y: 1.5, z: 0.4 }), 0, 'dive')).toBe('catch_dive_l');
    expect(catchClip(state({ x: 36, y: -1.5, z: 0.4 }), 0, 'dive')).toBe('catch_dive_r');
    expect(catchClip(state({ x: 36, y: 1.2, z: 2.2 }), 0, 'oneHand')).toBe('catch_one_hand_l');
    expect(catchClip(state({ x: 36, y: -1.2, z: 2.2 }), 0, 'oneHand')).toBe('catch_one_hand_r');
    // Over the shoulder the ball is dropping in from.
    expect(catchClip(state({ x: 36, y: 0, z: 1.6 }, { x: 25, y: 3 }), 0, 'overShoulder')).toBe('catch_over_shoulder_l');
    expect(catchClip(state({ x: 36, y: 0, z: 1.6 }, { x: 25, y: -3 }), 0, 'overShoulder')).toBe('catch_over_shoulder_r');
    // Running up the field, the left sideline (+y) is on his left.
    expect(catchClip(state({ x: 36, y: 26, z: 1.5 }), 0, 'toeTap')).toBe('catch_toe_tap_l');
    expect(catchClip(state({ x: 36, y: -26, z: 1.5 }), 0, 'toeTap')).toBe('catch_toe_tap_r');
  });
});
