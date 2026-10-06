import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, playById, practiceRosters, type SnapshotLike } from '@/sim';
import { layer, planThrow, rpmOf, spiralOf } from '@/sim/passing';
import { footballBounce } from '@/sim/play';
import type { Agent } from '@/sim/types';

// The passing game, end to end (docs/passing/PASSING.md): the spiral and its
// spin, a hit as he throws, the layered deep ball and the football's bounce.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

function setup(seed: number, d: number) {
  const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: playById('trips-stick'), def: defById('cover3'), los: 35, toGo: 10, user: false });
  const qb = s.agents[s.qb]!;
  qb.pos = { x: 30, y: 0 };
  qb.vel = { x: 0, y: 0 };
  const rec: Agent = s.agents[s.icons[0]!]!;
  rec.pos = { x: 30 + d, y: 0 };
  rec.vel = { x: 0, y: 0 };
  return { s, qb, rec };
}

describe('the spiral', () => {
  it('a clean throw from an accurate passer is tight; pressure, a mechanics miss and a hit loosen it', () => {
    const clean = spiralOf(0.99, 1, false, 0, false, false);
    expect(clean).toBeGreaterThan(0.9);
    expect(spiralOf(0.7, 1, false, 0, false, false)).toBeLessThan(clean);
    expect(spiralOf(0.99, 2.5, false, 0, false, false)).toBeLessThan(clean - 0.2);
    expect(spiralOf(0.99, 1, false, 0, true, false)).toBeLessThan(0.65);
    expect(spiralOf(0.99, 1, false, 0, false, true)).toBeLessThan(0.2);
  });
  it('spins ~600 rpm, a little faster from a bigger arm', () => {
    expect(rpmOf(80)).toBeGreaterThan(560);
    expect(rpmOf(80)).toBeLessThan(640);
    expect(rpmOf(99)).toBeGreaterThan(rpmOf(70) + 60);
  });
});

describe('hit as he throws', () => {
  it('the ball comes out slow, off target, and the throw event says so', () => {
    let slower = 0;
    let offA = 0;
    let offB = 0;
    for (let k = 0; k < 60; k++) {
      const a = setup(800 + k, 15);
      const b = setup(800 + k, 15);
      const clean = planThrow(a.s, a.qb, a.rec, 0, { x: 0, y: 0 }, 0, false, false);
      const hit = planThrow(b.s, b.qb, b.rec, 0, { x: 0, y: 0 }, 0, false, true);
      // (A ball that gets away from him short of the spot can land as soon as a clean one.)
      if (hit.T / hit.distance > (clean.T / clean.distance) * 1.2) slower++;
      offA += clean.err.off;
      offB += hit.err.off;
      expect(hit.hit).toBe(true);
      expect(hit.spiral).toBeLessThan(0.2);
    }
    expect(slower).toBeGreaterThan(50);
    expect(offB).toBeGreaterThan(offA * 1.5);
  });
});

describe('the layered deep ball', () => {
  it('the AI drives it short and layers it deep', () => {
    expect(layer(15)).toBe(0);
    expect(layer(24)).toBe(0);
    expect(layer(34)).toBeGreaterThan(0.3);
    expect(layer(60)).toBeCloseTo(0.8);
  });
});

describe('the football bounce', () => {
  it('skids low off its belly, kicks up off a point, and loses pace either way; the same seed bounces the same', () => {
    const v = { x: 6, y: 0, z: -5 };
    let tips = 0;
    const first: number[] = [];
    for (let k = 0; k < 400; k++) {
      const { s } = setup(100 + k, 10);
      const out = footballBounce(s, v);
      if (k < 5) first.push(out.x, out.y, out.z);
      expect(out.z).toBeGreaterThan(0);
      expect(out.z).toBeLessThan(5 * 0.56);
      expect(Math.hypot(out.x, out.y)).toBeLessThan(6 * 0.6);
      if (out.z > 5 * 0.3) tips++;
    }
    // About two bounces in five off a point.
    expect(tips / 400).toBeGreaterThan(0.3);
    expect(tips / 400).toBeLessThan(0.5);
    const again: number[] = [];
    for (let k = 0; k < 5; k++) {
      const out = footballBounce(setup(100 + k, 10).s, v);
      again.push(out.x, out.y, out.z);
    }
    expect(again).toEqual(first);
  });
});
