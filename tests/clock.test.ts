import { describe, expect, it } from 'vitest';
import {
  applyBeastsDrive,
  applyKick,
  applyPlay,
  applyPunt,
  beastsGameTotal,
  beastsPossession,
  callTimeout,
  canVictoryFormation,
  chooseFourth,
  chooseTry,
  clockLabel,
  createMatch,
  DAILY_QUARTER_MIN,
  gradeRounds,
  hurry,
  KICKER_RANGE,
  legacyScale,
  quarterSecsFor,
  readyForPlay,
  resolvePunt,
  SIDELINE,
  snapped,
  spikeOrKneel,
  tickClock,
  type BeastsDrive,
  type Match,
  type MatchConfig,
} from '@/game/match';
import { puntFlight } from '@/game/kick';
import type { PlayResult } from '@/sim';

// M6.6: a real game clock (Playtest 1, decision 1). Four quarters, a clock
// that runs on plays and stops by the rules, the 40-second play clock and
// delay of game, halftime, the Beasts' possessions eating the clock.

const Q = 300; // the default 5-minute quarter
const cfg = (over: Partial<MatchConfig> = {}): MatchConfig => ({ drives: 6, quarterSecs: Q, seed: 3, beastsRating: 93, diffAdj: 0, kickerRange: KICKER_RANGE.pro, ...over });
const res = (p: Partial<PlayResult>): PlayResult => ({ reason: 'tackle', spot: 0, yards: 0, offenseBall: true, touchdown: false, sack: false, ticks: 300, ...p });
const punt = (points = 0, secs = 120): BeastsDrive => ({ result: points ? 'TD' : 'Punt', points, plays: 5, yards: 30, top: '2:00', secs, nextStart: 25 });

/** A timed match with your ball: the Beasts' first drive took `secs`. */
function onOffense(secs = 120, over: Partial<MatchConfig> = {}): Match {
  const m = createMatch(cfg(over));
  applyBeastsDrive(m, punt(0, secs));
  return m;
}

/** A snap: the call comes up, `wait` seconds pass on the play clock, the ball is snapped, the play runs `secs`. */
function play(m: Match, r: Partial<PlayResult>, secs = 5, wait = 0) {
  readyForPlay(m);
  for (let i = 0; i < wait; i++) tickClock(m);
  snapped(m);
  return applyPlay(m, res({ spot: m.sit.los + 3, ...r }), 0, secs);
}

describe('game clock (M6.6)', () => {
  it('four quarters of the chosen length; the Beasts’ possession takes its time off the clock', () => {
    const m = createMatch(cfg());
    expect(m.clock).toMatchObject({ quarter: 1, secs: Q });
    expect(clockLabel(m)).toBe('Q1 5:00');
    const d = beastsPossession(m);
    expect(d.secs).toBeGreaterThan(0);
    // Their pace: 17–25 s a snap.
    expect(d.secs! / d.plays).toBeGreaterThanOrEqual(17);
    expect(d.secs! / d.plays).toBeLessThanOrEqual(25.5);
    applyBeastsDrive(m, d);
    expect(m.clock.secs + (m.clock.quarter - 1) * Q).toBe(Q - d.secs!);
    expect(m.clock.live).toBe(true);
  });

  it('the play clock: 40 after a play, the huddle takes it to 25, a running clock loses those 15 s', () => {
    const m = onOffense();
    const t0 = m.clock.secs;
    // A change of possession: the clock is stopped, the huddle costs nothing.
    readyForPlay(m);
    expect(m.playClock).toBe(25);
    expect(m.clock.secs).toBe(t0);
    snapped(m);
    applyPlay(m, res({ spot: 29 }), 0, 5.4); // in bounds: 5 s off (rounded), the clock keeps running
    expect(m.clock.secs).toBe(t0 - 5);
    expect(m.lastWhistle).toBe('runs');
    readyForPlay(m);
    expect(m.clock.secs).toBe(t0 - 20);
    expect(m.playClock).toBe(25);
  });

  it('the clock stops on incompletions, scores and turnovers; out of bounds only late in a half', () => {
    const m = onOffense();
    play(m, { reason: 'incomplete' }, 4);
    expect(m.lastWhistle).toBe('stops');
    // Out of bounds in the 1st quarter: restarts on the ready signal (runs).
    play(m, { reason: 'outOfBounds', spot: m.sit.los + 11 }, 4);
    expect(m.lastWhistle).toBe('runs');
    // Late in the 4th: stops.
    m.clock.quarter = 4;
    m.clock.secs = 100;
    play(m, { reason: 'outOfBounds', spot: m.sit.los + 11 }, 4);
    expect(m.lastWhistle).toBe('stops');
    play(m, { reason: 'tackle' }, 4);
    expect(m.lastWhistle).toBe('runs');
  });

  it('play durations come off in whole seconds, and a running clock ticks with the play clock', () => {
    const m = onOffense();
    const t0 = m.clock.secs;
    play(m, { reason: 'tackle' }, 6.6); // 7 s
    expect(m.clock.secs).toBe(t0 - 7);
    readyForPlay(m); // huddle: 15 s
    tickClock(m);
    tickClock(m);
    expect(m.clock.secs).toBe(t0 - 7 - 15 - 2);
    expect(m.playClock).toBe(23);
    snapped(m);
    applyPlay(m, res({ reason: 'incomplete', spot: m.sit.los }), 0, 3);
    readyForPlay(m);
    const t1 = m.clock.secs;
    tickClock(m);
    expect(m.clock.secs).toBe(t1); // stopped: only the play clock runs
    expect(m.playClock).toBe(24);
  });

  it('delay of game: the play clock hits 0, five yards, the down replayed, 25 on the play clock', () => {
    const m = onOffense();
    play(m, { spot: 31 }, 5); // 2nd & 4 at the 31
    readyForPlay(m);
    let ev = null;
    for (let i = 0; i < 25 && !ev; i++) ev = tickClock(m);
    expect(ev).toBe('delayOfGame');
    expect(m.sit).toMatchObject({ los: 26, down: 2, toGo: 9 });
    expect(m.playClock).toBe(25);
    // Inside the 10: half the distance to the goal.
    m.sit = { los: 6, ballY: 0, down: 1, toGo: 10 };
    for (let i = 0; i < 25; i++) tickClock(m);
    expect(m.sit.los).toBe(3);
  });

  it('a timeout stops the clock and resets the play clock to 25', () => {
    const m = onOffense();
    play(m, { spot: 30 }, 5);
    readyForPlay(m);
    for (let i = 0; i < 10; i++) tickClock(m);
    const t = m.clock.secs;
    expect(callTimeout(m)).toBe(true);
    expect(m.clock.timeouts).toBe(2);
    expect(m.playClock).toBe(25);
    tickClock(m);
    expect(m.clock.secs).toBe(t);
  });

  it('the two-minute warning stops the clock at 2:00 in the 2nd and 4th quarters', () => {
    const m = onOffense();
    m.clock.quarter = 2;
    m.clock.secs = 125;
    m.lastWhistle = 'runs';
    readyForPlay(m); // the huddle would take it to 1:50: it stops at 2:00
    expect(m.clock.secs).toBe(120);
    expect(m.event).toBe('twoMinuteWarning');
    expect(m.lastWhistle).toBe('stops');
    expect(m.playClock).toBe(25);
    // Now it's the hurry-up: no huddle, the full play clock after a play.
    expect(hurry(m)).toBe(true);
    snapped(m);
    applyPlay(m, res({ spot: m.sit.los + 4 }), 0, 5);
    readyForPlay(m);
    expect(m.playClock).toBe(40);
    expect(m.clock.secs).toBe(115);
    // A play that runs through 2:00 in the 4th: the warning comes after it.
    const n = onOffense();
    n.clock.quarter = 4;
    n.clock.secs = 123;
    readyForPlay(n);
    snapped(n);
    applyPlay(n, res({ spot: n.sit.los + 4 }), 0, 6);
    expect(n.clock.secs).toBe(117);
    expect(n.event).toBe('twoMinuteWarning');
    expect(n.lastWhistle).toBe('stops');
  });

  it('end of the 1st quarter: the drive carries on in the 2nd, the teams (and the wind) change ends', () => {
    const m = onOffense(Q - 10); // the Beasts leave 0:10 in the 1st
    expect(m.clock).toMatchObject({ quarter: 1, secs: 10 });
    const dir = m.wind.dir;
    play(m, { reason: 'tackle', spot: 28 }, 6);
    readyForPlay(m); // the huddle runs the quarter out
    expect(m.event).toBe('endOfQuarter');
    expect(m.clock).toMatchObject({ quarter: 2, secs: Q });
    expect(m.phase).toBe('drive');
    expect(m.sit).toMatchObject({ los: 28, down: 2 });
    expect(m.playClock).toBe(25);
    expect(Math.abs(m.wind.dir - dir - Math.PI)).toBeLessThan(1e-9);
    expect(m.lastWhistle).toBe('stops');
  });

  it('halftime: the clock runs out in the 2nd, your drive ends, you receive the second half', () => {
    const m = onOffense();
    m.clock.quarter = 2;
    m.clock.secs = 4;
    m.clock.timeouts = 0;
    play(m, { reason: 'tackle', spot: 40 }, 5);
    expect(m.userDrives.at(-1)!.result).toBe('EndOfHalf');
    expect(m.event).toBe('halftime');
    expect(m.clock).toMatchObject({ quarter: 3, secs: Q, timeouts: 3 });
    expect(m.phase).toBe('drive');
    expect(m.sit).toMatchObject({ los: 25, down: 1 });
  });

  it('a touchdown at 0:00 gets its try, then the half ends', () => {
    const m = onOffense();
    m.clock.quarter = 2;
    m.clock.secs = 3;
    m.sit = { los: 90, ballY: 0, down: 1, toGo: 10 };
    play(m, { spot: 100, touchdown: true, reason: 'touchdown' }, 5);
    expect(m.phase).toBe('try');
    chooseTry(m, false);
    applyKick(m, true);
    expect(m.score.user).toBe(7);
    expect(m.byQuarter.user[1]).toBe(7);
    expect(m.clock.quarter).toBe(3);
    expect(m.phase).toBe('drive');
  });

  it('the end of regulation: final when someone leads, overtime when tied', () => {
    const m = onOffense();
    m.clock.quarter = 4;
    m.clock.secs = 2;
    m.score = { user: 3, beasts: 0 };
    play(m, { spot: m.sit.los + 2 }, 4);
    expect(m.phase).toBe('final');
    expect(clockLabel(m)).toBe('FINAL');
    const t = onOffense();
    t.clock.quarter = 4;
    t.clock.secs = 2;
    play(t, { spot: t.sit.los + 2 }, 4);
    expect(t.ot).toBe(1);
    expect(t.phase).toBe('meanwhile');
    // Running out the clock at the line (the play clock never gets snapped) ends it too.
    const k = onOffense();
    k.clock.quarter = 4;
    k.clock.secs = 30;
    k.score = { user: 10, beasts: 7 };
    play(k, { spot: k.sit.los + 2 }, 4);
    readyForPlay(k);
    let ev = null;
    for (let i = 0; i < 40 && k.phase !== 'final'; i++) ev = tickClock(k) ?? ev;
    expect(k.phase).toBe('final');
    expect(ev).toBe('endOfGame');
  });

  it('the Beasts’ drives fit the half: a hurry-up late, the gun mid-drive, a lead kneeled out', () => {
    // Late in the 2nd with a long drive due: whatever it was, it's done by the half.
    for (let seed = 1; seed <= 40; seed++) {
      const m = createMatch(cfg({ seed }));
      m.clock.quarter = 2;
      m.clock.secs = 40;
      const d = beastsPossession(m);
      expect(d.secs).toBeLessThanOrEqual(40);
      applyBeastsDrive(m, d);
      if (d.secs === 40) expect(m.clock.quarter).toBe(3);
    }
    // Ahead in the 4th with less time than their drive: they kneel it out and it's over.
    const m = createMatch(cfg({ seed: 9 }));
    m.clock.quarter = 4;
    m.clock.secs = 30;
    m.score = { user: 7, beasts: 14 };
    const d = beastsPossession(m);
    expect(d.result).toBe('EndOfGame');
    applyBeastsDrive(m, d);
    expect(m.phase).toBe('final');
  });

  it('punts and field-goal tries take time off, and a missed kick gives them the spot', () => {
    const m = onOffense();
    for (let i = 0; i < 3; i++) play(m, { reason: 'incomplete', spot: m.sit.los }, 4);
    expect(m.phase).toBe('fourth');
    const t = m.clock.secs;
    chooseFourth(m, 'punt');
    const p = resolvePunt(m, puntFlight({ power: 0.95, aim: 0, wind: { mph: 0, dir: 0 }, y0: 0, halfWidth: SIDELINE }));
    applyPunt(m, p);
    expect(m.clock.secs).toBeLessThan(t - 4);
    expect(Number.isInteger(p.gross) && Number.isInteger(p.net) && Number.isInteger(p.ret)).toBe(true);
    expect(m.userDrives.at(-1)!.next).toBe(p.beastsStart);
    // A missed 50-yarder from the Beasts' 33: their ball at the spot of the kick (their 40).
    const f = onOffense(120);
    f.sit = { los: 67, ballY: 0, down: 4, toGo: 5 };
    f.phase = 'fourth';
    chooseFourth(f, 'fg');
    applyKick(f, false, 2.8);
    expect(f.userDrives.at(-1)!.next).toBe(40);
  });

  it('victory formation late in the 4th with the lead; kneels and spikes take their seconds', () => {
    const m = onOffense();
    m.clock.quarter = 4;
    m.clock.secs = 100;
    m.score = { user: 10, beasts: 3 };
    expect(canVictoryFormation(m)).toBe(true);
    readyForPlay(m);
    snapped(m);
    spikeOrKneel(m, 'kneel');
    expect(m.clock.secs).toBe(98);
    expect(m.lastWhistle).toBe('runs');
    m.score = { user: 3, beasts: 10 };
    expect(canVictoryFormation(m)).toBe(false);
  });

  it('the Daily plays a fixed quarter, Quick Play the drive count, the rest the setting', () => {
    expect(quarterSecsFor('daily', 12)).toBe(DAILY_QUARTER_MIN * 60);
    expect(quarterSecsFor('daily', 3)).toBe(DAILY_QUARTER_MIN * 60);
    expect(quarterSecsFor('quick', 12)).toBeNull();
    expect(quarterSecsFor('classic', 8)).toBe(480);
    expect(quarterSecsFor('film', 5)).toBe(300);
  });

  it('a whole timed game: whole-second clock, a sensible number of possessions, deterministic', () => {
    const run = (seed: number) => {
      const m = createMatch(cfg({ seed }));
      let guard = 0;
      while (m.phase !== 'final') {
        if (guard++ > 2000) throw new Error('stuck');
        if (m.phase === 'meanwhile') applyBeastsDrive(m, beastsPossession(m));
        else if (m.phase === 'fourth') {
          chooseFourth(m, 'punt');
          applyPunt(m, resolvePunt(m, puntFlight({ power: 0.9, aim: 0, wind: m.wind, y0: 0, halfWidth: SIDELINE })));
        } else if (m.phase === 'try') {
          chooseTry(m, false);
          applyKick(m, true);
        } else if (m.phase === 'kick') applyKick(m, true);
        else if (m.phase === 'drive' || m.phase === 'twoPoint') {
          // A steady offense: 4 yd a snap in bounds, every third pass incomplete, 8 s of play clock used.
          readyForPlay(m);
          for (let i = 0; i < 8 && m.phase === 'drive'; i++) tickClock(m);
          if (m.phase !== 'drive' && m.phase !== 'twoPoint') continue;
          snapped(m);
          const inc = guard % 3 === 0;
          const spot = Math.min(100, m.sit.los + (m.sit.los > 60 ? 9 : 4));
          applyPlay(m, res(inc ? { reason: 'incomplete', spot: m.sit.los } : { spot, touchdown: spot >= 100, reason: spot >= 100 ? 'touchdown' : 'tackle' }), 0, 5.7);
        }
        expect(Number.isInteger(m.clock.secs)).toBe(true);
      }
      return m;
    };
    const a = run(21);
    expect(run(21)).toEqual(a);
    expect(a.beastsDrives.length).toBeGreaterThanOrEqual(3);
    expect(a.beastsDrives.length).toBeLessThanOrEqual(8);
    expect(a.byQuarter.user.reduce((x, y) => x + y, 0)).toBe(a.score.user);
    expect(a.byQuarter.beasts.reduce((x, y) => x + y, 0)).toBe(a.score.beasts);
    expect([4, 6, 10]).toContain(gradeRounds(a));
  });

  it('the Beasts score legacy’s points per possession in a timed game too', () => {
    // Legacy: 19.5 + (effRating − 80)·0.53 over 10 drives; per possession, a tenth of that (no answer-back: you score nothing here).
    let pts = 0;
    let n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const m = createMatch(cfg({ seed }));
      while (m.phase !== 'final' && m.ot === 0) {
        if (m.phase === 'meanwhile') {
          const d = beastsPossession(m);
          applyBeastsDrive(m, d);
          if (d.result !== 'EndOfHalf' && d.result !== 'EndOfGame') {
            pts += d.points;
            n++;
          }
        } else {
          // Your drive: a three-and-out that takes 1:40.
          m.clock.secs = Math.max(0, m.clock.secs - 100);
          m.phase = 'fourth';
          chooseFourth(m, 'punt');
          applyPunt(m, { gross: 40, ret: 0, net: 40, how: 'fairCatch', hang: 4, beastsStart: 25 });
        }
      }
    }
    const expectPer = beastsGameTotal(createMatch(cfg()), 0) / 10;
    const legacyPer = (19.5 + (legacyScale(93) - 80) * 0.53) / 10;
    expect(Math.abs(expectPer - legacyPer)).toBeLessThan(0.6);
    expect(pts / n).toBeGreaterThan(legacyPer - 0.45);
    expect(pts / n).toBeLessThan(legacyPer + 0.45);
  });
});
