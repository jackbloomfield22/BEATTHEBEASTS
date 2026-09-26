import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClipMeta } from '@/anim/library';
import { FAMILIES } from '@/anim/library';
import { familyWeights, sampleGait, sampleSorted, type GaitClip } from '@/anim/blend';
import { createPlay, defById, playById, practiceRosters, type SnapshotLike } from '@/sim';
import { dipFor, reachDive, trafficOf } from '@/render/game/choreo';

// M6.5 #11: the ball carrier's clip set as exported (tools/blender/lib/actions_m65_carrier.py),
// the gait families the animator blends, and the render's reads of the sim (traffic, dip, reach).
type Meta = ClipMeta & { gates: { pass: boolean; mech?: Record<string, number> } };
const json = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { fps: number; clips: Record<string, Meta> };
const clips = json.clips;

const GAITS = ['carry_jog', 'carry_run', 'carry_sprint', 'carry_traffic_jog', 'carry_traffic_run', 'carry_drive_jog', 'carry_drive_run', 'carry_drive_sprint'];
const MOVES = ['cut_plant_l', 'cut_plant_r', 'cut_plant_sharp_l', 'cut_plant_sharp_r', 'truck', 'hurdle', 'dive_reach'];

const stride = (n: string) => clips[n]!.speed * clips[n]!.duration;
const duty = (n: string) => {
  const m = clips[n]!;
  const [a, b] = m.contacts.l[0]!;
  return ((b - a + m.frames) % m.frames) / m.frames;
};

describe('the carrier clips', () => {
  it('exist and pass their gates', () => {
    for (const n of [...GAITS, ...MOVES, 'ovl_dip_l', 'ovl_dip_r', 'stance_down_prone_reach']) {
      expect(clips[n], n).toBeDefined();
      expect(clips[n]!.gates.pass, n).toBe(true);
    }
  });

  it('every family has its clips, and the carrier runs lower and further forward than a receiver', () => {
    for (const f of FAMILIES) for (const n of f) expect(clips[n]?.kind, n).toBe('locomotion');
    for (const [rec, car] of [['loco_jog', 'carry_jog'], ['loco_run', 'carry_run'], ['loco_sprint', 'carry_sprint']] as const) {
      const a = clips[rec]!.gates.mech!;
      const b = clips[car]!.gates.mech!;
      expect(b.hip!, car).toBeLessThan(a.hip! - 0.03);
      expect(b.lean!, car).toBeGreaterThan(a.lean! + 3);
      // In space the long stride stays: the carrier's matches the receiver's.
      expect(stride(car)).toBeCloseTo(stride(rec), 1);
    }
  });

  it('traffic is shorter, choppier and lower; the drive stays on the ground longer and leans the most', () => {
    // At the run's speed, the traffic step is about three quarters of the carry step.
    expect(stride('carry_traffic_run') / clips.carry_traffic_run!.speed).toBeLessThan(0.8 * (stride('carry_run') / clips.carry_run!.speed));
    expect(clips.carry_traffic_run!.gates.mech!.hip!).toBeLessThan(clips.carry_run!.gates.mech!.hip! - 0.03);
    expect(duty('carry_drive_run')).toBeGreaterThan(duty('carry_run'));
    expect(clips.carry_drive_run!.gates.mech!.lean!).toBeGreaterThan(clips.carry_run!.gates.mech!.lean! + 3);
  });

  it('the cuts plant then push, out of the run and back into it; the right cut mirrors the left', () => {
    for (const n of ['cut_plant_l', 'cut_plant_r', 'cut_plant_sharp_l', 'cut_plant_sharp_r']) {
      const m = clips[n]!;
      expect(m.from).toBe('loco_run');
      expect(m.to).toBe('loco_run');
      expect(m.events!.plant!).toBeLessThan(m.events!.push!);
      expect(m.turn ?? 0).toBe(0); // the game turns his heading with the sim's cut
    }
    // The sharp cut's plant is longer (a deeper load).
    const span = (n: string) => clips[n]!.events!.push! - clips[n]!.events!.plant!;
    expect(span('cut_plant_sharp_l')).toBeGreaterThan(span('cut_plant_l'));
    expect(clips.cut_plant_r!.contacts.l).toEqual(clips.cut_plant_l!.contacts.r);
    // Cutting left, the right (outside) foot is the one planted over the plant.
    const pl = clips.cut_plant_l!.events!.plant!;
    expect(clips.cut_plant_l!.contacts.r.some(([a, b]) => a <= pl && pl < b)).toBe(true);
  });

  it('the hurdle is in the air from the takeoff to the landing; the truck drives through its contact', () => {
    const h = clips.hurdle!;
    const { takeoff, over, land } = h.events as { takeoff: number; over: number; land: number };
    expect(takeoff).toBeLessThan(over);
    expect(over).toBeLessThan(land);
    for (const s of ['l', 'r'] as const) for (const [a, b] of h.contacts[s]) expect(b <= takeoff + 1 || a >= land, `${s} ${a}-${b}`).toBe(true);
    expect(clips.truck!.events!.contact).toBeGreaterThan(0);
    expect(clips.dive_reach!.to).toBe('stance_down_prone_reach');
  });
});

describe('the gait families', () => {
  it('share the weight between them', () => {
    const w = [0, 0, 0, 0];
    for (const [c, t, d] of [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 0.5, 1], [0.3, 0.2, 0.6]] as const) {
      familyWeights(c, t, d, w);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
    expect(familyWeights(1, 1, 1, w)).toEqual([0, 0, 0, 1]); // the drive wins over traffic
    expect(familyWeights(0, 1, 1, w)[0]).toBe(1); // not a carrier: the receiver's gaits
  });

  it('samples without allocating the same as sampleGait', () => {
    const g: GaitClip[] = [
      { name: 'a', speed: 1.3, duration: 1, duty: 0.6 },
      { name: 'b', speed: 3.5, duration: 0.7, duty: 0.36 },
      { name: 'c', speed: 5.8, duration: 0.66, duty: 0.24 },
    ];
    const out = { a: g[0]!, b: g[0]!, w: 0, stride: 0 };
    for (const v of [0, 2, 4.4, 9]) expect(sampleSorted(g, v, 0.95, out)).toEqual(sampleGait(g, v, 0.95));
  });
});

describe('the render reads the sim', () => {
  const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
  const rosters = practiceRosters(snap);
  /** A carrier at x, running upfield at 7 yd/s, one defender at (dx, dy) closing on him (the rest far behind). */
  function picture(x: number, dx: number, dy: number, los = 30, toGo = 10) {
    const s = createPlay({ seed: 11, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los, toGo, user: true });
    const c = s.agents[s.icons[0]!]!;
    c.pos = { x, y: 0 };
    c.vel = { x: 7, y: 0 };
    s.ball.mode = 'held';
    s.ball.holder = c.i;
    s.carrier = c.i;
    s.phase = 'carrier';
    for (const i of s.def) s.agents[i]!.pos = { x: x - 20, y: s.agents[i]!.pos.y };
    const d = s.agents[s.def[0]!]!;
    d.pos = { x: x + dx, y: dy };
    d.vel = { x: -dx * 2, y: -dy * 2 };
    return { s, c, d };
  }

  it('traffic follows the context pace: all in with a tackler at a yard, none in space', () => {
    expect(trafficOf(picture(40, 1.1, 0.2).s, picture(40, 1.1, 0.2).c.i)).toBeCloseTo(1);
    const open = picture(40, 8, 3);
    expect(trafficOf(open.s, open.c.i)).toBe(0);
  });

  it('dips toward a tackler closing in front, on his side, and not for one behind or far away', () => {
    const l = picture(40, 1.0, 0.5);
    expect(dipFor(l.s, l.c.i)).toBeGreaterThan(0.5);
    const r = picture(40, 1.0, -0.5);
    expect(dipFor(r.s, r.c.i)).toBeLessThan(-0.5);
    const far = picture(40, 3, 0);
    expect(dipFor(far.s, far.c.i)).toBe(0);
    const beside = picture(40, 0.1, 1.2);
    expect(dipFor(beside.s, beside.c.i)).toBe(0);
  });

  it('reaches the ball out near the goal line or the sticks, not in the open', () => {
    const goal = picture(98.5, 20, 20, 95, 5);
    expect(reachDive(goal.s, goal.c.i)).toBe(true);
    const sticks = picture(38.8, 20, 20, 30, 10);
    expect(reachDive(sticks.s, sticks.c.i)).toBe(true);
    const open = picture(50, 20, 20, 30, 10);
    expect(reachDive(open.s, open.c.i)).toBe(false);
  });
});
