// Scripted plays for the feel videos (M5.5, tools/shots/video.spec.ts) and
// their tests. Each clip is a seed, a play, a coverage and a script that
// returns the tick's input from the play's state, so Node (where the seeds
// were found: tools/sim/findclips.ts) and the browser (where the video is
// recorded) run the same play to the same whistle.

import { input, type InputFrame, type PlayState } from '@/sim';
import { dist } from '@/sim/vec';

export interface Clip {
  id: 'completion-rac' | 'sack' | 'broken-tackle' | 'cut-run';
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
      return input({ move: { x: 1, y: lean }, juke: move === 'juke' && close, stiffArm: move === 'stiffArm' && close, spin: move === 'spin' && close });
    }
    return input({ snap: s.phase === 'presnap', throwHeld: t >= at && t < at + 4 ? icon : 0 });
  };
}

/**
 * A designed run the player steers (M6.5 #11's captures): the arrows press
 * the hole (toward the play's aim a yard and a half past the line), then
 * `cutPast` yd past the line a hard cut straight across toward `cutY` (90°,
 * the sim's planted cut), and there a lighter one back up the field on the
 * diagonal (45°). Pure in the state, so Node and the browser run the same play.
 */
export function runAndCut(cutPast: number, cutY: number) {
  const dir = cutY >= 0 ? 1 : -1;
  return (s: PlayState): InputFrame => {
    if (s.phase === 'presnap') return input({ snap: true });
    if (s.phase !== 'carrier' || s.carrier < 0) return input({});
    const c = s.agents[s.carrier]!;
    const past = c.pos.x - s.setup.los;
    if (past < cutPast) {
      const hx = s.setup.los + 1.5 - c.pos.x;
      const hy = (s.setup.ballY ?? 0) + (s.setup.play.run?.aim ?? 0) - c.pos.y;
      const k = Math.hypot(hx, hy);
      return input({ move: past < 1.5 && k > 0.5 ? { x: hx / k, y: hy / k } : { x: 1, y: 0 } });
    }
    if ((c.pos.y - cutY) * dir < 0 && past < cutPast + 1.5) return input({ move: { x: 0, y: dir } });
    return input({ move: { x: Math.SQRT1_2, y: dir * Math.SQRT1_2 } });
  };
}

/** The QB holds the ball and never throws: the rush gets home. */
export function holdIt(s: PlayState): InputFrame {
  return input({ snap: s.phase === 'presnap' });
}

// Seeds found by tools/sim/findclips.ts (re-found for M6's sim).
export const CLIPS: Clip[] = [
  // Stick against Cover 2: the driven ball to the stick, caught in stride, then 13 more after the catch with a juke (re-found as the M6.5 sim changed: seed 42).
  { id: 'completion-rac', title: 'Completion and run after the catch', seed: 42, play: 'trips-stick', def: 'cover2', los: 30, script: throwAndRun(2, 84, 'juke') },
  // The QB holds it: the four-man rush gets home at 3.8 s, the median no-throw pocket at Pro.
  { id: 'sack', title: 'Sack', seed: 6, play: 'trips-four-verts', def: 'cover1', los: 30, script: holdIt },
  // A stiff arm sheds the first tackler and he takes it the distance (36 after the catch; re-found for M6.5: the slot against Cover 2, seed 71).
  { id: 'broken-tackle', title: 'Broken tackle', seed: 71, play: 'trips-four-verts', def: 'cover2', los: 30, script: throwAndRun(2, 100, 'stiffArm') },
  // M6.5 #11: inside zone steered by the arrows, a 102° plant-and-cut across and a 45° one back upfield, a burst, and a tackler closing (tools/sim/findcarry.ts: 11.8 yd).
  { id: 'cut-run', title: 'Cut and burst on a designed run', seed: 17, play: 'singleback-inside-zone', def: 'cover2', los: 30, script: runAndCut(1.5, 3.5) },
];
