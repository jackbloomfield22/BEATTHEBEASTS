// The offensive coordinator in your ear (GDD §10.1 "Suggested"): five plays
// for the down, distance, field position and clock, each with the reason in
// a coach's words. Rules of thumb from the situational tendencies every
// staff charts (short yardage runs and quick game; long yardage drop-backs
// to the sticks and screens; play action on early downs; the red zone's
// quick game and fades; the two-minute drill's sideline passing).

import { PLAYS, type OffPlay, type PlayType } from '@/sim';
import type { Situation } from './situation';

export interface Suggestion {
  play: OffPlay;
  why: string;
}

export function suggestPlays(sit: Situation, opts: { twoMinute?: boolean; clockRunning?: boolean } = {}): Suggestion[] {
  const { down, toGo, los } = sit;
  const red = los >= 80;
  const goal = los + toGo >= 100;
  let plan: [PlayType, string][];
  if (opts.twoMinute) {
    plan = [
      ['quick', 'Get out of bounds or get the first down: the quick game to the sideline.'],
      ['dropback', 'Intermediate outs and digs: chunk yards with the clock in mind.'],
      ['shot', 'They are playing deep halves late; take one shot if the safeties cheat.'],
      ['screen', 'Against the rush they bring in the two-minute drill.'],
    ];
    if (!opts.clockRunning) plan.push(['run', 'Clock stopped: a run can catch the dime package light.']);
  } else if (goal && toGo <= 3) {
    plan = [
      ['run', 'Goal to go: downhill, behind your best blocker.'],
      ['playAction', 'Sell the run they expect and throw it behind the linebackers.'],
      ['quick', 'A quick fade or slant before the rush arrives.'],
    ];
  } else if (toGo <= 2) {
    plan = [
      ['run', `${ord(down)} and short: move the chains on the ground.`],
      ['quick', 'A quick slant or flat: the ball out before the rush gets home.'],
      ['playAction', 'They will crowd the box: fake it and hit behind them.'],
    ];
  } else if (red) {
    plan = [
      ['quick', 'Red zone: space shrinks, throw on rhythm.'],
      ['playAction', 'Hold the linebackers with a fake and find the back of the end zone.'],
      ['run', 'Keep them honest inside the 20.'],
      ['dropback', 'Flood a side of the end zone.'],
    ];
  } else if (down >= 3 && toGo >= 7) {
    plan = [
      ['dropback', `${ord(down)} and ${toGo}: routes past the sticks, not short of them.`],
      ['shot', 'They will play it soft over the top: go take it if they sit.'],
      ['screen', 'Let the rush come and throw it over them.'],
    ];
  } else if (down >= 3) {
    plan = [
      ['quick', `${ord(down)} and ${toGo}: the quick game to the marker.`],
      ['dropback', 'Option routes that break at the sticks.'],
      ['run', 'A draw against the pass rush they will send.'],
    ];
  } else if (down === 1) {
    plan = [
      ['run', 'First down: stay ahead of the chains.'],
      ['playAction', 'First down is play-action down: the safeties bite.'],
      ['quick', 'An easy completion to set up second and short.'],
      ['shot', 'Early down, favorable count: a shot if you have the matchup.'],
    ];
  } else {
    plan = toGo >= 8
      ? [
          ['dropback', `Second and ${toGo}: get half of it back and more.`],
          ['screen', 'Slow them down with a screen.'],
          ['quick', 'Take the easy yards and make third down manageable.'],
        ]
      : [
          ['run', `Second and ${toGo}: a run keeps the whole book open on third.`],
          ['playAction', 'They expect the run here too.'],
          ['quick', 'Stay on schedule.'],
        ];
  }
  // Two plays from the first idea, one each from the others, rotated by the spot so it doesn't repeat itself.
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const byType = (t: PlayType) => PLAYS.filter((p) => p.type === t);
  for (let pass = 0; pass < 2 && out.length < 5; pass++) {
    plan.forEach(([t, why], k) => {
      if (out.length >= 5 || (pass === 1 && k > 1)) return;
      const list = byType(t);
      if (!list.length) return;
      for (let j = 0; j < list.length; j++) {
        const p = list[(los + down * 3 + pass + j) % list.length]!;
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push({ play: p, why });
        return;
      }
    });
  }
  return out;
}

const ord = (n: number) => ['1st', '2nd', '3rd', '4th'][n - 1] ?? `${n}th`;
