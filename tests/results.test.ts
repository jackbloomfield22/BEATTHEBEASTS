import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, DEF_CALLS, defenseFor, input, offenseFor, PLAYS, practiceRosters, runToWhistle, type PlayResult, type SnapshotLike } from '@/sim';
import { applyBeastsDrive, applyKick, applyPlay, chooseFourth, chooseTry, createMatch, KICKER_RANGE, type BeastsDrive, type Match, type MatchConfig } from '@/game/match';
import { buildRecord, decodeFrames, encodeFrames, isReadableRecord, RECORD_VERSION, type RecordMeta } from '@/game/record';
import { emptyGameBox, expectedPoints, passerRating, pickPlayOfGame, playImpact, runBlockReps, tallySnap, type PlayLog } from '@/game/stats';

// The game's end (bug: a game could end without its results): every way a
// match ends produces the record the results screen, the Locker Room and
// History draw; and the box score's per-player lines from real sim plays.

const cfg = (over: Partial<MatchConfig> = {}): MatchConfig => ({ drives: 4, seed: 7, beastsRating: 93, diffAdj: 0, kickerRange: KICKER_RANGE.pro, ...over });
const res = (p: Partial<PlayResult>): PlayResult => ({ reason: 'tackle', spot: 0, yards: 0, offenseBall: true, touchdown: false, sack: false, ticks: 300, ...p });
const beasts = (result: BeastsDrive['result'], points = 0): BeastsDrive => ({ result, points, plays: 5, yards: 30, top: '2:30', nextStart: 25 });
const meta = (end: 'final' | 'left' = 'final'): RecordMeta => ({ id: 'g1', finishedAt: 1_700_000_000_000, mode: 'classic', dailyKey: null, difficulty: 'pro', end, offense: [{ slot: 'X', id: 'x', name: 'Receiver X', num: 80, pos: 'WR' }], beasts: [], matchups: [], perfect: null });

/** Your drive: `ypp` a snap to a TD (and the PAT), or punt on 4th down. */
function drive(m: Match, ypp: number): void {
  for (let guard = 0; m.phase === 'drive' || m.phase === 'fourth'; guard++) {
    if (guard > 60) throw new Error('stuck');
    if (m.phase === 'fourth') {
      if (ypp < 5) {
        chooseFourth(m, 'punt');
        return;
      }
      chooseFourth(m, 'go');
    }
    const spot = Math.min(100, m.sit.los + ypp);
    applyPlay(m, res({ spot, yards: ypp, touchdown: spot >= 100, reason: spot >= 100 ? 'touchdown' : 'tackle' }), 0, 5);
  }
  if (m.phase === 'try') {
    chooseTry(m, false);
    applyKick(m, true);
  }
}

describe('the game always ends on a record', () => {
  it('regulation: the last round ends it, graded on the margin', () => {
    const m = createMatch(cfg());
    for (let r = 0; r < 4; r++) {
      applyBeastsDrive(m, beasts('Punt'));
      drive(m, r === 3 ? 25 : 2); // punts, then a touchdown on the last drive
    }
    expect(m.phase).toBe('final');
    const rec = buildRecord(m, emptyGameBox('QB'), meta(), [], null);
    expect(rec.end).toBe('final');
    expect(rec.score).toEqual({ user: 7, beasts: 0 });
    expect(rec.grade?.grade).toBe('A'); // 4-drive table: 5+ is an A
    expect(rec.clock).toBe('FINAL');
    expect(rec.userDrives.map((d) => d.result)).toEqual(['Punt', 'Punt', 'Punt', 'TD']);
    expect(rec.beastsDrives).toHaveLength(4);
    expect(isReadableRecord(JSON.parse(JSON.stringify(rec)))).toBe(true);
  });

  it('overtime: tied after regulation, it ends when a pair of possessions leaves someone ahead', () => {
    const m = createMatch(cfg());
    for (let r = 0; r < 4; r++) {
      applyBeastsDrive(m, beasts('Punt'));
      drive(m, 2);
    }
    expect(m.phase).toBe('meanwhile');
    expect(m.ot).toBe(1);
    applyBeastsDrive(m, { ...beasts('FG', 3), nextStart: 75 });
    drive(m, 25);
    expect(m.phase).toBe('final');
    const rec = buildRecord(m, emptyGameBox('QB'), meta(), [], null);
    expect(rec.ot).toBe(1);
    expect(rec.clock).toBe('FINAL/OT');
    expect(rec.score).toEqual({ user: 7, beasts: 3 });
    expect(rec.grade).not.toBeNull();
  });

  it('the two-minute drill: the clock running out on a snap ends it', () => {
    const m = createMatch(cfg());
    for (let r = 0; r < 3; r++) {
      applyBeastsDrive(m, beasts('Punt'));
      drive(m, 2);
    }
    applyBeastsDrive(m, beasts('TD', 7));
    expect(m.clock.live).toBe(true);
    expect(m.clock.secs).toBe(120);
    let out = '';
    for (let k = 0; k < 20 && m.phase !== 'final'; k++) {
      // Short gains in bounds, the clock running between snaps (35 s of play clock) and during them (6 s).
      out = applyPlay(m, res({ spot: m.sit.los + 4, reason: 'tackle' }), 0, 6, 35).kind;
      if (m.phase === 'fourth') chooseFourth(m, 'go');
    }
    expect(out).toBe('timeExpired');
    expect(m.phase).toBe('final');
    const rec = buildRecord(m, emptyGameBox('QB'), meta(), [], null);
    expect(rec.userDrives.at(-1)!.result).toBe('EndOfGame');
    expect(rec.score).toEqual({ user: 0, beasts: 7 });
    expect(rec.grade?.grade).toBe('L-');
  });

  it('leaving from the pause menu: the game as it stood, ungraded, its open drive on the chart', () => {
    const m = createMatch(cfg());
    applyBeastsDrive(m, beasts('Punt'));
    applyPlay(m, res({ spot: m.sit.los + 6 }), 0, 5);
    const rec = buildRecord(m, emptyGameBox('QB'), meta('left'), [], null);
    expect(rec.end).toBe('left');
    expect(rec.grade).toBeNull();
    expect(rec.clock).toMatch(/^Q1 /);
    expect(rec.userDrives).toHaveLength(1);
    expect(rec.userDrives[0]!.result).toBe('EndOfGame');
  });

  it('leaving after the final whistle is still a final', () => {
    const m = createMatch(cfg());
    for (let r = 0; r < 4; r++) {
      applyBeastsDrive(m, beasts('Punt'));
      drive(m, r === 0 ? 25 : 2);
    }
    const rec = buildRecord(m, emptyGameBox('QB'), meta('final'), [], null);
    expect(rec.end).toBe('final');
    expect(rec.v).toBe(RECORD_VERSION);
  });
});

describe('box score', () => {
  it('passer rating: the NFL formula, each part clamped to 0..2.375', () => {
    // A perfect game: 158.3.
    expect(passerRating({ cmp: 20, att: 20, yds: 500, td: 6, int: 0 })).toBeCloseTo(158.33, 1);
    // 20/30, 250 yd, 2 TD, 1 INT: (1.8333 + 1.3333 + 1.3333 + 1.5417) / 6 × 100 = 100.7.
    expect(passerRating({ cmp: 20, att: 30, yds: 250, td: 2, int: 1 })).toBeCloseTo(100.69, 1);
    // The floor: every part at 0 reads 0 (a 0-for with picks), and no attempts reads 0.
    expect(passerRating({ cmp: 0, att: 4, yds: 0, td: 0, int: 2 })).toBe(0);
    expect(passerRating({ cmp: 0, att: 0, yds: 0, td: 0, int: 0 })).toBe(0);
  });

  it('per-player lines from real snaps add up', () => {
    const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
    const R = practiceRosters(snap);
    const box = emptyGameBox(R.offense.QB.name);
    let runs = 0;
    let reps = 0;
    for (const play of PLAYS) {
      for (const [k, def] of DEF_CALLS.entries()) {
        if (k % 3) continue;
        const s = createPlay({ seed: 17 + k, offense: offenseFor(play, R.team), defense: defenseFor(def, R.beasts), play, def, los: 30, toGo: 10, user: false });
        runToWhistle(s, () => input({}));
        if (!s.result) continue;
        if (play.run) {
          runs++;
          reps += runBlockReps(s).length;
        }
        tallySnap(box, s, s.result, { los: 30, ballY: 0, down: 1, toGo: 10 }, R.offense.QB.name);
      }
    }
    const sum = <T>(o: Record<string, T>, f: (x: T) => number) => Object.values(o).reduce((a, x) => a + f(x), 0);
    expect(box.plays).toBeGreaterThan(40);
    expect(sum(box.rec, (r) => r.tgt)).toBe(box.pass.att);
    expect(sum(box.rec, (r) => r.rec)).toBe(box.pass.cmp);
    expect(Math.round(sum(box.rec, (r) => r.yds))).toBe(Math.round(box.pass.yds));
    expect(box.plays).toBe(box.pass.att + box.pass.sacks + sum(box.rush, (r) => r.car));
    for (const r of Object.values(box.rec)) {
      expect(r.contestedWon).toBeLessThanOrEqual(r.contested);
      expect(r.yac).toBeLessThanOrEqual(Math.max(0, r.yds) + r.rec * 3 + 1e-6); // after the catch can't much exceed the gain (a catch behind the line)
    }
    // The line: every designed run has blocking reps, and they're in the O-line lines.
    expect(runs).toBeGreaterThan(5);
    expect(reps).toBeGreaterThan(runs * 3);
    expect(sum(box.ol, (l) => l.runReps)).toBeGreaterThan(runs * 3);
    expect(sum(box.ol, (l) => l.runWins)).toBeLessThanOrEqual(sum(box.ol, (l) => l.runReps));
    // Sacks allowed: each sack is on a blocker or a free rusher; each sack is a pressure.
    expect(sum(box.ol, (l) => l.sacks) + box.freeRushers.sacks).toBe(box.pass.sacks);
    expect(sum(box.def, (d) => d.sacks)).toBe(box.pass.sacks);
    expect(sum(box.def, (d) => d.pressures)).toBeGreaterThanOrEqual(box.pass.sacks);
    expect(sum(box.def, (d) => d.pressures)).toBe(sum(box.ol, (l) => l.pressures + l.sacks) + box.freeRushers.pressures + box.freeRushers.sacks - box.pass.sacks);
    // The Beasts made the tackles.
    expect(sum(box.def, (d) => d.tackles)).toBeGreaterThan(box.plays / 2);
    expect(sum(box.def, (d) => d.ints)).toBe(box.pass.int);
  });
});

describe('the play of the game', () => {
  const p = (o: Partial<PlayLog>): PlayLog => ({ drive: 0, n: 1, round: 1, ot: 0, down: 1, toGo: 10, los: 25, playId: 'x', playName: 'X', headline: '', detail: '', yards: 0, touchdown: false, turnover: false, pickSix: false, score: { user: 0, beasts: 0 }, late: false, ...o });
  it('a touchdown beats a turnover beats a long gain; late and close beats early', () => {
    const gain = p({ yards: 30 });
    const pick = p({ turnover: true, yards: 0, los: 40 });
    const td = p({ touchdown: true, yards: 20, los: 80 });
    expect(pickPlayOfGame([gain, pick, td])).toBe(2);
    expect(pickPlayOfGame([gain, pick])).toBe(1);
    expect(pickPlayOfGame([p({ yards: 5 }), gain])).toBe(1);
    // The same score, late in a close game, beats the early one.
    const early = p({ touchdown: true, yards: 10, los: 90 });
    const late = p({ touchdown: true, yards: 10, los: 90, late: true, score: { user: 14, beasts: 17 } });
    expect(pickPlayOfGame([early, late])).toBe(1);
    // Ties go to the earlier snap; no snaps, no play.
    expect(pickPlayOfGame([early, { ...early }])).toBe(0);
    expect(pickPlayOfGame([])).toBe(-1);
    expect(playImpact(td)).toBeCloseTo(7 - expectedPoints(80));
  });

  it('input frames survive the run-length encoding', () => {
    const frames = [input({ snap: true }), input({}), input({}), input({}), input({ throwHeld: 2 }), input({})];
    const enc = encodeFrames(frames);
    expect(enc.map(([n]) => n)).toEqual([1, 3, 1, 1]);
    expect(decodeFrames(JSON.parse(JSON.stringify(enc)))).toEqual(JSON.parse(JSON.stringify(frames)));
  });
});
