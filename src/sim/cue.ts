// The throw-timing cue (passing round 4, docs/passing/PASSING4.md): when the
// player should press a receiver's key so the ball leaves the QB's hand as
// that man comes out of his break. Read-only: the HUD asks it every few
// frames (GameScene placeHud) and draws the receiver icon's cue ring from
// it. The football isn't touched: this only tells the player the timing the
// route and his QB already have.
//
// The break is when the receiver passes his route's breaking point, found by
// running his route forward on a copy of him on the movement model he really
// runs on (the same roll-forward passing.ts leadRun leads him with: the stem,
// the braking into the break, a jam at the line). A vertical has no break:
// it's thrown off the top of the drop and the hitch, as the AI throws it.
// The ball leaves at the later of the break and the drop's plant (a key on
// the drop throws on the plant: play.ts qbThrow), and the key has to go down
// his release time before that (passing.ts releaseOf: 0.26 s for a quick
// release, 0.45 s for a long one).

import { routeOf, stepRoute } from './ai';
import { steer } from './movement';
import { releaseOf } from './passing';
import { HITCH } from './play';
import { ROUTE_DELAY, type RouteName } from './plays';
import type { PlayState } from './state';
import { TICK, type Agent } from './types';

/**
 * The route point whose passing is the break the ball is timed to (index into
 * the route's points), or 'vert' for a route thrown off the drop. Routes with
 * no entry (screens, the swing, the checkdown, the chip) get no cue: they're
 * thrown when he's there, not on a rhythm.
 * - The stem's top on every breaking route (slant, out, in, dig, curl,
 *   comeback, hitch, stick, post, corner, sail, the quick out and in, the spot,
 *   the sit): the ball comes out as he comes out of it.
 * - The flat and the arrow: as he turns out to the flat; the drag as it flattens.
 * - The crosser, the wheel, the leak, the angle and the option: their second
 *   point, where the route turns into what it is (the climb across, the turn
 *   up the sideline, the break back inside, the read at six yards).
 */
const BREAK_AT: Partial<Record<RouteName, number | 'vert'>> = {
  go: 'vert',
  seam: 'vert',
  fade: 'vert',
  hitch: 0,
  stick: 0,
  slant: 0,
  out: 0,
  dig: 0,
  corner: 0,
  post: 0,
  flat: 0,
  curl: 0,
  drag: 0,
  wheel: 1,
  sit: 0,
  in: 0,
  comeback: 0,
  qout: 0,
  sail: 0,
  cross: 1,
  spot: 0,
  arrow: 0,
  qin: 0,
  leak: 1,
  angle: 1,
  option: 1,
};

/** The longest the cue looks ahead (ticks: 3 s, past any break in the book). */
const LOOK_TICKS = 180;

export interface ThrowCue {
  /** Sim time (s) the ball should be out of his hand: the man's break, or the drop's plant if that's later. */
  ballOut: number;
  /** His release (s): the key goes down this long before ballOut. */
  release: number;
}

/**
 * The cue for a receiver, or null when there's none to give: before the
 * snap, a route with no rhythm, a scramble drill, or once he's past his break
 * (the HUD keeps the last cue it had through the break and after it).
 */
export function throwCue(s: PlayState, rec: Agent): ThrowCue | null {
  if (s.snapT < 0 || s.setup.play.run) return null;
  const rt = rec.route;
  const name = routeOf(s, rec);
  if (!rt || !name || rec.mem.drill) return null;
  const brk = BREAK_AT[name];
  if (brk === undefined) return null;
  const qb = s.agents[s.qb]!;
  const release = releaseOf(qb);
  const drop = s.setup.play.drop;
  // A key on the drop throws on the plant (play.ts qbThrow); the arm can't start before 0.35 s after the snap.
  const plant = s.snapT + (drop.boot ? 0.35 + release : Math.max(drop.set, 0.35 + release));
  if (brk === 'vert') return { ballOut: s.snapT + drop.set + HITCH, release };
  if (rt.idx > brk) return null;
  // Run his route forward on a copy of him (passing.ts leadRun's copy) until he's past the break.
  const g: Agent = { ...rec, pos: { x: rec.pos.x, y: rec.pos.y }, vel: { x: rec.vel.x, y: rec.vel.y }, route: { pts: rt.pts, sit: rt.sit, idx: rt.idx }, mem: { room: rec.mem.room ?? null, window: rec.mem.window ?? null } };
  const delay = ROUTE_DELAY[name];
  let wait = delay !== undefined ? Math.max(0, Math.round((s.snapT + delay - s.t) / TICK)) : 0;
  for (let k = 0; k < LOOK_TICKS; k++) {
    if (g.route!.idx > brk) return { ballOut: Math.max(s.t + k * TICK, plant), release };
    if (wait > 0) {
      wait--;
      steer(g, { x: 0, y: 0 });
    } else if (g.busy > 0) {
      g.busy--;
      steer(g, { x: 0, y: 0 });
    } else if (!stepRoute(g)) return { ballOut: Math.max(s.t + k * TICK, plant), release };
  }
  return null;
}
