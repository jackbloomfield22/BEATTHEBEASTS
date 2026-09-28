import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClipMeta } from '@/anim/library';
import { createPlay, defById, playById, practiceRosters, type SnapshotLike } from '@/sim';
import { bodyExtent, contactTargets, ContactSmoother, LEAN_MAX, PAD_HEIGHT, PRESS, PUSH_MAX, trunkGap, type ContactBody, type ContactTarget } from '@/render/game/contact';
import { CONTEST_R, contestFor } from '@/render/game/choreo';

// M6.5 #12: the drawn bodies in contact (src/render/game/contact.ts), the
// contested catch (choreo.ts contestFor, the def_contest clips), and the
// skinning gate the character build writes.

const lb = (x: number) => x * 0.45359237;
const inch = (x: number) => x * 0.0254;

describe('the trunk extents', () => {
  it('match the model as measured (tools/blender/measure_bodies.py; the fit is within 0.7 cm)', () => {
    // Pad half-width at the roster medians (docs/m65/BODIES.md table).
    expect(Math.abs(bodyExtent('WR', inch(72), lb(195)).hw - 0.281)).toBeLessThan(0.008);
    expect(Math.abs(bodyExtent('CB', inch(72), lb(193)).hw - 0.28)).toBeLessThan(0.008);
    expect(Math.abs(bodyExtent('LB', inch(74), lb(235)).hw - 0.357)).toBeLessThan(0.008);
    expect(Math.abs(bodyExtent('OL', inch(76), lb(300)).hw - 0.406)).toBeLessThan(0.008);
    expect(Math.abs(bodyExtent('DL', inch(76), lb(292)).hw - 0.405)).toBeLessThan(0.008);
  });

  it('are broader than deep, and bigger for the big men', () => {
    for (const [pos, h, w] of [['WR', 72, 195], ['RB', 71, 215], ['TE', 76, 250], ['OL', 78, 340]] as const) {
      const e = bodyExtent(pos, inch(h), lb(w));
      expect(e.hw).toBeGreaterThan(e.hd * 1.4);
    }
    expect(bodyExtent('OL', inch(76), lb(300)).hw).toBeGreaterThan(bodyExtent('CB', inch(72), lb(193)).hw + 0.1);
  });
});

const wr = bodyExtent('WR', inch(72), lb(195));

function body(x: number, z: number, fx = 0, fz = 1, free = true): ContactBody {
  return { x, z, fx, fz, ext: wr, scale: 1, free };
}

describe('the gap between two trunks', () => {
  it('side by side is the distance less both half-widths; one behind the other, less both half-depths', () => {
    expect(trunkGap(body(0, 0), wr, body(0.66, 0), wr)).toBeCloseTo(0.66 - 2 * wr.hw, 6);
    expect(trunkGap(body(0, 0), wr, body(0, 0.66), wr)).toBeCloseTo(0.66 - 2 * wr.hd, 6);
  });
});

describe('the contact response', () => {
  const out: ContactTarget[] = [];

  it('pushes overlapping trunks apart, evenly, by at most PUSH_MAX, and leaves the rest alone', () => {
    contactTargets([body(0, 0), body(0.5, 0), body(5, 5)], [], out);
    const over = 2 * wr.hw - 0.5;
    expect(out[0]!.ox).toBeCloseTo(-over / 2, 6);
    expect(out[1]!.ox).toBeCloseTo(over / 2, 6);
    expect(out[2]).toEqual({ ox: 0, oz: 0, lx: 0, lz: 0 });
    contactTargets([body(0, 0), body(0.02, 0)], [], out);
    expect(Math.hypot(out[0]!.ox, out[0]!.oz)).toBeCloseTo(PUSH_MAX, 6);
  });

  it('never moves a body that is down, and never leans a pair that is not contesting', () => {
    contactTargets([body(0, 0), body(0.5, 0, 0, 1, false)], [], out);
    expect(out[0]).toEqual({ ox: 0, oz: 0, lx: 0, lz: 0 });
    contactTargets([body(0, 0), body(0.66, 0)], [], out);
    expect(out[0]!.lx).toBe(0);
  });

  it('leans a contested pair into each other so the pads meet, pressing a little', () => {
    contactTargets([body(0, 0), body(0.66, 0)], [[0, 1]], out);
    const gap = 0.66 - 2 * wr.hw;
    const ang = Math.atan2(gap / 2 + PRESS, PAD_HEIGHT);
    expect(out[0]!.lx).toBeCloseTo(ang, 6);
    expect(out[1]!.lx).toBeCloseTo(-ang, 6);
    expect(out[0]!.ox).toBe(0);
    // Each chest travels half the gap and the press at the pads.
    expect(PAD_HEIGHT * Math.sin(ang) * 2).toBeGreaterThan(gap);
    // Too far apart to reach: no lean.
    contactTargets([body(0, 0), body(1.5, 0)], [[0, 1]], out);
    expect(out[0]!.lx).toBe(0);
    expect(LEAN_MAX).toBeLessThan(0.2);
  });

  it('eases in and out rather than popping', () => {
    const sm = new ContactSmoother();
    const pair = [body(0, 0), body(0.5, 0)];
    const first = sm.update(pair, [], 1 / 60)[0]!.ox;
    expect(first).toBeLessThan(0);
    expect(Math.abs(first)).toBeLessThan((2 * wr.hw - 0.5) / 2 / 3);
    for (let k = 0; k < 120; k++) sm.update(pair, [], 1 / 60);
    expect(sm.cur[0]!.ox).toBeCloseTo(-(2 * wr.hw - 0.5) / 2, 3);
    const apart = [body(0, 0), body(3, 0)];
    sm.update(apart, [], 1 / 60);
    expect(sm.cur[0]!.ox).toBeLessThan(0); // still letting go
    for (let k = 0; k < 240; k++) sm.update(apart, [], 1 / 60);
    expect(Math.abs(sm.cur[0]!.ox)).toBeLessThan(1e-4);
  });
});

describe('the contested catch', () => {
  const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
  const rosters = practiceRosters(snap);
  /** A receiver at (40, 0) running upfield, the ball arriving in 0.3 s, one defender at (dx, dy) running with him. */
  function picture(dx: number, dy: number) {
    const s = createPlay({ seed: 3, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover1'), los: 30, toGo: 10, user: true });
    const r = s.agents[s.icons[0]!]!;
    r.pos = { x: 40, y: 0 };
    r.vel = { x: 7, y: 0 };
    for (const i of s.def) s.agents[i]!.pos = { x: 10, y: s.agents[i]!.pos.y };
    const d = s.agents[s.def[0]!]!;
    d.pos = { x: 40 + dx, y: dy };
    d.vel = { x: 7, y: 0 };
    d.face = 0;
    s.ball.mode = 'air';
    s.ball.target = r.i;
    s.ball.arrive = s.t + 0.3;
    return { s, r, d };
  }

  it('finds the defender at the catch point and which side of him the receiver is', () => {
    const left = picture(-0.4, -0.6); // the defender a step behind on the receiver's right: the receiver is on the defender's left
    expect(contestFor(left.s, left.r.i)).toEqual({ d: left.d.i, side: 1 });
    const right = picture(-0.3, 0.7);
    expect(contestFor(right.s, right.r.i)).toEqual({ d: right.d.i, side: -1 });
  });

  it('leaves an open receiver alone', () => {
    const open = picture(-2, CONTEST_R + 0.5);
    expect(contestFor(open.s, open.r.i)).toBeNull();
  });

  it('has its clips: the arm across on either side, timed by a contact frame, over the run', () => {
    type Meta = ClipMeta & { gates: { pass: boolean } };
    const clips = (JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { clips: Record<string, Meta> }).clips;
    for (const n of ['def_contest_l', 'def_contest_r']) {
      const m = clips[n]!;
      expect(m.kind, n).toBe('overlay');
      expect(m.gates.pass, n).toBe(true);
      expect(m.events!.contact!).toBeGreaterThan(4);
      expect(m.events!.contact!).toBeLessThan(m.frames / 2);
      // Arms and upper spine only: the legs stay the sim's.
      expect(m.mask).toContain('spine_03');
      expect(m.mask).toContain('upperarm_l');
      expect(m.mask!.some((b) => b.startsWith('thigh') || b.startsWith('calf'))).toBe(false);
    }
    expect(clips.def_contest_r!.mask!.slice().sort()).toEqual(clips.def_contest_l!.mask!.slice().sort());
  });
});

describe('the skinning gate', () => {
  it('the character build measured every LOD through the fast clips and the reaches, and passed', () => {
    const p = JSON.parse(readFileSync('public/assets/characters/player.json', 'utf8')) as {
      skinGate: { pass: boolean; groups: Record<string, { clips: string[]; regions: Record<string, { pass: boolean; collapsed: number; flips: number }> }> };
    };
    const g = p.skinGate;
    expect(g.pass).toBe(true);
    expect(g.groups.speed!.clips).toEqual(expect.arrayContaining(['sprint', 'cut_plant_sharp_l']));
    expect(g.groups.reach!.clips).toEqual(expect.arrayContaining(['catch_high_point', 'dive']));
    for (const grp of Object.values(g.groups)) {
      expect(Object.keys(grp.regions).sort()).toEqual(['elbow', 'hip', 'knee', 'shoulder']);
      for (const r of Object.values(grp.regions)) expect(r.pass).toBe(true);
    }
    // At speed the shoulder holds its shape: under 2.2% of its faces collapsed (4-5% before the pad shell),
    // and the pad caps ride the chest (they stood 12 cm off it at the sprint's arm swing: the fin).
    expect(g.groups.speed!.regions.shoulder!.collapsed).toBeLessThan(0.022);
    const lift = (g.groups.speed as unknown as { capLift: { m: number; pass: boolean } }).capLift;
    expect(lift.pass).toBe(true);
    expect(lift.m).toBeLessThan(0.04);
  });
});
