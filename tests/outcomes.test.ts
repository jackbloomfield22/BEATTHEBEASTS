import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, DEF_CALLS, NEUTRAL, PLAYS, practiceRosters, runToWhistle, type SnapshotLike } from '@/sim';
import { passDistribution, runDistribution } from '@/sim/outcomes';

// The shape of the game (feedback items 4–7): the AI-vs-AI harness at Pro
// against the all-time defense, over the whole book and every coverage.
// The bands are wide enough for the sample, tight enough that a change that
// breaks the shape fails here: most of all, the explosive tail (items 6/7).
// The figures and the NFL references are in docs/PROGRESS.md.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

describe('outcomes: the passing game', () => {
  const d = passDistribution(rosters, 8);
  it('keeps the explosive tail: ~10% of completions go 20+, a few percent 40+', () => {
    expect(d.exp20).toBeGreaterThan(0.07);
    expect(d.exp20).toBeLessThan(0.18);
    expect(d.exp40).toBeGreaterThan(0.02);
    expect(d.exp40).toBeLessThan(0.1);
  });
  it('completes a believable share, with yards after the catch from geometry', () => {
    expect(d.cmpPct).toBeGreaterThan(0.58);
    expect(d.cmpPct).toBeLessThan(0.8);
    expect(d.ypa).toBeGreaterThan(5.5);
    expect(d.ypa).toBeLessThan(10);
    expect(d.yacShort).toBeGreaterThan(3.5);
    expect(d.yacShort).toBeLessThan(7);
  });
  it('separation decides the catch: in phase mostly fails, 2+ yd open is nearly automatic', () => {
    expect(d.contestedCatch).toBeLessThan(0.4);
    expect(d.openCatch).toBeGreaterThan(0.88);
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
    expect(d.pocket.sackRate).toBeGreaterThan(0.03);
    expect(d.pocket.sackRate).toBeLessThan(0.12);
    expect(d.pocket.scrambleRate).toBeGreaterThan(0.02);
    expect(d.pocket.scrambleRate).toBeLessThan(0.1);
    expect(d.pocket.scrambleYds).toBeGreaterThan(3);
    expect(d.pocket.scrambleYds).toBeLessThan(12);
  });
}, 120_000);

describe('outcomes: the run game', () => {
  const d = runDistribution(rosters, 8);
  it('yards per carry, stuffs, explosive runs and fumbles in bands', () => {
    expect(d.ypc).toBeGreaterThan(3.4);
    expect(d.ypc).toBeLessThan(5.6);
    expect(d.stuff).toBeGreaterThan(0.12);
    expect(d.stuff).toBeLessThan(0.3);
    expect(d.exp10).toBeGreaterThan(0.06);
    expect(d.exp10).toBeLessThan(0.22);
    expect(d.exp20).toBeGreaterThan(0.01);
    expect(d.exp20).toBeLessThan(0.07);
    expect(d.fumbles / d.carries).toBeLessThan(0.03);
  });
}, 120_000);

describe('outcomes: big hits are rare', () => {
  it('a few a game: ~3–10% of tackles', () => {
    let tackles = 0;
    let big = 0;
    for (const play of PLAYS) {
      for (const def of DEF_CALLS) {
        for (let k = 0; k < 6; k++) {
          const s = createPlay({ seed: 1000 + k * 7919, offense: rosters.offense, defense: rosters.defense, play, def, los: 35, toGo: 10, user: false });
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
