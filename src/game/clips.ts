// Scripted plays for the feel videos (M5.5, tools/shots/video.spec.ts) and
// their tests. Each clip is a seed, a play, a coverage and a script that
// returns the tick's input from the play's state, so Node (where the seeds
// were found: tools/sim/findclips.ts) and the browser (where the video is
// recorded) run the same play to the same whistle.

import { findStint, input, NEUTRAL, PERSONNEL, playById, simPlayer, type BeastsDefense, type CatchType, type ContendersRoster, type DefSlot, type InputFrame, type PlayState, type SnapshotLike } from '@/sim';
import { dist, type V2 } from '@/sim/vec';

export interface Clip {
  id: string;
  title: string;
  seed: number;
  play: string;
  def: string;
  los: number;
  script(s: PlayState): InputFrame;
  /** Played by the AI (false) instead of the player (default true): the identity clips watch the men, not the stick. */
  user?: boolean;
  /** One man swapped into the classic line-up (the identity clips). */
  swap?: Swap;
}

/** A player swapped in for a clip: into an offensive slot of the play (QB, RB, X, Z, SLOT, TE) or a Beasts slot. */
export interface Swap {
  off?: 'QB' | 'RB' | 'X' | 'Z' | 'SLOT' | 'TE';
  def?: DefSlot;
  name: string;
  pos: string;
}

/** The line-up with `swap` in (his highest-rated stint at the position, the jersey number of the man he replaces). */
export function withSwap(teams: { team: ContendersRoster; beasts: BeastsDefense }, play: string, swap: Swap, snap: SnapshotLike): { team: ContendersRoster; beasts: BeastsDefense } {
  const e = findStint(snap, swap.name, swap.pos);
  if (!e) throw new Error(`clip swap: ${swap.name} (${swap.pos}) not in the snapshot`);
  const team = { ...teams.team };
  const beasts = { ...teams.beasts, base: { ...teams.beasts.base } };
  if (swap.off) {
    const key = swap.off === 'QB' ? 'QB' : PERSONNEL[playById(play).formation.personnel][swap.off];
    team[key] = simPlayer(e, team[key].num);
  }
  if (swap.def) beasts.base[swap.def] = simPlayer(e, beasts.base[swap.def].num);
  return { team, beasts };
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
  // Four verticals against Cover 2: the slot's seam caught in stride, then 16 more after the catch with a juke (re-found for M6.6's ratings: seed 51).
  { id: 'completion-rac', title: 'Completion and run after the catch', seed: 51, play: 'trips-four-verts', def: 'cover2', los: 30, script: throwAndRun(2, 100, 'juke') },
  // The QB holds it: the four-man rush gets home at 3.8 s, the median no-throw pocket at Pro.
  { id: 'sack', title: 'Sack', seed: 6, play: 'trips-four-verts', def: 'cover1', los: 30, script: holdIt },
  // A stiff arm sheds the first tackler and he takes it the distance (36 after the catch; re-found for M6.5: the slot against Cover 2, seed 71).
  { id: 'broken-tackle', title: 'Broken tackle', seed: 71, play: 'trips-four-verts', def: 'cover2', los: 30, script: throwAndRun(2, 100, 'stiffArm') },
  // M6.5 #11: inside zone steered by the arrows, a 102° plant-and-cut across and a 45° one back upfield, a burst, and a tackler closing (tools/sim/findcarry.ts: 11.8 yd).
  { id: 'cut-run', title: 'Cut and burst on a designed run', seed: 17, play: 'singleback-inside-zone', def: 'cover2', los: 30, script: runAndCut(1.5, 3.5) },
];

// The ten broadcast concepts (M6.5): found by tools/sim/findconcepts.ts, the
// throw on time off the break, open, a real gain. Each note says what it shows.
export const CONCEPTS: Clip[] = [
  // Slants against quarters: the X's slant, the ball on him as he clears the linebacker (12 yd).
  { id: 'slant', title: 'Slant', seed: 1, play: 'doubles-slants', def: 'cover4', los: 30, script: concept({ icon: 1, at: 30 }) },
  // The quick out against man: the break at 5, the ball out on it, the sideline (9 yd).
  { id: 'out', title: 'Quick out', seed: 8, play: 'doubles-quick-outs', def: 'cover1', los: 30, script: concept({ icon: 1, at: 30 }) },
  // Curl against man: settles at 10 facing the QB, SECURE on the catch (10 yd).
  { id: 'curl', title: 'Curl', seed: 5, play: 'doubles-curls', def: 'cover1', los: 30, script: concept({ icon: 1, at: 60, call: 'possession' }) },
  // Four verticals against the fire zone: the blitz comes, the ball goes at 1.5 s, the Z up the sideline over the rotated corner (37 yd; re-found for the identity pass's sim).
  { id: 'go', title: 'Go', seed: 19, play: 'trips-four-verts', def: 'firezone', los: 30, script: concept({ icon: 3, at: 90, hold: 16 }) },
  // Play-action post against man: the fake, the post behind it, the ball led into the middle (27 yd).
  { id: 'post', title: 'Post', seed: 13, play: 'singleback-pa-post', def: 'cover2man', los: 30, script: concept({ icon: 1, at: 80, hold: 10 }) },
  // Snag's corner against man: the Z's corner from the bunch, the ball over the outside shoulder (36 yd).
  { id: 'corner', title: 'Corner', seed: 6, play: 'bunch-snag', def: 'cover2man', los: 30, script: concept({ icon: 3, at: 60, hold: 14 }) },
  // PA crossers against the fire zone: the blitz bites on the fake, the X's deep cross comes open behind it, caught running (14 yd; re-found for the identity pass's sim).
  { id: 'crosser', title: 'Crosser', seed: 10, play: 'ace-pa-crossers', def: 'firezone', los: 30, script: concept({ icon: 1, at: 80 }) },
  // RB screen against man: the back slips out behind the rush, the linemen release in front of him (11 yd).
  // Seed 4 → 60 in M6.6: the added stints (docs/m66/DATA_AUDIT.md) move the practice roster's ratings a point here and there, and seed 4 became a 2.9-yd loss. Seed 60 is the same play, coverage and throw time: 11.6 yd, 2.9 yd of separation.
  { id: 'screen', title: 'Screen', seed: 60, play: 'doubles-rb-screen', def: 'cover2man', los: 30, script: concept({ icon: 1, at: 76 }) },
  // Back shoulder against man: the corner on top of the Z's go, the ball thrown away from him, GO UP (19 yd).
  { id: 'back-shoulder', title: 'Back shoulder', seed: 2, play: 'trips-four-verts', def: 'cover1', los: 30, script: concept({ icon: 3, at: 48, aim: { x: -1, y: -0.2 }, call: 'aggressive' }) },
  // The scramble drill: the QB escapes right, the X breaks off his route and works back across to him (12 yd).
  { id: 'scramble-drill', title: 'Scramble drill', seed: 9, play: 'trips-y-cross', def: 'cover3', los: 30, script: concept({ icon: 4, at: 150, scramble: { at: 110, dir: { x: 0.25, y: 1 } } }) },
];

// The side-by-side identity videos (Playtest 2, "every player is himself"):
// each pair the same play, seed and coverage with one man swapped, found by
// tools/sim/findidentity.ts where the contrast shows on that snap. Filled in
// from its output.
const pair = (id: string, title: string, base: Omit<Clip, 'id' | 'title' | 'swap'>, a: Swap, b: Swap): Clip[] => [
  { ...base, id: `${id}-a`, title: `${title}: ${a.name}`, swap: a },
  { ...base, id: `${id}-b`, title: `${title}: ${b.name}`, swap: b },
];
export const IDENTITY: Clip[] = [
  // Speed: the play-action post against Cover 2. Hill is behind the safety and gone (70 yd); Welker's ball is broken up (sep 2.4 against 1.2 at the catch point).
  ...pair('speed', 'Speed', { seed: 7, play: 'singleback-pa-post', def: 'cover2', los: 30, script: concept({ icon: 1, at: 90, hold: 16 }) }, { off: 'X', name: 'Tyreek Hill', pos: 'WR' }, { off: 'X', name: 'Wes Welker', pos: 'WR' }),
  // Elusive against power: I-form power against Cover 1, the AI carrying. Barry makes the man miss and goes 70; Bettis breaks two and is down at 6.5.
  ...pair('elusive', 'Make a man miss', { seed: 11, play: 'iform-power', def: 'cover1', los: 30, user: false, script: () => NEUTRAL }, { off: 'RB', name: 'Barry Sanders', pos: 'RB' }, { off: 'RB', name: 'Jerome Bettis', pos: 'RB' }),
  // Accuracy: the curl against Cover 3, thrown the same beat. Montana's is 0.6 yd off and caught for 11; Namath's is 1.8 off and falls incomplete.
  ...pair('accuracy', 'On the hands', { seed: 16, play: 'doubles-curls', def: 'cover3', los: 30, script: concept({ icon: 1, at: 60 }) }, { off: 'QB', name: 'Joe Montana', pos: 'QB' }, { off: 'QB', name: 'Joe Namath', pos: 'QB' }),
  // The rush: the QB holds it against Cover 1. White sheds the tackle at 2.35 s and has the sack at 3.18; Aaron Smith never gets off his block.
  ...pair('rush', 'Through the tackle', { seed: 19, play: 'doubles-dagger', def: 'cover1', los: 30, script: holdIt }, { def: 'LE', name: 'Reggie White', pos: 'DE' }, { def: 'LE', name: 'Aaron Smith', pos: 'DE' }),
  // Coverage: four verticals against Cover 1, the ball to the X on his man. Deion picks it; Kam, out of place at corner, gives up 70.
  ...pair('coverage', 'Half the field', { seed: 15, play: 'trips-four-verts', def: 'cover1', los: 30, script: concept({ icon: 4, at: 90 }) }, { def: 'LCB', name: 'Deion Sanders', pos: 'CB' }, { def: 'LCB', name: 'Kam Chancellor', pos: 'S' }),
];
