import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, DEF_CALLS, NEUTRAL, PLAYS, practiceRosters, runToWhistle, type SnapshotLike } from '@/sim';
import { passDistribution, runDistribution, sidesFor } from '@/sim/outcomes';

// The shape of the game: the AI-vs-AI harness at Pro against the all-time
// Beasts, the whole everyday book against every call, the Beasts in the
// package they'd bring (nickel against three receivers), from both hashes
// and the middle, flipped and not. The bands are wide enough for the sample,
// tight enough that a change that breaks the shape fails here. The figures
// and the NFL references are in docs/PROGRESS.md; M6's targets are in the
// comments.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

describe('outcomes: the passing game', () => {
  const d = passDistribution(rosters, 8);
  it('keeps the explosive tail: ~10% of completions go 20+, a few percent 40+', () => {
    expect(d.exp20).toBeGreaterThan(0.07);
    expect(d.exp20).toBeLessThan(0.18);
    expect(d.exp40).toBeGreaterThan(0.015);
    expect(d.exp40).toBeLessThan(0.08);
  });
  it('completes 60–65% for about 7 yards an attempt, with yards after the catch from geometry', () => {
    // M6 targets: 60–65% and 6.5–7.5 (M5.5 ran 72% and 9.6). M6.5: with
    // misses only for a reason (#1: M6 held completion down with a flat 13%
    // random miss) and open catches near-automatic (#3), the 80s 49ers
    // complete ~68% against the Beasts (Montana's best seasons ran 64–70%),
    // so the ceiling is 0.70; the AI's read checks down more than it should
    // (docs/PROGRESS.md, M6.5), and a sharper read is what brings it lower.
    expect(d.cmpPct).toBeGreaterThan(0.58);
    expect(d.cmpPct).toBeLessThan(0.7);
    expect(d.ypa).toBeGreaterThan(6.0);
    expect(d.ypa).toBeLessThan(8.0);
    expect(d.yacShort).toBeGreaterThan(3.5);
    expect(d.yacShort).toBeLessThan(7);
  });
  it('separation decides the catch: in phase mostly fails, open mostly caught', () => {
    expect(d.contestedCatch).toBeLessThan(0.4);
    // Open (2+ yd) still misses on drops and throws that get away (~20%: PFF's uncatchable and drop rates).
    expect(d.openCatch).toBeGreaterThan(0.7);
  });
  it('the ball is driven, not floated: ~0.6 s to 10 yd and ~0.9 s to 20 from a 90 arm', () => {
    expect(d.hang10).toBeGreaterThan(0.5);
    expect(d.hang10).toBeLessThan(0.7);
    expect(d.hang20).toBeGreaterThan(0.8);
    expect(d.hang20).toBeLessThan(1.0);
  });
  it('the defense flows without bunching: no more than two defenders at the catch point', () => {
    // At most two within 2 yd of the catch point on a normal completion (round two); allow a rare pile.
    expect(d.crowdOver2).toBeLessThan(0.03);
  });
  it('the pocket: sacks, scrambles and their yards in NFL-like bands', () => {
    // M6 target: sacks ~6–9% of dropbacks.
    expect(d.pocket.sackRate).toBeGreaterThan(0.035);
    expect(d.pocket.sackRate).toBeLessThan(0.1);
    expect(d.pocket.scrambleRate).toBeGreaterThan(0.008);
    expect(d.pocket.scrambleRate).toBeLessThan(0.08);
    expect(d.pocket.scrambleYds).toBeGreaterThan(3);
    expect(d.pocket.scrambleYds).toBeLessThan(14);
  });
  it('pressure comes at about 3 s (median snap to first pressure), on a fifth or so of dropbacks', () => {
    // M6 target ~3.0 s (M5.5 ran ~3.7 s).
    expect(d.pocket.timeToPressure).toBeGreaterThan(2.6);
    expect(d.pocket.timeToPressure).toBeLessThan(3.4);
    expect(d.pocket.pressureRate).toBeGreaterThan(0.12);
  });
}, 180_000);

describe('outcomes: the run game', () => {
  const d = runDistribution(rosters, 8);
  it('yards per carry, stuffs, explosive runs and fumbles in bands', () => {
    // M6 targets: 4.2–4.6 a carry, ~18–20% stuffed, ~11% 10+, 2–3% 20+.
    expect(d.ypc).toBeGreaterThan(3.8);
    expect(d.ypc).toBeLessThan(5.4);
    expect(d.stuff).toBeGreaterThan(0.1);
    expect(d.stuff).toBeLessThan(0.26);
    expect(d.exp10).toBeGreaterThan(0.05);
    expect(d.exp10).toBeLessThan(0.16);
    expect(d.exp20).toBeGreaterThan(0.01);
    expect(d.exp20).toBeLessThan(0.06);
    expect(d.fumbles / d.carries).toBeLessThan(0.035);
  });
  it('the typical carry is a real gain, not boom-or-bust: median ~2–3 yd', () => {
    // M5.5 ran a 1.6-yd median under 5 yd a carry.
    expect(d.median).toBeGreaterThan(1.8);
    expect(d.median).toBeLessThan(3.6);
  });
}, 180_000);

describe('outcomes: big hits are rare', () => {
  it('a few a game: ~3–10% of tackles', () => {
    let tackles = 0;
    let big = 0;
    for (const play of PLAYS) {
      for (const def of DEF_CALLS) {
        for (let k = 0; k < 3; k++) {
          const sd = sidesFor(rosters, play, def);
          const s = createPlay({ seed: 1000 + k * 7919, offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, toGo: 10, user: false });
          runToWhistle(s, () => NEUTRAL);
          for (const e of s.events) {
            if (e.type !== 'hit') continue;
            tackles++;
            if (e.data?.big) big++;
          }
        }
      }
    }
    expect(big / tackles).toBeGreaterThan(0.02);
    expect(big / tackles).toBeLessThan(0.12);
  }, 120_000);
});
