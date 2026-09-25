import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { travelAt, type ClipMeta } from '@/anim/library';

// The transition clips as exported (tools/blender/build_anims.py).
const json = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { fps: number; clips: Record<string, ClipMeta & { gates: { pass: boolean } }> };
const transitions = Object.entries(json.clips).filter(([, m]) => m.kind === 'transition');

describe('transition clips', () => {
  it('cover the huddle break, every set, get-off and stop', () => {
    const names = transitions.map(([n]) => n);
    expect(names).toContain('huddle_break');
    for (const s of ['ol_3pt', 'dl_3pt', 'dl_4pt', 'wr_2pt', 'lb_ready', 'db_ready', 'rb_2pt']) {
      expect(names).toContain(`set_${s}`);
      expect(names).toContain(`getoff_${s}`);
    }
    for (const g of ['walk', 'jog', 'run', 'sprint']) expect(names).toContain(`stop_${g}`);
  });

  it('pass their gates and join clips that exist', () => {
    for (const [name, m] of transitions) {
      expect(m.gates.pass, name).toBe(true);
      expect(json.clips[m.from!], `${name} from`).toBeDefined();
      expect(json.clips[m.to!], `${name} to`).toBeDefined();
      expect(m.travel!.length, name).toBe(m.frames + 1);
    }
  });

  it('never travel backward, and hand over at the next clip speed', () => {
    for (const [name, m] of transitions) {
      const tr = m.travel!;
      // Out of the backpedal (a defensive back's break), the body is still
      // moving back when the clip starts: it may give ground only until it
      // has stopped on the plant, never after.
      let stopped = m.from !== 'loco_backpedal';
      for (let i = 1; i < tr.length; i++) {
        const d = tr[i]! - tr[i - 1]!;
        if (!stopped && d >= 0) stopped = true;
        if (stopped) expect(d, `${name} frame ${i}`).toBeGreaterThanOrEqual(-1e-4);
      }
      const endSpeed = (tr[tr.length - 1]! - tr[tr.length - 2]!) * json.fps;
      const to = json.clips[m.to!]!;
      // Within the last frame's worth of acceleration of the clip it hands to.
      expect(Math.abs(endSpeed - to.speed), name).toBeLessThan(0.25 * Math.max(1, to.speed));
    }
  });

  it('samples the travel curve between frames', () => {
    const m = { travel: [0, 1, 3] } as unknown as ClipMeta;
    expect(travelAt(m, 30, 0)).toBe(0);
    expect(travelAt(m, 30, 1.5 / 30)).toBeCloseTo(2);
    expect(travelAt(m, 30, 10)).toBe(3);
    expect(travelAt(m, 30, -1)).toBe(0);
  });
});

describe('M5 action clips', () => {
  const clips = json.clips;
  it('exist, pass their gates, and carry the events the game times them by', () => {
    for (const n of ['qb_drop_gun3', 'qb_drop_gun5', 'qb_throw', 'juke_l', 'juke_r', 'spin', 'dive', 'tackle', 'getup_prone', 'getup_supine']) {
      expect(clips[n], n).toBeDefined();
      expect(clips[n]!.gates.pass, n).toBe(true);
    }
    expect(clips.qb_throw!.events?.release).toBe(11);
    expect(clips.ovl_catch!.events?.secure).toBe(6);
    expect(clips.tackle!.events?.contact).toBe(8);
    // Drops end in the pocket set; the tackle and the dive leave him lying down.
    expect(clips.qb_drop_gun3!.to).toBe('stance_qb_set');
    expect(clips.tackle!.to).toBe('stance_down_prone');
    expect(clips.dive!.to).toBe('stance_down_prone');
    for (const s of ['stance_qb_set', 'stance_down_prone', 'stance_down_supine']) expect(clips[s]?.kind, s).toBe('stance');
  });
  it('overlays drive only the upper body (their masks never touch the legs or the pelvis)', () => {
    const overlays = Object.entries(clips).filter(([, m]) => m.kind === 'overlay');
    expect(overlays.map(([n]) => n).sort()).toEqual([
      'ovl_carry_r', 'ovl_catch', 'ovl_catch_high', 'ovl_getoff', 'ovl_handoff_l', 'ovl_handoff_r', 'ovl_pa_fake_l', 'ovl_pa_fake_r',
      'ovl_protect', 'ovl_pump', 'ovl_qb_hold', 'ovl_stiff_arm', 'ovl_take_l', 'ovl_take_r', 'ovl_truck', 'ovl_tuck',
    ]);
    for (const [n, m] of overlays) {
      expect(m.mask!.length, n).toBeGreaterThan(5);
      for (const b of m.mask!) expect(/^(pelvis|root|thigh|calf|foot|toe|spine_01)/.test(b), `${n}: ${b}`).toBe(false);
    }
  });
});
