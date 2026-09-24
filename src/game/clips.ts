// Scripted plays for the feel videos (M5.5, tools/shots/video.spec.ts) and
// their tests. Each clip is a seed, a play, a coverage and a script that
// returns the tick's input from the play's state, so Node (where the seeds
// were found: tools/sim/findclips.ts) and the browser (where the video is
// recorded) run the same play to the same whistle.

import { input, type InputFrame, type PlayState } from '@/sim';
import { dist } from '@/sim/vec';

export interface Clip {
  id: 'completion-rac' | 'sack' | 'broken-tackle';
  title: string;
  seed: number;
  play: string;
  def: string;
  los: number;
  script(s: PlayState): InputFrame;
}

/** Nearest free defender to the carrier (yd). */
function nearest(s: PlayState): number {
  const c = s.agents[s.carrier]!;
  let d = Infinity;
  for (const i of s.def) if (!s.agents[i]!.down) d = Math.min(d, dist(s.agents[i]!.pos, c.pos));
  return d;
}

/** Ticks since the snap (scripts time everything from it, so frames spent before the snap don't change the play). */
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));

/** Throw to `icon` `at` ticks after the snap (a tap: touch), call a catch-and-run, then run upfield with a move when a tackler closes. */
export function throwAndRun(icon: number, at: number, move: 'juke' | 'stiffArm' | 'spin', lean = 0.15) {
  return (s: PlayState): InputFrame => {
    const t = since(s);
    if (s.phase === 'air') return input({ catchType: 'rac' });
    if (s.phase === 'carrier') {
      const close = nearest(s) < 2.6;
      return input({ move: { x: 1, y: lean }, sprint: true, juke: move === 'juke' && close, stiffArm: move === 'stiffArm' && close, spin: move === 'spin' && close });
    }
    return input({ snap: s.phase === 'presnap', throwHeld: t >= at && t < at + 4 ? icon : 0 });
  };
}

/** The QB holds the ball and never throws: the rush gets home. */
export function holdIt(s: PlayState): InputFrame {
  return input({ snap: s.phase === 'presnap' });
}

// Seeds found by tools/sim/findclips.ts.
export const CLIPS: Clip[] = [
  // Four Verticals against Cover 3: the slot's seam, caught at ~45 yards, then 18 more after the catch with a juke.
  { id: 'completion-rac', title: 'Completion and run after the catch', seed: 49, play: 'trips-four-verts', def: 'cover3', los: 30, script: throwAndRun(4, 100, 'juke') },
  // The QB holds it: the four-man rush gets home at 4.4 s, the median pocket time at Pro.
  { id: 'sack', title: 'Sack', seed: 4, play: 'trips-four-verts', def: 'cover1', los: 30, script: holdIt },
  // A stiff arm sheds the first tackler and he keeps going for 13 after the catch.
  { id: 'broken-tackle', title: 'Broken tackle', seed: 70, play: 'trips-four-verts', def: 'cover1', los: 30, script: throwAndRun(4, 100, 'stiffArm') },
];
