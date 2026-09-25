import { describe, expect, it } from 'vitest';
import { applyBeastsDrive, applyKick, applyPlay, beastsPossession, chooseFourth, chooseTry, clockLabel, createMatch, fgMakePct, KICKER_RANGE, legacyScale, matchGrade, spikeOrKneel, type Match, type MatchConfig } from '@/game/match';
import type { PlayResult } from '@/sim';

const cfg = (over: Partial<MatchConfig> = {}): MatchConfig => ({ drives: 10, seed: 1, beastsRating: 93, diffAdj: 0, kickerRange: KICKER_RANGE.pro, ...over });

const res = (p: Partial<PlayResult>): PlayResult => ({ reason: 'tackle', spot: 0, yards: 0, offenseBall: true, touchdown: false, sack: false, ticks: 300, ...p });

/** Play a whole drive the lazy way: gain `ypp` a snap until a TD or downs. */
function driveOut(m: Match, ypp: number): void {
  let guard = 0;
  while (m.phase === 'drive' || m.phase === 'fourth') {
    if (guard++ > 60) throw new Error('stuck');
    if (m.phase === 'fourth') chooseFourth(m, 'go');
    const spot = Math.min(100, m.sit.los + ypp);
    applyPlay(m, res({ spot, yards: ypp, touchdown: spot >= 100, reason: spot >= 100 ? 'touchdown' : 'tackle' }), 0, 5);
  }
  if (m.phase === 'try') {
    chooseTry(m, false);
    applyKick(m, true);
  }
}

describe('match (GDD §7)', () => {
  it('the Beasts score what legacy would over a game, scaled to its length', () => {
    // Legacy: 19.5 + (effRating − 80)·0.53 over 10 drives, plus the answer-back.
    for (const drives of [4, 6, 10] as const) {
      let total = 0;
      const N = 400;
      for (let seed = 1; seed <= N; seed++) {
        const m = createMatch(cfg({ drives, seed }));
        while (m.phase !== 'final') {
          if (m.phase === 'meanwhile') applyBeastsDrive(m, beastsPossession(m));
          else driveOut(m, 2); // a stalled offense: 2 yd a snap (8 per series) never scores
          if (m.ot) break;
        }
        total += m.score.beasts;
      }
      const eff = legacyScale(93);
      const expect10 = 19.5 + (eff - 80) * 0.53;
      expect(total / N).toBeGreaterThan(((expect10 - 2.5) * drives) / 10);
      expect(total / N).toBeLessThan(((expect10 + 2.5) * drives) / 10);
    }
  });

  it('answer-back: a high-scoring offense faces more Beasts points (legacy shootout term)', () => {
    let quiet = 0;
    let loud = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const ypp of [2, 40]) {
        const m = createMatch(cfg({ seed }));
        while (m.phase !== 'final' && !m.ot) {
          if (m.phase === 'meanwhile') applyBeastsDrive(m, beastsPossession(m));
          else driveOut(m, ypp);
        }
        if (ypp === 2) quiet += m.score.beasts;
        else loud += m.score.beasts;
      }
    }
    expect(loud / 200).toBeGreaterThan(quiet / 200 + 8);
  });

  it('same seed, same Beasts', () => {
    const run = () => {
      const m = createMatch(cfg({ seed: 42, drives: 6 }));
      const out: string[] = [];
      while (m.phase !== 'final' && !m.ot) {
        if (m.phase === 'meanwhile') {
          const d = beastsPossession(m);
          out.push(`${d.result}${d.points}`);
          applyBeastsDrive(m, d);
        } else driveOut(m, 7);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('downs: first downs, 4th-down decisions, turnover on downs, drives from the 25', () => {
    const m = createMatch(cfg());
    applyBeastsDrive(m, { result: 'TD', points: 7, plays: 8, yards: 75, top: '4:10', nextStart: 25 });
    expect(m.sit).toMatchObject({ los: 25, down: 1, toGo: 10 });
    applyPlay(m, res({ spot: 29 }), 0, 5);
    expect(m.sit).toMatchObject({ los: 29, down: 2, toGo: 6 });
    applyPlay(m, res({ reason: 'incomplete', spot: 29 }), 0, 3);
    applyPlay(m, res({ spot: 31 }), 0, 5);
    expect(m.phase).toBe('fourth');
    chooseFourth(m, 'go');
    applyPlay(m, res({ spot: 36 }), 0, 5);
    expect(m.sit).toMatchObject({ los: 36, down: 1, toGo: 10 });
    for (let i = 0; i < 3; i++) applyPlay(m, res({ reason: 'incomplete', spot: 36 }), 0, 3);
    chooseFourth(m, 'go');
    applyPlay(m, res({ reason: 'incomplete', spot: 36 }), 0, 3);
    expect(m.userDrives[0]!.result).toBe('Downs');
    expect(m.phase).toBe('meanwhile');
    expect(m.round).toBe(2);
  });

  it('scoring: TD then PAT or two, field goals by distance, safeties and pick-sixes', () => {
    const m = createMatch(cfg());
    applyBeastsDrive(m, { result: 'Punt', points: 0, plays: 4, yards: 12, top: '2:00', nextStart: 25 });
    applyPlay(m, res({ spot: 100, touchdown: true, reason: 'touchdown' }), 0, 9);
    expect(m.score.user).toBe(6);
    expect(m.phase).toBe('try');
    chooseTry(m, true);
    expect(m.sit.los).toBe(97);
    applyPlay(m, res({ spot: 100, touchdown: true, reason: 'touchdown' }), 0, 4);
    expect(m.score.user).toBe(8);
    // A field goal from the opponent's 20: a 37-yarder.
    applyBeastsDrive(m, { result: 'Punt', points: 0, plays: 4, yards: 12, top: '2:00', nextStart: 80 });
    for (let i = 0; i < 3; i++) applyPlay(m, res({ reason: 'incomplete', spot: 80 }), 0, 3);
    chooseFourth(m, 'fg');
    expect(m.kick).toEqual({ kind: 'FG', distance: 37 });
    applyKick(m, true);
    expect(m.score.user).toBe(11);
    // Safety: the Beasts get two and the drive is over.
    applyBeastsDrive(m, { result: 'Punt', points: 0, plays: 4, yards: 12, top: '2:00', nextStart: 3 });
    applyPlay(m, res({ spot: -1, reason: 'safety' }), 0, 4);
    expect(m.score.beasts).toBe(2);
    // Pick-six: seven for the Beasts.
    applyBeastsDrive(m, { result: 'Punt', points: 0, plays: 4, yards: 12, top: '2:00', nextStart: 25 });
    applyPlay(m, res({ spot: 0, offenseBall: false, touchdown: true, reason: 'touchdown' }), 0, 7);
    expect(m.score.beasts).toBe(9);
  });

  it('field-goal odds fall with distance and die past the kicker’s range', () => {
    const m = createMatch(cfg());
    m.wind = { mph: 0, dir: 0 };
    expect(fgMakePct(m, 25)).toBeGreaterThan(0.95);
    expect(fgMakePct(m, 45)).toBeLessThan(fgMakePct(m, 35));
    expect(fgMakePct(m, KICKER_RANGE.pro + 1)).toBe(0);
    m.wind = { mph: 12, dir: Math.PI }; // straight into his face
    expect(fgMakePct(m, 54)).toBe(0);
  });

  it('two-minute drill on the last drive when trailing: live clock, stops, timeouts, spike', () => {
    const m = createMatch(cfg({ drives: 4 }));
    for (let r = 0; r < 3; r++) {
      applyBeastsDrive(m, { result: 'TD', points: 7, plays: 8, yards: 75, top: '4:00', nextStart: 25 });
      driveOut(m, 3);
    }
    applyBeastsDrive(m, { result: 'Punt', points: 0, plays: 4, yards: 12, top: '2:00', nextStart: 25 });
    expect(m.round).toBe(4);
    expect(m.clock).toMatchObject({ live: true, secs: 120, timeouts: 3 });
    expect(clockLabel(m)).toBe('Q4 2:00');
    applyPlay(m, res({ spot: 33 }), 0, 6);
    expect(m.clock.secs).toBe(114);
    applyPlay(m, res({ spot: 40 }), 0, 5, 20); // 20 s of running clock before the snap
    expect(m.clock.secs).toBe(89);
    spikeOrKneel(m, 'spike', 8);
    expect(m.clock.secs).toBe(78);
    applyPlay(m, res({ reason: 'incomplete', spot: 40 }), 0, 4, 30); // clock was stopped: the 30 s don't count
    expect(m.clock.secs).toBe(74);
  });

  it('overtime: tied after regulation, one possession each from the 25, until someone leads', () => {
    const m = createMatch(cfg({ drives: 4 }));
    for (let r = 0; r < 4; r++) {
      applyBeastsDrive(m, { result: 'TD', points: 7, plays: 8, yards: 75, top: '4:00', nextStart: 25 });
      driveOut(m, 25);
    }
    expect(m.score.user).toBe(m.score.beasts);
    expect(m.ot).toBe(1);
    applyBeastsDrive(m, { ...beastsPossession(m), result: 'FG', points: 3 });
    expect(m.sit.los).toBe(75);
    driveOut(m, 30);
    expect(m.phase).toBe('final');
    expect(m.score.user).toBeGreaterThan(m.score.beasts);
    expect(clockLabel(m)).toBe('FINAL/OT');
  });

  it('grades on legacy thresholds scaled to game length', () => {
    expect(matchGrade(21, 10).grade).toBe('A+');
    expect(matchGrade(13, 6).grade).toBe('A+');
    expect(matchGrade(12, 6).grade).toBe('A');
    expect(matchGrade(1, 4).grade).toBe('C');
    expect(matchGrade(-4, 4).grade).toBe('L');
    expect(matchGrade(-5, 4).grade).toBe('L-');
  });
});
