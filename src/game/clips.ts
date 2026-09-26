// Scripted plays for the feel videos (M5.5, tools/shots/video.spec.ts) and
// their tests. Each clip is a seed, a play, a coverage and a script that
// returns the tick's input from the play's state, so Node (where the seeds
// were found: tools/sim/findclips.ts) and the browser (where the video is
// recorded) run the same play to the same whistle.

import { input, type CatchType, type InputFrame, type PlayState } from '@/sim';
import { dist, type V2 } from '@/sim/vec';

export interface Clip {
  id: string;
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

/** A broadcast concept's script (M6.5 videos): the throw, the call, and the run after it. */
export interface ConceptPlan {
  /** Receiver icon (1–5) and the tick after the snap the throw goes (a tap unless `hold`). */
  icon: number;
  at: number;
  /** Ticks the key is held (touch; a tap is the driven ball). */
  hold?: number;
  /** Placement (x: back shoulder −1 .. lead +1, y: low .. high). */
  aim?: V2;
  /** The catch call. */
  call?: CatchType;
  /** The QB scrambles: the tick he takes off and the way he runs until the throw. */
  scramble?: { at: number; dir: V2 };
}

/**
 * A concept played the way a player would: the throw on time, the catch
 * call, then upfield, and one planted cut (the arrows, M6.5 #10) away from
 * the first tackler to close within 4 yd, back upfield 0.35 s later.
 */
export function concept(p: ConceptPlan) {
  // The cut's moment and side, per play (the script keeps its own notes; it never writes to the sim).
  const notes = new WeakMap<PlayState, { at: number; side: number }>();
  return (s: PlayState): InputFrame => {
    const t = since(s);
    if (s.phase === 'air') return input({ catchType: p.call ?? 'rac' });
    if (s.phase === 'carrier') {
      const c = s.agents[s.carrier]!;
      let cut = notes.get(s);
      if (!cut) {
        for (const i of s.def) {
          const d = s.agents[i]!;
          if (!d.down && dist(d.pos, c.pos) < 4 && d.pos.x > c.pos.x - 1) {
            cut = { at: s.t, side: d.pos.y > c.pos.y ? -1 : 1 };
            notes.set(s, cut);
            break;
          }
        }
      }
      const cutting = cut !== undefined && s.t - cut.at < 0.35;
      return input({ move: cutting ? { x: 0.35, y: cut!.side } : { x: 1, y: 0 } });
    }
    const scrambling = p.scramble && t >= p.scramble.at;
    return input({
      snap: s.phase === 'presnap',
      scramble: !!p.scramble && t === p.scramble.at,
      move: scrambling ? p.scramble!.dir : { x: 0, y: 0 },
      throwHeld: t >= p.at && t < p.at + (p.hold ?? 4) ? p.icon : 0,
      aim: p.aim ?? { x: 0, y: 0 },
    });
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
];
