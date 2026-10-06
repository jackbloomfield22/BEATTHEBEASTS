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

/** Room to sprint (Playtest 1 #2): the scripts hold the key in the open and let it go with a tackler within a couple of yards, as a player does. */
const open = (s: PlayState) => nearest(s) >= 2.6;

/** Ticks since the snap (scripts time everything from it, so frames spent before the snap don't change the play). */
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));

/** Throw to `icon` `at` ticks after the snap (a tap: touch), call a catch-and-run, then run upfield with a move when a tackler closes. */
export function throwAndRun(icon: number, at: number, move: 'juke' | 'stiffArm' | 'spin', lean = 0.15) {
  return (s: PlayState): InputFrame => {
    const t = since(s);
    if (s.phase === 'air') return input({ catchType: 'rac' });
    if (s.phase === 'carrier') {
      const close = nearest(s) < 2.6;
      return input({ move: { x: 1, y: lean }, sprint: !close, juke: move === 'juke' && close, stiffArm: move === 'stiffArm' && close, spin: move === 'spin' && close });
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
      return input({ move: cutting ? { x: 0.35, y: cut!.side } : { x: 1, y: 0 }, sprint: open(s) });
    }
    const scrambling = p.scramble && t >= p.scramble.at;
    return input({
      snap: s.phase === 'presnap',
      scramble: !!p.scramble && t === p.scramble.at,
      move: scrambling ? p.scramble!.dir : { x: 0, y: 0 },
      sprint: !!scrambling,
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
      return input({ move: past < 1.5 && k > 0.5 ? { x: hx / k, y: hy / k } : { x: 1, y: 0 }, sprint: open(s) });
    }
    if ((c.pos.y - cutY) * dir < 0 && past < cutPast + 1.5) return input({ move: { x: 0, y: dir }, sprint: open(s) });
    return input({ move: { x: Math.SQRT1_2, y: dir * Math.SQRT1_2 }, sprint: open(s) });
  };
}

/** The QB holds the ball and never throws: the rush gets home. */
export function holdIt(s: PlayState): InputFrame {
  return input({ snap: s.phase === 'presnap' });
}

// Seeds found by tools/sim/findclips.ts (re-found for M6's sim).
export const CLIPS: Clip[] = [
  // Four verticals against Cover 2: the slot's seam caught in stride, then a juke and 42 more after the catch to the end zone (re-found for M6.6's ratings: seed 51; for the second slant pass, the lead on the path he really runs and timing: seed 18; for the third, the rhythm read: seed 16, a juke and 41 more to the end zone).
  { id: 'completion-rac', title: 'Completion and run after the catch', seed: 16, play: 'trips-four-verts', def: 'cover2', los: 30, script: throwAndRun(2, 100, 'juke') },
  // The QB holds it: the four-man rush gets home at 3.8 s, the median no-throw pocket at Pro.
  { id: 'sack', title: 'Sack', seed: 6, play: 'trips-four-verts', def: 'cover1', los: 30, script: holdIt },
  // Stick against Cover 1: the short catch, a stiff arm sheds the first tackler a second later, down 15 yd on (11 after the catch).
  // A different play from the completion clip, so the broken tackle is the moment, not a second long run (2026-10-02; was Four Verticals seed 5).
  { id: 'broken-tackle', title: 'Broken tackle', seed: 13, play: 'trips-stick', def: 'cover1', los: 30, script: throwAndRun(2, 84, 'stiffArm') },
  // M6.5 #11: inside zone steered by the arrows, a 102° plant-and-cut across and a 45° one back upfield, a burst, and a tackler closing (tools/sim/findcarry.ts: 11.8 yd).
  { id: 'cut-run', title: 'Cut and burst on a designed run', seed: 17, play: 'singleback-inside-zone', def: 'cover2', los: 30, script: runAndCut(1.5, 3.5) },
];

// The ten broadcast concepts (M6.5): found by tools/sim/findconcepts.ts, the
// throw on time off the break, open, a real gain. Each note says what it shows.
export const CONCEPTS: Clip[] = [
  // Slants against quarters: the X's slant, the ball on him as he clears the linebacker (11 yd, 2.9 yd of separation; seed 1 → 3 for the second slant pass, the same play, call and throw).
  { id: 'slant', title: 'Slant', seed: 3, play: 'doubles-slants', def: 'cover4', los: 30, script: concept({ icon: 1, at: 30 }) },
  // The quick out against man: the break at 5, the ball out on it, the sideline (9 yd).
  { id: 'out', title: 'Quick out', seed: 8, play: 'doubles-quick-outs', def: 'cover1', los: 30, script: concept({ icon: 1, at: 30 }) },
  // Curl against man: settles at 10 facing the QB, SECURE on the catch (10 yd).
  { id: 'curl', title: 'Curl', seed: 5, play: 'doubles-curls', def: 'cover1', los: 30, script: concept({ icon: 1, at: 60, call: 'possession' }) },
  // Four verticals against the fire zone: the blitz comes, the ball goes at 1.5 s, the Z up the sideline over the rotated corner (38 yd, 2 yd of separation; re-found for the identity pass's sim, and for the second slant pass: seed 19 → 17, the same play, call and throw. Since the third slant pass's rhythm read he's caught at 1.4 yd and goes the distance, 70 yd).
  { id: 'go', title: 'Go', seed: 17, play: 'trips-four-verts', def: 'firezone', los: 30, script: concept({ icon: 3, at: 90, hold: 16 }) },
  // Play-action post against man: the fake, the post behind it, the ball led into the middle (25 yd).
  // Seed 13 → 40 for the slant squeeze (docs/m66/SLANTS.md): a half safety now breaks on the ball at the pace that gets him there, and on seed 13 he got a hand to it. Seed 40 → 9 for the second slant pass (the lead on his real path, timing), the same play, coverage and throw: 24 yd, 1.5 yd of separation. Seed 9 → 108 for the third (2-man's trail technique: on 9 the corner was 0.9 yd off him), the same play, coverage and throw: 26 yd, 1.4 yd of separation.
  { id: 'post', title: 'Post', seed: 108, play: 'singleback-pa-post', def: 'cover2man', los: 30, script: concept({ icon: 1, at: 80, hold: 10 }) },
  // Snag's corner against man: the Z's corner from the bunch, the ball over the outside shoulder (36 yd).
  { id: 'corner', title: 'Corner', seed: 6, play: 'bunch-snag', def: 'cover2man', los: 30, script: concept({ icon: 3, at: 60, hold: 14 }) },
  // PA crossers against the fire zone: the blitz bites on the fake, the X's deep cross comes open behind it, caught running (14 yd; re-found for the identity pass's sim).
  { id: 'crosser', title: 'Crosser', seed: 10, play: 'ace-pa-crossers', def: 'firezone', los: 30, script: concept({ icon: 1, at: 80 }) },
  // RB screen: the back slips out behind the rush, the linemen release in front of him.
  // Seed 4 → 60 in M6.6: the added stints (docs/m66/DATA_AUDIT.md) move the practice roster's ratings a point here and there, and seed 4 became a 2.9-yd loss. Seed 60 is the same play, coverage and throw time: 11.6 yd, 2.9 yd of separation.
  // Seed 60 → 64, Cover 2 man → Cover 1 Blitz, the throw at 76 → 60 ticks for the weak-spot pass (the line lets the rush in and the
  // man on the back hugs, ai.ts hugs): on 60 the back made 5 yd; on 64 against the blitz the Sam rushes, the back slips out behind
  // him and the released line leads it (11.8 yd, 2.5 yd of separation; tools/sim/findconcepts.ts --only=screen).
  // Seed 64 → 51, Cover 1 Blitz → Cover 2, the throw at 60 → 104 ticks for the screen convoy (the screens pass): the back sets
  // before the ball comes, the guards and center release to their landmarks outside him, and against zone the linebackers
  // come downhill into them (9.7 yd, 2.6 yd of separation; tools/sim/findconcepts.ts --only=screen).
  { id: 'screen', title: 'Screen', seed: 51, play: 'doubles-rb-screen', def: 'cover2', los: 30, script: concept({ icon: 1, at: 104 }) },
  // Back shoulder against man: the corner on top of the Z's go, the ball thrown away from him, GO UP (17 yd; seed 2 → 4 for the second slant pass, the same play, call and throw).
  { id: 'back-shoulder', title: 'Back shoulder', seed: 4, play: 'trips-four-verts', def: 'cover1', los: 30, script: concept({ icon: 3, at: 48, aim: { x: -1, y: -0.2 }, call: 'aggressive' }) },
  // The scramble drill: the QB escapes right, the Y breaks off his cross and works back to him in the open grass (10 yd).
  // Re-found for the slant squeeze (docs/m66/SLANTS.md: the underneath zones now plaster when the QB leaves the pocket; on cover 3 seed 9 the ball was picked):
  // tools/sim/findconcepts.ts --only=scramble-drill, the same escape and throw time.
  { id: 'scramble-drill', title: 'Scramble drill', seed: 17, play: 'trips-y-cross', def: 'cover4', los: 30, script: concept({ icon: 1, at: 150, scramble: { at: 110, dir: { x: 0.25, y: 1 } } }) },
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
  // Speed: the play-action post against Cover 2. Hill is behind the safety, open by 2.5 yd, for 45; Welker's ball falls incomplete with a man on him (1.4 yd). (Seed 7 → 6 for the second slant pass, the same play, call and throw; 6 → 67 for the third, the rhythm read: Hill 70 yd at 2.1 yd of separation, Welker's incomplete at 1.1.)
  ...pair('speed', 'Speed', { seed: 67, play: 'singleback-pa-post', def: 'cover2', los: 30, script: concept({ icon: 1, at: 90, hold: 16 }) }, { off: 'X', name: 'Tyreek Hill', pos: 'WR' }, { off: 'X', name: 'Wes Welker', pos: 'WR' }),
  // Elusive against power: I-form power against Cover 1, the AI carrying. Barry makes the man miss and goes 70; Bettis breaks two and is down at 6.5.
  ...pair('elusive', 'Make a man miss', { seed: 11, play: 'iform-power', def: 'cover1', los: 30, user: false, script: () => NEUTRAL }, { off: 'RB', name: 'Barry Sanders', pos: 'RB' }, { off: 'RB', name: 'Jerome Bettis', pos: 'RB' }),
  // Accuracy: the curl against Cover 3, thrown the same beat. Montana's is 0.2 yd off and caught for 10; Namath's is 1.9 off and falls incomplete (seed 16 → 60 for the second slant pass, the same play, call and throw).
  ...pair('accuracy', 'On the hands', { seed: 60, play: 'doubles-curls', def: 'cover3', los: 30, script: concept({ icon: 1, at: 60 }) }, { off: 'QB', name: 'Joe Montana', pos: 'QB' }, { off: 'QB', name: 'Joe Namath', pos: 'QB' }),
  // The rush: the QB holds it against Cover 1. White sheds the tackle at 2.35 s and has the sack at 3.18; Aaron Smith never gets off his block.
  ...pair('rush', 'Through the tackle', { seed: 19, play: 'doubles-dagger', def: 'cover1', los: 30, script: holdIt }, { def: 'LE', name: 'Reggie White', pos: 'DE' }, { def: 'LE', name: 'Aaron Smith', pos: 'DE' }),
  // Coverage: four verticals against Cover 1, the ball to the X on his man. Deion gets a hand to it; Kam, out of place at corner, gives up 70.
  // (Seed 15 → 20 for the slant squeeze, docs/m66/SLANTS.md; 20 → 67 for the second slant pass, tools/sim/findidentity.ts --only=coverage: the same play and call, Deion's breakup at 1.3 yd, Kam's 70 yd at 2.8 yd of separation. No seed in 1–80 has Deion's pick now.)
  // (Seed 67 Cover 1 → seed 42 Cover 2 man for the passing pass, docs/passing/PASSING.md: the same play and throw; Deion now picks it, Kam gives up 32 yd at 1.2 yd of separation.)
  ...pair('coverage', 'Half the field', { seed: 42, play: 'trips-four-verts', def: 'cover2man', los: 30, script: concept({ icon: 4, at: 90 }) }, { def: 'LCB', name: 'Deion Sanders', pos: 'CB' }, { def: 'LCB', name: 'Kam Chancellor', pos: 'S' }),
];

// The passing game, end to end (docs/passing/PASSING.md): one clip per
// moment a fan watches the passing game for, found by
// tools/sim/findpassing.ts, recorded before and after the passing pass
// (BTB_VIDEO=1 BTB_PASSING=1, tools/shots/video.spec.ts). The arm pair is
// the same deep ball from Dan Marino (Throw Power 96) and Joe Montana (72).
export const PASSING: Clip[] = [
  // The quick slant against quarters (the slant concept's play).
  { id: 'pass-slant', title: 'Quick slant', seed: 3, play: 'doubles-slants', def: 'cover4', los: 30, script: concept({ icon: 1, at: 30 }) },
  // The dig over the middle against Cover 3, 11 yd in the air, a step of separation.
  { id: 'pass-dig', title: 'Dig', seed: 5, play: 'singleback-drive', def: 'cover3', los: 30, script: concept({ icon: 2, at: 90 }) },
  // The back-shoulder fade against man (the back-shoulder concept's play).
  { id: 'pass-back-shoulder', title: 'Back-shoulder fade', seed: 4, play: 'trips-four-verts', def: 'cover1', los: 30, script: concept({ icon: 3, at: 48, aim: { x: -1, y: -0.2 }, call: 'aggressive' }) },
  // The deep post against Cover 2: the X's post off Y-Cross, held for touch, ~45 yd in the air between the safeties.
  { id: 'pass-post', title: 'Deep post', seed: 2, play: 'trips-y-cross', def: 'cover2', los: 30, script: concept({ icon: 3, at: 150, hold: 12 }) },
  // Touch over a linebacker: the tight end's seam against Cover 3, held, the hook defender under its path, 25 yd.
  { id: 'pass-touch', title: 'Touch over the linebacker', seed: 4, play: 'ace-te-seam', def: 'cover3', los: 30, script: concept({ icon: 1, at: 60, hold: 20 }) },
  // On the run: the boot, thrown at 6.5 yd/s outside the pocket to the sail, 15 yd.
  { id: 'pass-onrun', title: 'Throw on the run', seed: 6, play: 'pistol-pa-boot', def: 'cover3', los: 30, script: concept({ icon: 1, at: 80 }) },
  // Under pressure: the fire zone gets home as he throws the cross late (2.9 s), the cone doubled by the rusher in his face.
  { id: 'pass-pressure', title: 'Throw under pressure', seed: 12, play: 'trips-y-cross', def: 'firezone', los: 30, script: concept({ icon: 1, at: 176 }) },
  // The contested catch: the X's go against Cover 3, GO UP with the corner on him (contest 1.0), caught at 20 yd.
  { id: 'pass-contested', title: 'Contested catch', seed: 1, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 4, at: 60, call: 'aggressive' }) },
  // The drop: the quick out, open, off his hands.
  { id: 'pass-drop', title: 'Drop', seed: 1, play: 'doubles-quick-outs', def: 'cover3', los: 30, script: concept({ icon: 1, at: 50 }) },
  // The arm: the go concept's ball (the Z up the sideline, held for touch) from Dan Marino and from Joe Montana.
  ...pair('arm', 'The arm', { seed: 17, play: 'trips-four-verts', def: 'firezone', los: 30, script: concept({ icon: 3, at: 90, hold: 16 }) }, { off: 'QB', name: 'Dan Marino', pos: 'QB' }, { off: 'QB', name: 'Joe Montana', pos: 'QB' }),
];
