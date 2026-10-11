// Scripted plays for the feel videos (M5.5, tools/shots/video.spec.ts) and
// their tests. Each clip is a seed, a play, a coverage and a script that
// returns the tick's input from the play's state, so Node (where the seeds
// were found: tools/sim/findclips.ts) and the browser (where the video is
// recorded) run the same play to the same whistle.

import { findStint, input, NEUTRAL, PERSONNEL, playById, simPlayer, type BeastsDefense, type CatchType, type ContendersRoster, type DefSlot, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '@/sim';
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

/**
 * A designed run the player carries (the tackling videos): upfield, and when
 * a man is on the turf ahead of him, at the middle of his trunk with the one
 * button pressed inside a couple of yards: the hurdle over a man on the
 * ground (sim/tackle.ts feetStep). Pure in the state.
 */
export function runAtBody(s: PlayState): InputFrame {
  if (s.phase === 'presnap') return input({ snap: true });
  if (s.phase !== 'carrier' || s.carrier < 0) return input({});
  const c = s.agents[s.carrier]!;
  let best: { x: number; y: number; d: number } | null = null;
  for (const g of s.agents) {
    const L = g.lie;
    if (!g.down || !L || g.side === c.side) continue;
    const x = L.x + L.dx * L.torso * 0.5;
    const y = L.y + L.dy * L.torso * 0.5;
    const d = Math.hypot(x - c.pos.x, y - c.pos.y);
    if (x - c.pos.x > 0.8 && d < 7 && (!best || d < best.d)) best = { x, y, d };
  }
  if (!best) return input({ move: { x: 1, y: 0 }, sprint: open(s) });
  return input({ move: { x: (best.x - c.pos.x) / best.d, y: (best.y - c.pos.y) / best.d }, sprint: true, auto: best.d < 2.6 });
}

/** The QB holds the ball and never throws: the rush gets home. */
export function holdIt(s: PlayState): InputFrame {
  return input({ snap: s.phase === 'presnap' });
}

// Seeds found by tools/sim/findclips.ts (re-found for M6's sim).
export const CLIPS: Clip[] = [
  // Four verticals against Cover 2: the slot's seam caught in stride, then a juke and 42 more after the catch to the end zone (re-found for M6.6's ratings: seed 51; for the second slant pass, the lead on the path he really runs and timing: seed 18; for the third, the rhythm read: seed 16, a juke and 41 more to the end zone; for the passing and tackling passes together: seed 12, 40 more after the catch to the end zone).
  // (Cover 2 seed 12 → Cover 1 seed 23, the slot's seam, for passing round 2, tools/sim/findclips.ts: caught in stride and 15 yd after the catch with the juke.)
  // (Seed 23 → 45 for passing round 3, tools/sim/findclips.ts: the key starts the arm and the other receivers run their routes through the throw; the slot's seam caught and 14 yd after it with the juke.)
  // (Cover 1 seed 45 → Cover 3 seed 25 for passing round 4, tools/sim/findclips.ts: the deep ball in the bucket; the slot's seam caught and 23 yd after it.)
  // (Seed 25, icon 1 → seed 65, icon 2 for passing round 6, tools/sim/p6_refind.ts: the catch at his hands; the tight end's seam against Cover 3, caught and 15 yd after it.)
  { id: 'completion-rac', title: 'Completion and run after the catch', seed: 65, play: 'trips-four-verts', def: 'cover3', los: 30, script: throwAndRun(2, 100, 'juke') },
  // The QB holds it: the four-man rush gets home at 3.8 s, the median no-throw pocket at Pro.
  { id: 'sack', title: 'Sack', seed: 6, play: 'trips-four-verts', def: 'cover1', los: 30, script: holdIt },
  // Stick against Cover 1: the short catch, a stiff arm sheds the first tackler a second later, down 15 yd on (11 after the catch).
  // A different play from the completion clip, so the broken tackle is the moment, not a second long run (2026-10-02; was Four Verticals seed 5).
  // (Icon 2 → 3 for passing round 6, tools/sim/p6_feel.ts: the catch at his hands; the same snap to the fade side, a stiff arm sheds the tackler, 24 yd.)
  { id: 'broken-tackle', title: 'Broken tackle', seed: 13, play: 'trips-stick', def: 'cover1', los: 30, script: throwAndRun(3, 84, 'stiffArm') },
  // M6.5 #11: inside zone steered by the arrows, a 102° plant-and-cut across and a 45° one back upfield, a burst, and a tackler closing (tools/sim/findcarry.ts: 11.8 yd).
  { id: 'cut-run', title: 'Cut and burst on a designed run', seed: 17, play: 'singleback-inside-zone', def: 'cover2', los: 30, script: runAndCut(1.5, 3.5) },
  // A catch-and-run touchdown (the touchdown celebrations' browser test plays it): Four Verticals against Cover 2, icon 1 caught and taken
  // 70 yd to the end zone (2026-10-08, after the passing pass's round two; completion-rac is a tackle by design, so it can't stand in).
  // (Seed 8 → 30 for passing round 3: the key starts the arm; caught at the 40 and taken 39 yd to the end zone.)
  // (Seed 30 → 78 for passing round 4: the deep ball in the bucket; caught at the 39 and taken 39 yd to the end zone.)
  // (Seed 78 → 79 for passing round 6, tools/sim/p6_feel.ts: the catch at his hands.)
  { id: 'touchdown', title: 'Catch-and-run touchdown', seed: 79, play: 'trips-four-verts', def: 'cover2', los: 30, script: throwAndRun(1, 100, 'juke') },
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
  // (Fire zone seed 17 → sim pressure seed 17 for passing round 2, tools/sim/findconcepts.ts --only=go: the same play and throw, 36.5 yd at 1.9 yd of separation.)
  // (Seed 17 at 90 → seed 4 at 80 for passing round 3, tools/sim/findconcepts.ts --only=go: the key starts the arm; the same play and call, 29 yd, 27 in the air, 2.5 yd of separation.)
  { id: 'go', title: 'Go', seed: 4, play: 'trips-four-verts', def: 'simpressure', los: 30, script: concept({ icon: 3, at: 80, hold: 16 }) },
  // Play-action post against man: the fake, the post behind it, the ball led into the middle (25 yd).
  // Seed 13 → 40 for the slant squeeze (docs/m66/SLANTS.md): a half safety now breaks on the ball at the pace that gets him there, and on seed 13 he got a hand to it. Seed 40 → 9 for the second slant pass (the lead on his real path, timing), the same play, coverage and throw: 24 yd, 1.5 yd of separation. Seed 9 → 108 for the third (2-man's trail technique: on 9 the corner was 0.9 yd off him), the same play, coverage and throw: 26 yd, 1.4 yd of separation. Seed 108 → the play-action Yankee's post against Cover 2, seed 24, for the tackle physics (docs/physics/TACKLING.md; no seed of the pa-post itself in 1–30 held its separation): 28.6 yd, 2.5 yd of separation.
  { id: 'post', title: 'Post', seed: 24, play: 'singleback-pa-yankee', def: 'cover2', los: 30, script: concept({ icon: 2, at: 80, hold: 10 }) },
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
  // (Cover 2 seed 51 → Cover 3 seed 19 for passing round 3, tools/sim/findconcepts.ts --only=screen: the key starts the arm; the same play and throw time, 6.5 yd at 2.9 yd of separation.)
  { id: 'screen', title: 'Screen', seed: 19, play: 'doubles-rb-screen', def: 'cover3', los: 30, script: concept({ icon: 1, at: 104 }) },
  // Back shoulder against man: the corner on top of the Z's go, the ball thrown away from him, GO UP (17 yd; seed 2 → 4 for the second slant pass, the same play, call and throw).
  // (Re-found for the tackle physics, docs/physics/TACKLING.md: on cover 1 seed 4 the corner was on him at the ball. tools/sim/findconcepts.ts --only=back-shoulder.)
  // (Seed 5 at 64 → seed 10 at 68 for passing round 2, tools/sim/findconcepts.ts --only=back-shoulder: the same throw, 22 yd at 1.4 yd of separation.)
  { id: 'back-shoulder', title: 'Back shoulder', seed: 10, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 3, at: 68, aim: { x: -1, y: -0.2 }, call: 'aggressive' }) },
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
  // (Passing round 2, tools/sim/findidentity.ts --only=speed: four verticals against Cover 3, seed 25, the ball to the X at 100 held for touch: Hill 70 yd, Welker's falls incomplete.)
  ...pair('speed', 'Speed', { seed: 25, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 4, at: 100, hold: 16 }) }, { off: 'X', name: 'Tyreek Hill', pos: 'WR' }, { off: 'X', name: 'Wes Welker', pos: 'WR' }),
  // Elusive against power: I-form power against Cover 2 (seed 11 on Cover 1 → 10 on Cover 2 for the tackle physics, tools/sim/findidentity.ts --only=elusive), the AI carrying. Barry makes the man miss and goes 70; Bettis breaks one and is down at 1.2.
  ...pair('elusive', 'Make a man miss', { seed: 10, play: 'iform-power', def: 'cover2', los: 30, user: false, script: () => NEUTRAL }, { off: 'RB', name: 'Barry Sanders', pos: 'RB' }, { off: 'RB', name: 'Jerome Bettis', pos: 'RB' }),
  // Accuracy: the curl against Cover 3, thrown the same beat. Montana's is 0.2 yd off and caught for 10; Namath's is 1.9 off and falls incomplete (seed 16 → 60 for the second slant pass, the same play, call and throw).
  // (Cover 3 seed 60 → Cover 2 seed 16 for passing round 3, tools/sim/findidentity.ts --only=accuracy: the curl comes back to the ball now; Montana's is 0.4 yd off for 12.7, Namath's 1.7 off and incomplete.)
  // (Passing round 7, tools/sim/findidentity.ts: Cover 2 seed 16 → Cover 4 seed 14, the same curl: Montana 0.53 yd off it and caught for 13, Namath 2.0 off and incomplete.)
  ...pair('accuracy', 'On the hands', { seed: 14, play: 'doubles-curls', def: 'cover4', los: 30, script: concept({ icon: 1, at: 60 }) }, { off: 'QB', name: 'Joe Montana', pos: 'QB' }, { off: 'QB', name: 'Joe Namath', pos: 'QB' }),
  // The rush: the QB holds it against Cover 1 (seed 19 → 5 for the tackle physics, the snap where White's sack is the strip the result-card test reads). White gets off the tackle and strips him; Aaron Smith never gets off his block.
  // (Seed 5 → 52 for passing round 2, tools/sim/findidentity.ts --only=rush and the result card: White sheds at 2.0 s and strips him; Smith never gets off.)
  ...pair('rush', 'Through the tackle', { seed: 52, play: 'doubles-dagger', def: 'cover1', los: 30, script: holdIt }, { def: 'LE', name: 'Reggie White', pos: 'DE' }, { def: 'LE', name: 'Aaron Smith', pos: 'DE' }),
  // Coverage: four verticals against Cover 1, the ball to the X on his man. Deion gets a hand to it; Kam, out of place at corner, gives up 70.
  // (Seed 15 → 20 for the slant squeeze, docs/m66/SLANTS.md; 20 → 67 for the second slant pass, tools/sim/findidentity.ts --only=coverage: the same play and call, Deion's breakup at 1.3 yd, Kam's 70 yd at 2.8 yd of separation. No seed in 1–80 has Deion's pick now.)
  // (Seed 67 Cover 1 → seed 42 Cover 2 man for the passing pass, docs/passing/PASSING.md: the same play and throw; Deion now picks it, Kam gives up 32 yd at 1.2 yd of separation.)
  // (Cover 2 man seed 42 → Cover 1 seed 4 for passing round 3, tools/sim/findidentity.ts --only=coverage: Deion picks it; Kam gives up 40 yd at 2.7 yd of separation.)
  // (Cover 1 seed 4 → Cover 2 man seed 37 for passing round 4, tools/sim/findidentity.ts --only=coverage: with the deep ball in the bucket the seed-4 ball got to the X, who lost it; now Deion breaks it up at the catch point, Kam gives up 39 yd.)
  // (Cover 2 man seed 37 → Cover 1 seed 4 for passing round 6, tools/sim/findidentity.ts --only=coverage: with the catch at his hands the seed-37 ball no longer splits them; on Cover 1 seed 4 Deion picks it, Kam gives up 41 yd at 3.2 yd of separation.)
  ...pair('coverage', 'Half the field', { seed: 4, play: 'trips-four-verts', def: 'cover1', los: 30, script: concept({ icon: 4, at: 90 }) }, { def: 'LCB', name: 'Deion Sanders', pos: 'CB' }, { def: 'LCB', name: 'Kam Chancellor', pos: 'S' }),
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
  // (Cover 2 → the fire zone, the same seed and throw, for passing round 3, tools/sim/findpassing.ts --only=post: 48 yd, 42 in the air, 2 yd of separation.)
  { id: 'pass-post', title: 'Deep post', seed: 2, play: 'trips-y-cross', def: 'firezone', los: 30, script: concept({ icon: 3, at: 150, hold: 12 }) },
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

// Passing round 2 (docs/passing/PASSING2.md): the QB's feet and eyes, the
// receiver's head and hands, the bobble and the arm, found by
// tools/sim/findpassing2.ts and recorded with a close camera on the man
// (tools/shots/video.spec.ts BTB_PASSING2: each clip's `follow`).
export const PASSING2: (Clip & { follow?: string })[] = [
  // The 5-step from under center and the hitch, the ball out on the dig's break (cover 3, caught for 15).
  { id: 'p2-drop5', title: '5-step, hitch, dig', seed: 3, play: 'singleback-drive', def: 'cover3', los: 30, script: concept({ icon: 2, at: 100 }), follow: 'QB,3,-6,2.2,38' },
  // The same drops as the AI plays them (the hitch is the AI's: the player steps up with the stick): the 5-step and hitch, the drag out on the hitch; the 7-step off the fake.
  { id: 'p2-drop5-ai', title: '5-step and hitch (AI)', seed: 3, play: 'singleback-drive', def: 'cover3', los: 30, user: false, script: () => NEUTRAL, follow: 'QB,3,-6,2.2,38' },
  { id: 'p2-drop7-ai', title: 'Play action 7-step (AI)', seed: 1, play: 'iform-pa-deep-shot', def: 'cover3', los: 30, user: false, script: () => NEUTRAL, follow: 'QB,3,-7,2.4,40' },
  // The 3-step from under center: the quick out on the plant.
  { id: 'p2-drop3', title: '3-step, quick out', seed: 3, play: 'singleback-quick-outs', def: 'cover3', los: 30, script: concept({ icon: 1, at: 58 }), follow: 'QB,3,-6,2.2,38' },
  // The 7-step off play action: the post against Cover 3.
  { id: 'p2-drop7', title: 'Play action 7-step, post', seed: 8, play: 'iform-pa-deep-shot', def: 'cover3', los: 30, script: concept({ icon: 1, at: 118 }), follow: 'QB,3,-7,2.4,40' },
  // From the gun: the catch, the step and the slant on rhythm.
  { id: 'p2-gun-slant', title: 'Gun quick slant', seed: 6, play: 'doubles-slants', def: 'cover4', los: 30, script: concept({ icon: 1, at: 36 }), follow: 'QB,3,-6,2.2,38' },
  // The same slant on the receiver: the head round to the QB out of the break, the hands late, the eyes into the hands.
  { id: 'p2-head-slant', title: 'Slant: the head and hands', seed: 6, play: 'doubles-slants', def: 'cover4', los: 30, script: concept({ icon: 1, at: 36 }), follow: 'X,5,-5,2,42' },
  // The go route: eyes up the field, then back over the shoulder for the layered ball.
  { id: 'p2-shoulder', title: 'Go: over the shoulder', seed: 3, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 3, at: 90, hold: 16 }), follow: 'Z,7,5,2.4,45' },
  // The juggle: the slant off his hands and back in.
  // (Cover 3 seed 28 → Tampa 2 seed 10 for passing round 3, tools/sim/findpassing2.ts: the key starts the arm; the same slant juggled and secured, 12 yd.)
  { id: 'p2-bobble', title: 'Bobble and re-catch', seed: 10, play: 'doubles-slants', def: 'tampa2', los: 30, script: concept({ icon: 1, at: 36 }), follow: 'X,5,-5,2,42' },
  // The eyes: the play-action post from a field general (Marino looks the safety off) and from Winston (stares his man down).
  ...pair('p2-lookoff', 'The eyes', { seed: 2, play: 'singleback-pa-post', def: 'cover3', los: 30, script: concept({ icon: 1, at: 108 }) }, { off: 'QB', name: 'Dan Marino', pos: 'QB' }, { off: 'QB', name: 'Jameis Winston', pos: 'QB' }).map((c) => ({ ...c, follow: 'QB,-13,0,13,55,13' })),
  // The arm from the sideline: the go ball from Marino (96) and Montana (72).
  ...pair('p2-arm', 'The arm', { seed: 4, play: 'trips-four-verts', def: 'firezone', los: 30, script: concept({ icon: 3, at: 90, hold: 16 }) }, { off: 'QB', name: 'Dan Marino', pos: 'QB' }, { off: 'QB', name: 'Joe Montana', pos: 'QB' }).map((c) => ({ ...c, follow: 'QB,22,36,8,50,22' })),
];

// The tackling videos (docs/physics/TACKLING.md): each moment the contact
// physics is about, found by tools/sim/findtackles.ts.
export const PHYSICS: Clip[] = [
  // The Bus wrapped up from the front on inside zone falls forward for the extra yards.
  { id: 'tackle-fall-forward', title: 'Falls forward: Jerome Bettis', seed: 12, play: 'singleback-inside-zone', def: 'firezone', los: 30, user: false, script: () => NEUTRAL, swap: { off: 'RB', name: 'Jerome Bettis', pos: 'RB' } },
  // Singletary, Revis and Ray Lewis in on Derrick Henry on the toss: the pile.
  { id: 'tackle-gang', title: 'Gang tackle: Derrick Henry', seed: 10, play: 'iform-toss', def: 'cover2man', los: 30, user: false, script: () => NEUTRAL, swap: { off: 'RB', name: 'Derrick Henry', pos: 'RB' } },
  // Barry Sanders runs over Darrelle Revis (on the turf), stumbles over him, and drags Ed Reed out of bounds 10 yd on.
  { id: 'tackle-arm-broken', title: 'Through an arm tackle: Barry Sanders', seed: 10, play: 'iform-toss', def: 'firezone', los: 30, user: false, script: () => NEUTRAL, swap: { off: 'RB', name: 'Barry Sanders', pos: 'RB' } },
  // Kam Chancellor at strong safety lays out Roger Craig, already held at the ankles by Ray Lewis: the big hit, and he goes down backwards.
  { id: 'tackle-big-hit', title: 'Big hit: Kam Chancellor', seed: 2, play: 'heavy-power', def: 'cover2', los: 30, user: false, script: () => NEUTRAL, swap: { def: 'SS', name: 'Kam Chancellor', pos: 'S' } },
  // The player runs Barry Sanders at a pancaked lineman on the turf and presses the one button: the hurdle; Ronnie Lott's shoestring tackle 4 yd on.
  { id: 'tackle-hurdle', title: 'Over a man on the turf: Barry Sanders', seed: 7, play: 'iform-iso', def: 'cover1', los: 30, script: runAtBody, swap: { off: 'RB', name: 'Barry Sanders', pos: 'RB' } },
  // The slant against Cover 4 (Kam at strong safety): Ed Reed meets Jerry Rice square coming downhill, driven back, spotted at his forward progress.
  // (Seed 1 → 6 for passing round 2, tools/sim/findtackles.ts --only=tackle-driven-back: the same slant, caught for 11.8 and driven back.)
  // (Seed 6 → 39 for passing round 3, tools/sim/findtackles.ts --only=tackle-driven-back: the same slant, caught for 7.2 and driven back.)
  // (Cover 4 seed 39 → the fire zone, seed 9, for passing round 6, tools/sim/findtackles.ts --only=tackle-driven-back: the same slant, caught for 9.3 and driven back.)
  { id: 'tackle-driven-back', title: 'Driven back: Jerry Rice met by Ed Reed', seed: 9, play: 'doubles-slants', def: 'firezone', los: 30, script: concept({ icon: 1, at: 30 }), swap: { def: 'SS', name: 'Kam Chancellor', pos: 'S' } },
];

/** The player's throw (passing round 3): a hot route at the line if asked, the key at `at` ticks after the snap (a tap, or held `hold` ticks for touch), no catch call, then upfield with the sprint in the open. */
export function userThrow(p: { icon: number; at: number; hold?: number; hot?: RouteName }) {
  return (s: PlayState): InputFrame => {
    if (s.phase === 'presnap') return input({ snap: true, hotRoute: p.hot ? { icon: p.icon, route: p.hot } : null });
    if (s.phase === 'carrier') return input({ move: { x: 1, y: 0 }, sprint: s.agents[s.carrier]?.side === 'off' && open(s) });
    const t = since(s);
    return input({ throwHeld: t >= p.at && t < p.at + (p.hold ?? 4) ? p.icon : 0 });
  };
}

// Passing round 3 (docs/passing/PASSING3.md): the player's own throws, the
// way the owner plays them, from the default broadcast camera. Each route
// thrown on time (the key pressed a release's length before his break, so
// the ball's out on it), and four of them late (pressed as he comes out of
// the break, a player's reaction). Found by tools/sim/passing3.ts.
export const PASSING3: Clip[] = [
  { id: 'p3-slant', title: 'Slant', seed: 1, play: 'doubles-slants', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 22 }) },
  { id: 'p3-out', title: 'Out', seed: 3, play: 'doubles-curls', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 79, hot: 'out' }) },
  { id: 'p3-dig', title: 'Dig', seed: 3, play: 'singleback-drive', def: 'cover3', los: 30, script: userThrow({ icon: 2, at: 93 }) },
  { id: 'p3-curl', title: 'Curl', seed: 1, play: 'doubles-curls', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 97 }) },
  { id: 'p3-post', title: 'Post', seed: 2, play: 'singleback-pa-post', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 85, hold: 14 }) },
  // (A second post, seed 4: round three's after recording of seed 2 is batted at the line; this one is caught deep, ~30 yd.)
  { id: 'p3-post-b', title: 'Post (2)', seed: 4, play: 'singleback-pa-post', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 86, hold: 14 }) },
  { id: 'p3-go', title: 'Go', seed: 3, play: 'trips-four-verts', def: 'cover3', los: 30, script: userThrow({ icon: 4, at: 71, hold: 16 }) },
  { id: 'p3-cross', title: 'Crosser', seed: 1, play: 'trips-y-cross', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 115 }) },
  { id: 'p3-comeback', title: 'Comeback', seed: 1, play: 'doubles-curls', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 117, hot: 'comeback' }) },
  { id: 'p3-slant-late', title: 'Slant, late', seed: 1, play: 'doubles-slants', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 53 }) },
  { id: 'p3-out-late', title: 'Out, late', seed: 3, play: 'doubles-curls', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 120, hot: 'out' }) },
  { id: 'p3-dig-late', title: 'Dig, late', seed: 3, play: 'singleback-drive', def: 'cover3', los: 30, script: userThrow({ icon: 2, at: 134 }) },
  { id: 'p3-go-late', title: 'Go, late', seed: 3, play: 'trips-four-verts', def: 'cover3', los: 30, script: userThrow({ icon: 4, at: 113, hold: 16 }) },
];

// Passing round 4 (docs/passing/PASSING4.md): the player's throws pressed
// on the throw-timing cue (the tick it lights: tools/sim/cuetick.ts), the
// same QB's cue against Marino's and Winston's on the same dig, the late
// out, the deep ball, and the catch in stride from close (BTB_FOLLOW).
// Fixed ticks, so the same keys can be recorded on the tree before the cue.
export const PASSING4: Clip[] = [
  { id: 'p4-cue-dig', title: 'Dig on the cue', seed: 3, play: 'singleback-drive', def: 'cover3', los: 30, script: userThrow({ icon: 2, at: 98 }) },
  { id: 'p4-cue-dig-marino', title: 'Dig on the cue: Marino', seed: 3, play: 'singleback-drive', def: 'cover3', los: 30, script: userThrow({ icon: 2, at: 101 }), swap: { off: 'QB', name: 'Dan Marino', pos: 'QB' } },
  { id: 'p4-cue-dig-winston', title: 'Dig on the cue: Winston', seed: 3, play: 'singleback-drive', def: 'cover3', los: 30, script: userThrow({ icon: 2, at: 91 }), swap: { off: 'QB', name: 'Jameis Winston', pos: 'QB' } },
  { id: 'p4-out', title: 'Out on the cue', seed: 3, play: 'doubles-curls', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 84, hot: 'out' }) },
  { id: 'p4-out-late', title: 'Out, late', seed: 3, play: 'doubles-curls', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 120, hot: 'out' }) },
  { id: 'p4-go', title: 'Go on the cue', seed: 3, play: 'trips-four-verts', def: 'cover3', los: 30, script: userThrow({ icon: 4, at: 63, hold: 16 }) },
  { id: 'p4-post', title: 'Post on the cue', seed: 4, play: 'singleback-pa-post', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 91, hold: 14 }) },
  { id: 'p4-slant', title: 'Slant (the catch)', seed: 1, play: 'doubles-slants', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 22 }) },
];

// Passing round 5 (docs/passing/PASSING5.md): one play for each kind of
// catch (sim/catchstyle.ts), found by tools/sim/p5find.ts: the AI's own
// throws where they show it, the player's placement (high, the GO UP call)
// where they don't. Recorded from the broadcast camera and from a close one
// on the catcher (tools/shots/video.spec.ts BTB_PASSING5, FOLLOW5).
// The hands pair: Jerry Rice (Catching 99) plucks the stick out of the air;
// Kelvin Benjamin (63, Body Catcher) on the same snap lets it into his chest.
export const PASSING5: Clip[] = [
  { id: 'p5-hands', title: 'Hands: Jerry Rice', seed: 10, play: 'trips-stick', def: 'cover2', los: 30, user: false, script: () => NEUTRAL },
  { id: 'p5-body', title: 'Body catch: Kelvin Benjamin', seed: 10, play: 'trips-stick', def: 'cover2', los: 30, user: false, script: () => NEUTRAL, swap: { off: 'X', name: 'Kelvin Benjamin', pos: 'WR' } },
  { id: 'p5-high', title: 'Hands high: the curl over the head', seed: 1, play: 'doubles-curls', def: 'cover3', los: 30, script: concept({ icon: 1, at: 97, aim: { x: 0, y: 1 } }) },
  { id: 'p5-low', title: 'Hands low: the slant at the knees', seed: 5, play: 'doubles-slants', def: 'cover1', los: 30, user: false, script: () => NEUTRAL },
  { id: 'p5-scoop', title: 'Scoop: the hitch at the shoe tops', seed: 5, play: 'doubles-hitch-seam', def: 'firezone', los: 30, user: false, script: () => NEUTRAL },
  { id: 'p5-reach', title: 'Reach: the slant behind him', seed: 8, play: 'doubles-slants', def: 'cover3', los: 30, user: false, script: () => NEUTRAL },
  // (Re-found for passing round 6: with the catch at his hands the leak's ball meets Gronk a stride before Lott gets there; the Y-cross against Cover 1 has Lott on him at the catch: tools/sim/p5find.ts --style=contested.)
  { id: 'p5-contested', title: 'Through contact: Gronk', seed: 3, play: 'trips-y-cross', def: 'cover1', los: 30, user: false, script: () => NEUTRAL, swap: { off: 'TE', name: 'Rob Gronkowski', pos: 'TE' } },
  { id: 'p5-highpoint', title: 'High point: GO UP', seed: 1, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 4, at: 60, aim: { x: 0, y: 1 }, call: 'aggressive' }) },
  { id: 'p5-shoulder', title: 'Over the shoulder: the go', seed: 4, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 3, at: 90, hold: 16 }) },
  { id: 'p5-toetap', title: 'Toe tap: the quick out', seed: 12, play: 'doubles-quick-outs', def: 'cover2', los: 30, user: false, script: () => NEUTRAL },
];

// Passing round 6 (docs/passing/PASSING6.md): the player's own throws on the
// cue (the tick the throw-timing cue says, found by tools/sim/p6find.ts) to
// the go, the post, the corner, the crosser and the out, from the default
// broadcast camera and a close one on the catcher (tools/shots/video.spec.ts
// BTB_PASSING6, FOLLOW6): is the ball thrown to where he's going, does he run
// under it in stride, and do the ball and his hands meet on the catch? The
// weak arm's go (Chad Pennington: Throw Power 59, Deep Accuracy 75) is the
// same throw from a QB who misses; the high point, over the shoulder and the
// toe tap are round five's plays, for the re-keyed clips.
export const PASSING6: Clip[] = [
  { id: 'p6-go', title: 'The go on the cue: Montana to Rice', seed: 3, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 4, at: 63 }) },
  { id: 'p6-post', title: 'The post on the cue', seed: 11, play: 'singleback-pa-post', def: 'cover3', los: 30, script: concept({ icon: 1, at: 93 }) },
  // (Passing round 7, tools/sim/p7find.ts: the post seed 2 → 11 and the corner seed 3 → 4, both caught on the cue on this sim.)
  { id: 'p6-corner', title: 'The corner on the cue', seed: 4, play: 'doubles-smash', def: 'cover3', los: 30, script: concept({ icon: 1, at: 81 }) },
  { id: 'p6-cross', title: 'The crosser on the cue', seed: 1, play: 'trips-y-cross', def: 'cover3', los: 30, script: concept({ icon: 1, at: 120 }) },
  { id: 'p6-out', title: 'The out on the cue (left sideline)', seed: 3, play: 'doubles-curls', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 84, hot: 'out' }) },
  { id: 'p6-weak-go', title: 'The go from a weak arm: Chad Pennington', seed: 5, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 4, at: 59 }), swap: { off: 'QB', name: 'Chad Pennington', pos: 'QB' } },
  { id: 'p6-shoulder', title: 'Over the shoulder: the go, touch', seed: 4, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 3, at: 90, hold: 16 }) },
  { id: 'p6-highpoint', title: 'High point: GO UP', seed: 1, play: 'trips-four-verts', def: 'cover3', los: 30, script: concept({ icon: 4, at: 60, aim: { x: 0, y: 1 }, call: 'aggressive' }) },
  { id: 'p6-toetap', title: 'Toe tap: the quick out', seed: 12, play: 'doubles-quick-outs', def: 'cover2', los: 30, user: false, script: () => NEUTRAL },
  // The ball's arm: the X's slant on the left, caught with room and run 9 yd after it (tools/sim/p6_carryfind.ts): tucked, then moved to the arm away from the tackler.
  { id: 'p6-carry', title: 'The ball in the outside arm', seed: 12, play: 'doubles-slants', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 30 }) },
];

// Passing round 7 (docs/passing/PASSING7.md): the breaking routes caught out
// in front (the slant, the crosser, the dig, the drag), the slant batted at
// the line in round six, the settle routes coming back to the ball and the
// deep corner, the player's tap on the cue (tools/sim/p7find.ts), from the
// default broadcast camera and a close one on the catcher (FOLLOW7).
export const PASSING7: Clip[] = [
  { id: 'p7-slant', title: 'The slant on the cue', seed: 1, play: 'doubles-slants', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 21 }) },
  { id: 'p7-slant-bat', title: 'The slant past the end', seed: 15, play: 'doubles-slants', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 21 }) },
  { id: 'p7-cross', title: 'The crosser on the cue', seed: 1, play: 'trips-y-cross', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 120 }) },
  { id: 'p7-dig', title: 'The dig on the cue', seed: 5, play: 'singleback-drive', def: 'cover3', los: 30, script: userThrow({ icon: 2, at: 96 }) },
  { id: 'p7-drag', title: 'The drag on the cue', seed: 8, play: 'doubles-mesh', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 33 }) },
  // The AI's hitch thrown to a man sat down (round six: he stood under it for 0.47 s, tools/sim/p7settle.ts).
  { id: 'p7-hitch', title: 'The hitch, sat down: working back to it', seed: 2, play: 'doubles-smash', def: 'cover3', los: 30, user: false, script: () => NEUTRAL },
  // Smash against Cover 2: the corner over the squatting corner, outside the half safety, toward the pylon.
  { id: 'p7-corner', title: 'The deep corner on the cue', seed: 4, play: 'doubles-smash', def: 'cover2', los: 30, script: userThrow({ icon: 1, at: 81 }) },
];

// Passing round 8 (docs/passing/PASSING8.md): the catch out at the end of his
// reach (the slant led a stride), the deep ball taken low over the shoulder,
// the QB throwing around a lineman in his lane (the arm slot), and Gronk
// boxing out on a contested ball (tools/sim/p8_clips.ts), from the default
// broadcast camera and a close one (FOLLOW8: on the catcher, or the QB).
export const PASSING8: Clip[] = [
  { id: 'p8-reach', title: 'The slant led a stride: reached for', seed: 1, play: 'doubles-slants', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 21 }) },
  { id: 'p8-low-shoulder', title: 'The deep corner taken low over the shoulder', seed: 5, play: 'doubles-smash', def: 'cover2', los: 30, script: userThrow({ icon: 1, at: 81 }) },
  { id: 'p8-lane', title: 'The slant thrown over the end', seed: 15, play: 'doubles-slants', def: 'cover3', los: 30, script: userThrow({ icon: 1, at: 21 }) },
  { id: 'p8-lane-side', title: 'The corner thrown round the rusher, side-arm', seed: 4, play: 'doubles-smash', def: 'cover3', los: 30, user: false, script: () => NEUTRAL },
  { id: 'p8-box', title: 'The box-out: Gronk on Lott', seed: 3, play: 'trips-y-cross', def: 'cover1', los: 30, user: false, script: () => NEUTRAL, swap: { off: 'TE', name: 'Rob Gronkowski', pos: 'TE' } },
];
