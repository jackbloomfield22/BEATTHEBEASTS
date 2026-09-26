// Role behaviors (TECH_PLAN §10 "AI", GDD §10.3–10.4): small functions that
// read the play's shared state (the QB's eyes, the ball, the carrier) and ask
// the movement model for a velocity. Every reaction goes through delayed
// perception, and the delays come from the ratings (Play Recognition, Man
// Coverage, Awareness) plus the difficulty's latency, never from dice alone.

import { atan2, cos, exp, sin } from '@/engine/math/detmath';
import { blockOf, engage } from './blocks';
import { arrive, boundaryGovern, CRUISE, seen, steer } from './movement';
export { boundaryGovern } from './movement';
import { releaseTime } from './effects';
import { driveTime, lead } from './passing';
import { ROUTE_DELAY, ROUTES, ZONES, type OffPlay, type RouteName, type ZoneName } from './plays';
import { DIFFICULTY, zoneSpot, type PlayState } from './state';
import { BACK_X, END_X, FIELD_HALF_W, GOAL_X, type Agent, type OffSlot } from './types';

/** Room a route keeps from the sideline and the end line (yd): a catchable spot, in bounds. */
const ROUTE_ROOM = 1.5;
import { dist, len, norm, sub, v2, type V2 } from './vec';

const latency = (s: PlayState) => DIFFICULTY[s.setup.difficulty ?? 'pro'].latency;

/** Seconds a defender needs to react to what he sees (Play Recognition, difficulty). */
export const reaction = (s: PlayState, d: Agent): number => 0.18 + 0.32 * (1 - d.fx.a('playRec')) + latency(s) + jitter(s, d);

/** reaction() without rolling a jitter that hasn't been rolled yet (read-only). */
const reactionPeek = (s: PlayState, d: Agent): number => 0.18 + 0.32 * (1 - d.fx.a('playRec')) + latency(s) + ((d.mem.jitter as number | undefined) ?? 0);

/** A defender's own read speed on this play: seeded, ±~0.08 s (no two snaps play out alike). */
export function jitter(s: PlayState, d: Agent): number {
  let j = d.mem.jitter as number | undefined;
  if (j === undefined) {
    j = (s.rng.ai() - 0.5) * 0.16;
    d.mem.jitter = j;
  }
  return j;
}

// ---- Offense ----------------------------------------------------------------

/** The route a receiver runs: the play's, unless it was hot-routed at the line. Null for non-receivers. */
export function routeOf(s: PlayState, a: Agent): RouteName | null {
  const as = s.setup.play.assign[a.slot as keyof OffPlay['assign']];
  if (as.kind !== 'route') return null;
  return s.hot[a.slot as OffSlot] ?? as.route;
}

/**
 * A receiver's route in world space from where he stands (the snap uses it;
 * so does the pre-snap route preview, which draws exactly what he'll run).
 * Every point is inside the field with room to catch: 1.5 yd off the
 * sideline (a route near the boundary stems back inside) and short of the
 * end line.
 */
export function routePoints(s: PlayState, a: Agent, as: RouteName | null = routeOf(s, a)): { pts: V2[]; sit: boolean[]; name: RouteName } | null {
  const name = as;
  if (!name) return null;
  const out = a.pos.y >= (s.setup.ballY ?? 0) ? 1 : -1;
  const lim = FIELD_HALF_W - ROUTE_ROOM;
  const raw = ROUTES[name].map((q) => v2(Math.min(END_X - ROUTE_ROOM, a.pos.x + q.d), a.pos.y + q.o * out));
  const sit = ROUTES[name].map((q) => !!q.sit);
  // Third and fourth down: a route that settles short of the sticks works
  // back to them (M6.5 #7), the whole route pushed deeper to settle a half
  // yard past the line to gain (not past 15 yd: a long way to go is the
  // deep routes' job).
  const down = s.setup.down ?? 0;
  const lastD = ROUTES[name][ROUTES[name].length - 1]!.d;
  const push = down >= 3 && sit[sit.length - 1] && s.setup.toGo <= 15 && lastD < s.setup.toGo ? s.setup.toGo + 0.5 - lastD : 0;
  if (push > 0) for (const p of raw) p.x = Math.min(END_X - ROUTE_ROOM, p.x + push);
  const pts = raw.map((p) => v2(p.x, Math.max(-lim, Math.min(lim, p.y))));
  // A route that runs out of field (an out, a flat, an arrow or a wheel
  // from a wide split or the far hash) turns upfield along the boundary
  // ROUTE_ROOM inside it, rather than ending at the sideline.
  const last = raw[raw.length - 1]!;
  if (!sit[sit.length - 1] && Math.abs(last.y) > lim && pts[pts.length - 1]!.x < END_X - ROUTE_ROOM - 1) {
    const at = pts[pts.length - 1]!;
    pts.push(v2(Math.min(END_X - ROUTE_ROOM, at.x + 12), at.y));
    sit.push(false);
  }
  return { pts, sit, name };
}

/** Build each receiver's route in world space at the snap. */
export function setRoutes(s: PlayState): void {
  for (const i of s.off) {
    const a = s.agents[i]!;
    const r = routePoints(s, a);
    if (r) a.route = { pts: r.pts, sit: r.sit, idx: 0 };
  }
}

/**
 * Direction to keep running once a route's last point is behind him: the
 * route's last leg, turned upfield as he nears the sideline (receivers work
 * up the boundary; they don't run out of bounds).
 */
export function continueDir(at: V2, p0: V2, p1: V2): V2 {
  // At the back of the end zone: settle along the end line, working back inside.
  if (at.x > END_X - ROUTE_ROOM - 0.5) return { x: 0, y: -Math.sign(at.y) * 0.35 };
  const dir = norm(sub(p1, p0));
  const room = FIELD_HALF_W - Math.abs(at.y);
  if (room < 6 && Math.sign(dir.y) === Math.sign(at.y)) {
    const k = Math.max(0, room - 1.5) / 4.5; // 1 → keep the leg, 0 → straight upfield (the turn starts ~6 yd out: at speed it takes that long to round)
    return norm({ x: dir.x * k + (1 - k), y: dir.y * k });
  }
  return dir;
}

/**
 * The share of his top speed a route runner carries through a break whose
 * legs meet at cos `c`: full speed through a bend, ~40% round a right angle
 * (a plant), ~25% turning back (a hitch, a curl), a sharp route runner a
 * little more. The throw's lead (passing.ts lead) uses the same, so a ball
 * thrown before the break meets him at speed coming out of it.
 */
export function breakCarry(a: Agent, c: number): number {
  const rr = Math.max(a.fx.a('shortRoute'), a.fx.a('deepRoute'), a.fx.a('routeRunning'));
  const c90 = 0.3 + 0.15 * rr;
  const c180 = 0.15 + 0.1 * rr;
  return c >= 0 ? c90 + (1 - c90) * c : c180 + (c90 - c180) * (1 + c);
}

/** A settled receiver reads defenders within this (yd) and slides up to WINDOW_SLIDE away from the nearest, into the open window. */
const WINDOW_SEE = 5;
const WINDOW_SLIDE = 1.5;

/** A break sharper than this (cos between the legs) is a plant. */
const PLANT_COS = 0.7;

/** Within this of a route's break point (yd) and moving away from it, he's made the break. */
const BREAK_PASS = 2;

/** Run the route: stem at pace, sharp breaks for good route runners, settle on sits. */
export function runRoute(s: PlayState, a: Agent): void {
  const rt = a.route;
  if (!rt) return;
  if (a.busy > 0) {
    // Jammed at the line: fighting to get off press.
    steer(a, { x: 0, y: 0 });
    return;
  }
  // The scramble drill: once the QB's on the move, the short and
  // intermediate men break off and work across to the side he's running to,
  // settling in open grass in front of him; the deep men keep going deep.
  // It starts when the QB has actually left the pocket (still a passer) or
  // tucked it, a beat after (M6.5 #7: only a tuck started it, so a QB
  // rolling out to throw had his receivers run on away from him), and the
  // short men come back toward the ball.
  const out = s.escapeT >= 0 ? s.escapeT : s.scrambleT;
  if (out >= 0 && s.t - out > 0.25 && s.phase === 'pocket' && !a.mem.drill) {
    a.mem.drill = true;
    const qb = s.agents[s.qb]!;
    const depth = a.pos.x - s.setup.los;
    if (depth < 15) {
      const y = qb.pos.y + Math.max(-12, Math.min(12, (a.pos.y - qb.pos.y) * 0.5));
      const x = s.setup.los + Math.max(3, Math.min(12, depth - 2));
      a.route = { pts: [v2(x, Math.max(-FIELD_HALF_W + ROUTE_ROOM, Math.min(FIELD_HALF_W - ROUTE_ROOM, y)))], sit: [true], idx: 0 };
    }
  }
  // A late release (the slip screen's back): show pass protection first.
  const name = routeOf(s, a);
  const delay = name ? ROUTE_DELAY[name] : undefined;
  if (delay !== undefined && s.t - s.snapT < delay) {
    steer(a, { x: 0, y: 0 }, { face: 0 });
    a.anim = 'block';
    return;
  }
  const rr = Math.max(a.fx.a('shortRoute'), a.fx.a('deepRoute'), a.fx.a('routeRunning'));
  if (rt.idx < rt.pts.length) {
    const q = rt.pts[rt.idx]!;
    // Better route runners go deeper into the break before turning (sharper cuts).
    const early = 0.9 - 0.65 * rr;
    // A break he runs by at speed is still made: once he's close and moving
    // away from the point, it's behind him (M6.5 #2: he had to touch it
    // within `early`, 0.3 yd for a sharp route runner, so a slant runner
    // who came by it half a yard wide braked, turned round and went back to
    // it, and the best route runners stopped mid-route the most:
    // tools/sim/routefid.ts).
    const k = dist(a.pos, q);
    const past = !rt.sit[rt.idx] && k < BREAK_PASS && a.vel.x * (q.x - a.pos.x) + a.vel.y * (q.y - a.pos.y) < 0;
    if (k < (rt.sit[rt.idx] ? 0.25 : early) || past) {
      rt.idx++;
      // The plant: at a hard break his foot takes the momentum and sends him
      // down the new leg at the speed he brought into it (M6.5 #6: steering
      // alone swung his run round over half a second, so out of a right-angle
      // break he drifted a yard and a half on up the stem at 3 yd/s).
      const nx = rt.pts[rt.idx];
      const sp = len(a.vel);
      if (nx && sp > 1) {
        const w = norm(sub(nx, a.pos));
        const c = (a.vel.x * w.x + a.vel.y * w.y) / sp;
        if (c < PLANT_COS) {
          const vb = Math.min(sp, breakCarry(a, c) * a.fx.vmax);
          a.vel = { x: w.x * vb, y: w.y * vb };
        }
      }
    }
  }
  if (rt.idx < rt.pts.length) {
    const q = rt.pts[rt.idx]!;
    const sit = rt.sit[rt.idx];
    // Stem at ~90% selling the vertical, full speed after the break. Into a
    // real break (the next leg turns 35°+) he sinks his hips over the last
    // couple of yards: a sharp route runner gives up less speed there (~85%
    // of his stem), a poor one more (~65%). The break is where the time goes:
    // an NFL 10-yard out comes out of its break ~1.8 s after the snap.
    let pace = rt.idx === 0 ? 0.92 : 1;
    const nx = rt.pts[rt.idx + 1];
    if (nx && !sit) {
      // Into the break at the speed he can carry through it, braking in
      // time: full speed through a bend, ~60% of top speed round a right
      // angle, ~25% turning back (a hitch, a curl), a sharp route runner a
      // little more. M6.5 #2: M6 came into every break at ~80% from 2.2 yd
      // out, so a hitch runner took ~3 yd to stop and turned back from 8
      // or 9 to settle at 5 (tools/sim/routefid.ts).
      const p0 = rt.idx > 0 ? rt.pts[rt.idx - 1]! : a.pos;
      const u = norm(sub(q, p0));
      const w = norm(sub(nx, q));
      const vb = breakCarry(a, u.x * w.x + u.y * w.y) * a.fx.vmax;
      const cap = Math.sqrt(vb * vb + 2 * a.fx.cutAccel * 0.8 * dist(a.pos, q));
      pace = Math.min(pace, cap / a.fx.vmax);
    }
    const want = sit ? arrive(a, q, 1, 1) : arrive(a, q, pace);
    steer(a, boundaryGovern(a, want, ROUTE_ROOM - 0.3), {});
    return;
  }
  // Settled on a sit route: face the QB and work to the open window. He
  // slides a step or two across, away from the nearest defender, never more
  // than WINDOW_SLIDE off his spot (M6.5 #7: he stood still wherever the
  // spot was, even with a linebacker sitting on it).
  if (rt.sit[rt.pts.length - 1]) {
    const qb = s.agents[s.qb]!;
    const home = rt.pts[rt.pts.length - 1]!;
    let near: Agent | null = null;
    let nd = WINDOW_SEE;
    for (const i of s.def) {
      const d = s.agents[i]!;
      if (d.down) continue;
      const k = dist(d.pos, a.pos);
      if (k < nd) {
        nd = k;
        near = d;
      }
    }
    let to = home;
    if (near) {
      const side = a.pos.y >= near.pos.y ? 1 : -1;
      to = v2(home.x, Math.max(-FIELD_HALF_W + ROUTE_ROOM, Math.min(FIELD_HALF_W - ROUTE_ROOM, home.y + side * WINDOW_SLIDE)));
    }
    steer(a, dist(a.pos, to) > 0.3 ? arrive(a, to, 0.45, 0.8) : { x: 0, y: 0 }, { face: atan2(qb.pos.y - a.pos.y, qb.pos.x - a.pos.x) });
    return;
  }
  // Past the last point: keep running the line, bending away from the sideline.
  const n = rt.pts.length;
  const p0 = n > 1 ? rt.pts[n - 2]! : a.pos;
  const p1 = rt.pts[n - 1]!;
  const dir = continueDir(a.pos, p0, p1);
  steer(a, boundaryGovern(a, { x: dir.x * a.fx.vmax, y: dir.y * a.fx.vmax }, ROUTE_ROOM - 0.3));
}

/** Rushers the protection is responsible for (defenders coming), nearest-lateral assignment. */
export function assignProtection(s: PlayState): void {
  const rushers = s.def.filter((i) => s.setup.def.assign[s.agents[i]!.slot as keyof typeof s.setup.def.assign].kind === 'rush');
  // The draw's line pass-sets too (it's the look that sells it).
  const draw = s.setup.play.run?.scheme === 'draw';
  const blockers = s.off.filter((i) => {
    const a = s.agents[i]!;
    const k = s.setup.play.assign[a.slot as keyof OffPlay['assign']].kind;
    return k === 'passBlock' || (draw && k === 'runBlock' && a.p.pos === 'OL');
  });
  const taken = new Set<number>();
  // Each rusher gets the nearest free blocker by lateral position.
  const byY = [...rushers].sort((p, q) => s.agents[q]!.pos.y - s.agents[p]!.pos.y);
  for (const r of byY) {
    const R = s.agents[r]!;
    let best = -1;
    let bd = Infinity;
    for (const b of blockers) {
      if (taken.has(b)) continue;
      const d = Math.abs(s.agents[b]!.pos.y - R.pos.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best >= 0) {
      taken.add(best);
      s.agents[best]!.mem.man = r;
    }
  }
  // The rest help: the rusher closest to them.
  for (const b of blockers) {
    if (taken.has(b)) continue;
    const B = s.agents[b]!;
    let best = -1;
    let bd = Infinity;
    for (const r of rushers) {
      const d = dist(B.pos, s.agents[r]!.pos);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    B.mem.man = best;
    B.mem.help = true;
  }
}

/** Pass protection: kick-slide to a spot between the rusher and the QB, then engage. */
export function passBlock(s: PlayState, b: Agent): void {
  if (blockOf(s, b.i) || b.busy > 0) {
    if (!blockOf(s, b.i)) steer(b, { x: 0, y: 0 });
    return;
  }
  const qb = s.agents[s.qb]!;
  const man = (b.mem.man as number | undefined) ?? -1;
  let r = man >= 0 ? s.agents[man]! : null;
  // My man is taken (a double) or down: pick up the most dangerous free rusher.
  if (!r || r.down || (blockOf(s, r.i) && b.mem.help)) {
    let best: Agent | null = null;
    let bd = 5;
    for (const i of s.def) {
      const d = s.agents[i]!;
      if (d.down || blockOf(s, d.i) || !blockable(s, d) || d.pos.x > s.setup.los + 6) continue;
      const k = dist(d.pos, qb.pos);
      if (k < bd) {
        bd = k;
        best = d;
      }
    }
    r = best;
  }
  if (!r) {
    // Nobody to block: set up in front of the QB.
    steer(b, arrive(b, v2(qb.pos.x + 2.2, b.pos.y * 0.6 + qb.pos.y * 0.4), 0.5, 1), { face: 0 });
    return;
  }
  const toR = sub(r.pos, qb.pos);
  const dr = Math.max(0.5, len(toR));
  const depth = Math.min(dr * 0.55, 3.2);
  const spot = v2(qb.pos.x + (toR.x / dr) * depth, qb.pos.y + (toR.y / dr) * depth);
  // Hold the spot, but never retreat past the QB.
  if (spot.x < qb.pos.x + 1.2) spot.x = qb.pos.x + 1.2;
  steer(b, arrive(b, spot, 0.75, 1.2), { face: atan2(r.pos.y - b.pos.y, r.pos.x - b.pos.x) });
  if (!blockOf(s, r.i) && blockable(s, r) && dist(b.pos, r.pos) < b.fx.radius + r.fx.radius + 0.3) engage(s, b, r, 'pass');
}

/** A defender who just shed a block can't be picked up again for a beat. */
export const blockable = (s: PlayState, d: Agent): boolean => s.t - ((d.mem.shedAt as number | undefined) ?? -9) > (s.carrier >= 0 ? 0.8 : REPICK) && !d.down;
/** A rusher who's just beaten his man can be picked up by a help blocker (a guard sliding over, the back) this soon after (M5.5: 1.6 s). */
/** A rusher who's just beaten his man can be picked up by a help blocker (a guard sliding over, the back) this soon after, s (M5.5: 1.6 s, i.e. never in a dropback). With M6's faster rush, the help is what keeps a no-throw pocket near 4 s. */
const REPICK = 0.75;

/** How far past the bodies a block lands (yd). */
const ENGAGE_REACH = 0.5;

/**
 * Run blocking (and stalk blocks downfield): pick the nearest threat to the
 * play and drive him. `downfield`: only defenders in front of the carrier,
 * engaged from between them and the ball.
 */
export function runBlock(s: PlayState, b: Agent, toward: V2, downfield = false, engageOk = true): void {
  if (blockOf(s, b.i) || b.busy > 0) {
    if (!blockOf(s, b.i)) steer(b, { x: 0, y: 0 });
    return;
  }
  let tgt = (b.mem.target as number | undefined) ?? -1;
  if (tgt < 0 || s.agents[tgt]!.down || blockOf(s, tgt)) {
    let best = -1;
    let bd = Infinity;
    for (const i of s.def) {
      const d = s.agents[i]!;
      if (d.down || blockOf(s, i) || !blockable(s, d)) continue;
      // Downfield: the defenders who can still get to the play (in front of it, within ~15 yd: a pursuer's two seconds).
      if (downfield && (d.pos.x < toward.x - 1 || dist(d.pos, toward) > 15)) continue;
      // Threat: close to me, closer to the play.
      const k = dist(d.pos, b.pos) + 0.6 * dist(d.pos, toward);
      if (k < bd && d.pos.x > b.pos.x - 2) {
        bd = k;
        best = i;
      }
    }
    tgt = best;
    b.mem.target = tgt;
  }
  if (tgt < 0) {
    steer(b, arrive(b, toward, CRUISE));
    return;
  }
  const d = s.agents[tgt]!;
  // Get between him and the ball carrier, where he's going (lead a flowing
  // linebacker by the time it takes to get to him, not chase him from behind).
  const lead = Math.min(0.6, dist(b.pos, d.pos) / Math.max(4, b.fx.vmax));
  const px = d.pos.x + d.vel.x * lead;
  const py = d.pos.y + d.vel.y * lead;
  const mid = v2(px - 0.4, py + (toward.y - py) * 0.15);
  steer(b, arrive(b, mid, 0.95));
  // Downfield, a block only lands from between him and the ball (else it's a block in the back).
  const between = !downfield || (b.pos.x - d.pos.x) * (toward.x - d.pos.x) + (b.pos.y - d.pos.y) * (toward.y - d.pos.y) > 0;
  // A block lands at arm's length (hands to the chest): the bodies ~0.5 yd apart
  // (M6.5 #8: at 0.25, receivers and climbing linemen ran past a man coming
  // at them without touching him; 29% of the 1–4 yd runs were ended by a
  // defender a blocker was assigned to and never reached, tools/sim/rundiag.ts).
  if (engageOk && between && blockable(s, d) && dist(b.pos, d.pos) < b.fx.radius + d.fx.radius + ENGAGE_REACH) {
    // Getting a hat on a man moving in space: the faster he's going across
    // the blocker and the quicker he is than the blocker, the likelier the
    // whiff (a lineman climbing to a flowing linebacker, a receiver on a
    // corner coming downhill). Square-on at the line it always fits.
    const u = norm(sub(d.pos, b.pos));
    const rx = d.vel.x - b.vel.x;
    const ry = d.vel.y - b.vel.y;
    const across = Math.abs(rx * u.y - ry * u.x);
    const inSpace = downfield || d.pos.x > s.setup.los + 1.5;
    const fit = Math.max(0.3, Math.min(1, 1.05 - 0.12 * Math.max(0, across - 1) + 0.35 * (b.fx.a('agility') - d.fx.a('agility'))));
    if (inSpace && s.rng.block() > fit) {
      // Whiffed: he lunges and loses a beat; the defender runs past.
      b.busy = Math.max(b.busy, 16);
      b.mem.target = -1;
      d.mem.shedAt = s.t - 0.6;
      s.events.push({ t: s.t, type: 'shed', who: [d.i, b.i], data: { whiff: true } });
      return;
    }
    engage(s, b, d, 'run');
    b.mem.driveY = (b.mem.drive as number | undefined) ?? Math.sign(d.pos.y - toward.y) * 0.4;
  }
}

/**
 * Openness of a receiver for a throw now: the catch point for that kind of
 * throw, the ball's flight time, and the margin in yards by which the ball
 * beats the nearest defender there (his time to the spot against the ball's).
 */
/**
 * How open a receiver is for a throw now: the separation (yd) from the
 * nearest defender when the ball would get there, less the lanes it would
 * pass through. `peek` reads without touching the play's state (the HUD
 * calls it every frame): a defender whose read jitter hasn't been rolled
 * yet counts as zero rather than rolling it.
 */
export function openness(s: PlayState, qb: Agent, r: Agent, peek = false, why?: string[]): { sep: number; at: V2; T: number } {
  const react = (d: Agent) => (peek ? reactionPeek(s, d) : reaction(s, d));
  const power = qb.fx.r('throwPower');
  const rel = releaseTime(qb.fx.r('release'));
  // The throw he'd make: the driven ball (planThrow's hang time), after his release.
  let at = lead(r, 0.8);
  let T = 0.8;
  for (let k = 0; k < 3; k++) {
    T = driveTime(dist(qb.pos, at), power) + 0.05 + rel;
    at = lead(r, T);
  }
  // A defender's clock on the throw: a zone defender near the man reads the
  // wind-up (jumpThrow), everyone else the ball leaving his hand; then his
  // read time. From there he runs by the sprint model the movement runs on,
  // from the speed he already has that way (M6: M5.5 had every defender at
  // 0.8 of top speed from the moment the QB decided, about twice what a man
  // standing in his zone covers in the first second, so every curl against
  // a zone read as covered and the QB threw nothing but checkdowns).
  const run = (d: Agent, to: V2, t: number): { gap: number; closing: number } => {
    const as = s.setup.def.assign[d.slot as keyof typeof s.setup.def.assign];
    const jumps = as.kind === 'zone' && dist(d.pos, r.pos) <= JUMP_READ;
    const rt0 = react(d) + (jumps ? 0 : rel);
    const carry = Math.min(t, rt0);
    const px = d.pos.x + d.vel.x * carry;
    const py = d.pos.y + d.vel.y * carry;
    const tRun = Math.max(0, t - rt0);
    const dx = to.x - px;
    const dy = to.y - py;
    const gap = Math.sqrt(dx * dx + dy * dy);
    const v0 = gap > 1e-6 ? Math.min(d.fx.vmax, Math.max(0, (d.vel.x * dx + d.vel.y * dy) / gap)) : 0;
    return { gap, closing: tRun > 0 ? d.fx.vmax * tRun - (d.fx.vmax - v0) * d.fx.tau * (1 - exp(-tRun / d.fx.tau)) : 0 };
  };
  let sep = 99;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down) continue;
    const { gap, closing } = run(d, at, T);
    if (why && gap - closing < sep) why.push(`${d.slot} ${gap.toFixed(1)}-${closing.toFixed(1)}`);
    sep = Math.min(sep, gap - closing);
  }
  // Throwing lanes: a defender who can get to the ball's path, and reach
  // it there, before it passes can undercut it (a ball high over him is
  // gone). Better decision makers see it; worse ones throw into it. The
  // worst lane counts (M6: it used to add up over every defender and point,
  // so a crowded middle read as −10 yd). Engaged linemen aren't lanes.
  const see = 0.4 + 0.6 * qb.fx.a('decision');
  const air = Math.max(0.2, T - rel);
  const z0 = 2.15 * (qb.fx.height / 2.08);
  let lane = 0;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down || blockOf(s, i)) continue;
    const top = d.fx.height * 1.28 + d.fx.a('jumping') * 0.35 + 0.15;
    for (const f of [0.4, 0.6, 0.8]) {
      // The ball's height there (the driven arc, vacuum: G ≈ 10.7 yd/s²).
      const z = z0 + (1.25 - z0) * f + 0.5 * 10.7 * air * air * f * (1 - f);
      if (z > top) continue;
      const p = { x: qb.pos.x + (at.x - qb.pos.x) * f, y: qb.pos.y + (at.y - qb.pos.y) * f };
      const { gap, closing } = run(d, p, rel + air * f);
      const short = closing + 0.5 - gap;
      if (short > 0) lane = Math.max(lane, short);
    }
  }
  sep -= lane * 0.5 * see;
  if (why) why.push(`lane ${(lane * 0.5 * see).toFixed(1)} T ${T.toFixed(2)}`);
  // Before his break a receiver isn't a target yet (go routes once they're
  // past 12 yards); sit routes are open once he settles.
  const rt = r.route;
  if (rt && rt.idx === 0 && !(rt.pts.length === 1 && r.pos.x - s.setup.los > 12)) sep -= 1.5;
  // Out of bounds catch points aren't open.
  if (Math.abs(at.y) > FIELD_HALF_W - 0.8) sep -= 3;
  return { sep, at, T };
}

/**
 * The margin a deep ball needs past 10 yd downfield (the longer it hangs,
 * the more a small misread costs; NFL QBs throw ~11–12% of attempts 20+ air
 * yards and complete ~35–45% of them). M5.5 wanted a yard more per 20; with
 * M6's physical openness (the closing defenders by the sprint model) and
 * the higher base window, a fifth of a yard per 20 keeps the deep share.
 */
const deepRisk = (s: PlayState, at: V2): number => Math.max(0, at.x - s.setup.los - 10) * DEEP;
/** Tuned with the harness (M6) so ~12% of completions go 20+ and aDOT sits ~8.5 (NFL ~8). */
const DEEP = 0.01;

/**
 * The longest a QB waits on a read for its break (s). A route's stem runs
 * ~0.8–1.4 s; a timing throw leaves on the break, and a QB who's still
 * waiting half a second later has seen it isn't there.
 */
const BREAK_WAIT = 0.5;
/** A zone defender this close to the man the QB turns to reads the wind-up (play.ts jumpThrow's JUMP_R). */
const JUMP_READ = 8;
/** Behind the line, how much a yard off the run's aiming point costs a lane (carrierAI). */
const AIM_PULL = 0.35;
/** How far the window he'll take comes down as he holds it (yd, from a second after the set at 0.6 yd/s): a QB with nothing on schedule takes a tighter window rather than a sack. */
const LATE_MAX = 1.5;
/** How far (yd) an underneath zone defender walls or matches off his landmark before the man is someone else's. */
const ZW = 4;
/** The window the AI QB wants on schedule: yd of separation at the catch point by openness() (M6's physical closing). Tuned with the harness: 3.75 gives ~2.4 s to throw (NFL ~2.7), ~63% completion and ~5% sacks against the all-time Beasts. */
const NEED = 3.75;

/** Where the QB AI throws: his read progression, earlier throws when pressured. Returns the icon index (0-based) or −1. */
export function qbRead(s: PlayState, qb: Agent, pressure: number): number {
  const readTime = 0.55 - 0.3 * qb.fx.a('awareness');
  const icons = s.icons;
  if (icons.length === 0) return -1;
  const since = s.t - s.read.since;
  const cur = s.read.idx % icons.length;
  const r = s.agents[icons[cur]!]!;
  const o = openness(s, qb, r);
  // Decision noise: worse decision makers misjudge windows.
  // Misjudging the window: one read of each man, held for as long as he's
  // on it (re-rolling every tick would let him wait for a lucky roll). Even
  // the best misread a yard now and then (NFL QBs throw ~15% of attempts
  // into tight windows and leave open men on ~10% of dropbacks, NGS); a poor
  // decision maker by twice that.
  if (s.read.noiseFor !== s.read.idx) {
    s.read.noiseFor = s.read.idx;
    s.read.noise = (0.9 + 1.4 * (1 - qb.fx.a('decision'))) * (s.rng.ai() - 0.5);
  }
  const noise = s.read.noise;
  // The clock in his head: past ~2.2 s from the set he takes what's there.
  const held = s.t - s.snapT - s.setup.play.drop.set;
  // The window he wants (yd of separation at the catch point, after the
  // closing defenders): a step. NFL QBs throw ~15% of attempts into tight
  // windows (NGS "aggressiveness"). Round two's driven ball (0.6 s to 10 yd,
  // slower than M5.5's bullet) reads every window a little tighter; the
  // bar came down from 0.7 to 0 to keep sacks at M5.5's ~9% of dropbacks.
  const need = NEED - 1.1 * pressure - Math.min(LATE_MAX, Math.max(0, held - 1) * 0.6);
  s.eyes = { x: r.pos.x, y: r.pos.y };
  // The progression runs once, in time with the routes: a deep read that
  // wasn't there on schedule isn't come back to late (a QB who's been through
  // his reads checks it down or scrambles; he doesn't throw a go route 3 s in
  // unless the man is running free).
  const late = s.read.idx >= icons.length;
  const risk = deepRisk(s, o.at) * (late ? 2.5 : 1);
  // A screen goes to its man on schedule unless a defender is on him (it's
  // built on blockers in front of him, not on separation).
  const screen = s.setup.play.type === 'screen' && cur === 0 && s.t - s.snapT >= s.setup.play.drop.set;
  // The concept is built for the first reads: he'll put those into a tighter
  // window on time (anticipation) than he'd want for the outlet.
  const primary = cur === 0 ? 0.45 : cur === 1 ? 0.2 : 0;
  if (screen ? o.sep + noise > -0.5 : o.sep + noise > need + risk - primary) return cur;
  // He stays on a read until the route declares itself (the receiver's
  // break: the ball comes out as he comes out of it), up to half a second
  // past his read time; then he moves on. A progression ahead of its routes
  // reads every man before he's open.
  const rt = r.route;
  const breaking = !!rt && rt.idx === 0 && (rt.pts.length > 1 ? true : r.pos.x - s.setup.los < 12);
  if (since > readTime && !(breaking && since < readTime + BREAK_WAIT && !late)) {
    s.read.idx++;
    s.read.since = s.t;
  }
  // Under heavy pressure or out of time: the best available, or nothing (throw it away / take it).
  if (pressure > 0.85 || held > 2.2) {
    let best = -1;
    let bs = -Infinity;
    icons.forEach((k, j) => {
      const oq = openness(s, qb, s.agents[k]!);
      const q = oq.sep - deepRisk(s, oq.at) * 2.5;
      if (q > bs) {
        bs = q;
        best = j;
      }
    });
    return bs > 0.3 ? best : -1;
  }
  return -1;
}

/**
 * Pressure on the QB 0..1: the closest free defender (within ~4.5 yd), and
 * a pocket collapsing on him (an engaged rusher driven into his lap counts,
 * at most 0.6: a bull rush that's put the guard in the QB's feet is
 * pressure, NGS's "pressure" is any defender getting that close).
 */
/** A rusher still engaged but driven within this of the QB (yd) starts to count as pressure: the pocket collapsing. */
const COLLAPSE = 1.4;
export function pressureOn(s: PlayState, qb: Agent): number {
  let p = 0;
  for (const i of s.def) p = Math.max(p, pressureFrom(s, qb, i));
  return Math.min(1, p);
}

/** One defender's share of pressureOn (0 when he's down). */
export function pressureFrom(s: PlayState, qb: Agent, i: number): number {
  const d = s.agents[i]!;
  if (d.down) return 0;
  const k = dist(d.pos, qb.pos);
  if (blockOf(s, i)) return 0.6 * Math.max(0, Math.min(1, 1 - (k - COLLAPSE) / 1.6));
  return Math.max(0, 1 - (k - 1) / 3.5);
}

/** Ball-carrier AI: pick the best running lane toward the goal line. */
export function carrierAI(s: PlayState, c: Agent, attack: 1 | -1): V2 {
  // Refresh his lane misreads every 0.3 s.
  if (s.tick % 18 === 0) for (let k = -6; k <= 6; k++) c.mem[`lane${k}`] = (s.rng.ai() - 0.5) * 2;
  const goalX = attack > 0 ? GOAL_X : 0;
  let best: V2 = { x: attack, y: 0 };
  let bestScore = -Infinity;
  for (let k = -6; k <= 6; k++) {
    const ang = (k / 6) * 1.25;
    const dir = { x: attack * cos(ang), y: sin(ang) };
    // Behind the line, going sideways costs yards: get north (and to the
    // play's aiming point on a designed run).
    const behind = (s.setup.los - c.pos.x) * attack > -0.5;
    let score = dir.x * attack * (behind ? 5 : 2.2);
    const aimY = s.setup.play.run && c.slot === 'RB' ? (s.setup.ballY ?? 0) + s.setup.play.run.aim : null;
    // (M6: 0.35 a yard let inside runs bounce to the sideline a third of the time; a back on inside zone reads front side to cutback and rarely leaves the tackle box.)
    if (behind && aimY !== null) {
      score -= Math.abs(c.pos.y + dir.y * 3 - aimY) * AIM_PULL;
      // The run's width: an inside run stays in the tackle box (within ~4 yd of its aiming point), an outside one ~8 (the bounce is the exception, not the read).
      const wide = s.setup.play.run!.scheme === 'outsideZone' || s.setup.play.run!.scheme === 'toss' ? 8 : 4;
      const off = Math.abs(c.pos.y + dir.y * 3 - aimY) - wide;
      if (off > 0) score -= off * 2.5;
    }
    let threats = 0;
    for (const i of attack > 0 ? s.def : s.off) {
      const d = s.agents[i]!;
      if (d.down) continue;
      const rel = sub(d.pos, c.pos);
      const along = rel.x * dir.x + rel.y * dir.y;
      if (along < -1) continue;
      const perp = Math.abs(rel.x * dir.y - rel.y * dir.x);
      const reachT = Math.max(0.1, along / Math.max(1, len(c.vel)));
      // How far he can get to the lane: a free man by his speed; a man
      // engaged with a blocker only his arms, until he's about to shed
      // (leverage past 0). A back with Vision sees the blocks for what they
      // are; a poor one runs from them as if they were free.
      const free = d.fx.vmax * reachT * 0.9;
      const blk = blockOf(s, i);
      const held = blk ? 0.9 + Math.max(0, blk.lev) * free * 0.6 : free;
      const reach = held + (free - held) * (1 - c.fx.a('vision')) * 0.6;
      const threat = Math.max(0, reach + 1.2 - perp) / (1 + along * 0.15);
      score -= threat * 1.1;
      threats += threat;
    }
    const side = c.pos.y + dir.y * 5;
    if (Math.abs(side) > FIELD_HALF_W - 1.5) score -= 3;
    // Never through the line: a lane that runs him out within a couple of strides is out.
    if (Math.abs(c.pos.y + dir.y * 2) > FIELD_HALF_W - 0.6) score -= 8;
    if (dir.x * attack > 0 && c.pos.x + dir.x * 2 > END_X) score -= 8;
    // Reads aren't perfect: a lower Vision misjudges lanes (held per lane for
    // a beat). What he misjudges is the defenders: in open grass there's
    // nothing to misread (M6.5 #4: the misread was on every lane, so a
    // receiver with no one within 50 yd ran off at 70° as often as upfield).
    score += ((c.mem[`lane${k}`] as number | undefined) ?? 0) * (1.6 - 1.3 * c.fx.a('vision')) * Math.min(1, threats);
    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  void goalX;
  // Pinned on the sideline with a tackler closing: step out rather than take the hit.
  const room = FIELD_HALF_W - Math.abs(c.pos.y);
  if (room < 2 && (c.pos.x - s.setup.los) * attack > 2) {
    for (const i of attack > 0 ? s.def : s.off) {
      const d = s.agents[i]!;
      if (d.down || blockOf(s, i)) continue;
      if (dist(d.pos, c.pos) < 2.2) return { x: attack * c.fx.vmax * 0.4, y: Math.sign(c.pos.y) * c.fx.vmax * 0.9 };
    }
  }
  return { x: best.x * c.fx.vmax, y: best.y * c.fx.vmax };
}

// ---- Defense ----------------------------------------------------------------

/**
 * Earliest point where a chaser at speed `v` meets a target holding its
 * velocity: |p + vt·τ − c| = v·τ. Null when he can't (the target is faster
 * and running away).
 */
export function intercept(c: V2, v: number, p: V2, vt: V2): V2 | null {
  const rx = p.x - c.x;
  const ry = p.y - c.y;
  const a = vt.x * vt.x + vt.y * vt.y - v * v;
  const b = 2 * (rx * vt.x + ry * vt.y);
  const cc = rx * rx + ry * ry;
  let tau: number;
  if (Math.abs(a) < 1e-6) tau = b < 0 ? -cc / b : -1;
  else {
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    tau = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
    if (!Number.isFinite(tau)) return null;
  }
  if (tau < 0) return null;
  return { x: p.x + vt.x * tau, y: p.y + vt.y * tau };
}

/**
 * How much of his reaction time a pursuer sees the runner late by. M6.5 #4
 * tried the whole of it (a cut read ~0.2 s late): short-route YAC went from
 * 6.4 to 8.2 and runs to 5.6 a carry, past both targets, so the pursuit
 * angles weren't the missing YAC threat (tools/sim/throws.ts, runhist.ts).
 */
const PURSUIT_LAG = 0.4;

/**
 * A tackler's breakdown pace in front of a runner (share of top speed).
 * M6.5 #8: flying at him flat out, defensive backs in the open field went
 * by at 1.5–2.5 yd without a try on ~40% of meetings (tools/sim/rundiag.ts).
 */
const BREAKDOWN = 0.6;

/**
 * Chase a ball carrier. A good pursuer takes the cut-off angle (the intercept
 * point); a poor one chases where the runner is, and ends up trailing (Pursuit).
 */
export function pursue(s: PlayState, d: Agent, t: Agent): void {
  // What he saw a beat ago, projected to now (M6: the old sighting itself was chased, so a pursuer arriving from the side aimed a yard behind the runner and missed him by that).
  const lag = reaction(s, d) * PURSUIT_LAG;
  const seen0 = seen(t, lag);
  const seenT = { pos: { x: seen0.pos.x + seen0.vel.x * lag, y: seen0.pos.y + seen0.vel.y * lag }, vel: seen0.vel };
  // Where he's going: a runner in space goes flat out for the goal line
  // (carrierPace), so take the angle for a man at ~90% of his top speed
  // upfield, blended with what he's doing now (a shallower angle leaves the
  // pursuer trailing a man as fast as he is).
  const attack = t.side === 'off' ? 1 : -1;
  const upNow = seenT.vel.x * attack;
  const upSoon = Math.max(upNow, 0.9 * t.fx.vmax);
  const vt = { x: attack * (upNow + (upSoon - upNow) * 0.7), y: seenT.vel.y * 0.7 };
  const cut = intercept(d.pos, d.fx.vmax * 0.95, seenT.pos, vt);
  const k = 0.35 + 0.65 * d.fx.a('pursuit');
  const naive = { x: seenT.pos.x + vt.x * 0.25, y: seenT.pos.y + vt.y * 0.25 };
  const aim = cut ? { x: naive.x + (cut.x - naive.x) * k, y: naive.y + (cut.y - naive.y) * k } : { x: seenT.pos.x + vt.x * 0.6, y: seenT.pos.y + vt.y * 0.6 };
  const close = dist(d.pos, seenT.pos);
  // Beaten (behind the runner's line of run): he still takes his angle
  // downfield, but on his own side of the runner, behind him and never
  // across or through him to cut him off (round-two feedback). The meeting
  // point is pushed out to his side; one he can't reach is chased from behind.
  const vl = Math.sqrt(vt.x * vt.x + vt.y * vt.y);
  if (vl > 3 && close > 1.2) {
    const ux = vt.x / vl;
    const uy = vt.y / vl;
    const rx = d.pos.x - seenT.pos.x;
    const ry = d.pos.y - seenT.pos.y;
    if (rx * ux + ry * uy < -0.5) {
      const side = rx * -uy + ry * ux >= 0 ? 1 : -1;
      const tgt = cut ? aim : { x: seenT.pos.x + ux * 0.3 * vl * 0.3, y: seenT.pos.y + uy * 0.3 * vl * 0.3 };
      const lat = (tgt.x - seenT.pos.x) * -uy + (tgt.y - seenT.pos.y) * ux;
      const push = Math.max(0, 0.8 - lat * side);
      const at = { x: tgt.x - uy * side * push, y: tgt.y + ux * side * push };
      const dir = norm(sub(at, d.pos));
      steer(d, { x: dir.x * d.fx.vmax, y: dir.y * d.fx.vmax });
      return;
    }
  }
  // Inside-out: a step inside him, and never aim out of bounds (the sideline is the 12th defender).
  // Close in: attack him (a small lead), don't aim at a point he can cut under.
  if (close < 3.5) {
    // Close in: attack where he's going. Where the two of us meet at my
    // speed and his current run (the intercept point); a runner I can't
    // head off, lead by the time it takes to get to him.
    const meet = intercept(d.pos, d.fx.vmax, seenT.pos, seenT.vel);
    const lead = Math.max(0.1, Math.min(0.6, close / Math.max(4, d.fx.vmax)));
    const at = meet ?? { x: seenT.pos.x + seenT.vel.x * lead, y: seenT.pos.y + seenT.vel.y * lead };
    const dir = norm(sub(at, d.pos));
    // In front of him in the open field: break down (short, choppy steps)
    // so he can't run by, instead of flying at him flat out.
    const facing = (t.vel.x * (d.pos.x - t.pos.x) + t.vel.y * (d.pos.y - t.pos.y)) / Math.max(1e-6, len(t.vel) * close);
    const breakDown = facing > 0.3 && close > 1.2 && len(t.vel) > 4 ? BREAKDOWN : 1;
    steer(d, { x: dir.x * d.fx.vmax, y: dir.y * d.fx.vmax }, { pace: breakDown });
    return;
  }
  const room = FIELD_HALF_W - Math.abs(t.pos.y);
  // Inside-out from inside him (the sideline is the 12th defender); a force defender outside him plays outside-in and keeps him from bouncing around the edge.
  const outsideHim = Math.abs(d.pos.y) > Math.abs(t.pos.y) + 0.5 && Math.sign(d.pos.y) === Math.sign(t.pos.y);
  const inside = Math.sign(-t.pos.y) * (outsideHim ? -0.8 : 0.6) * Math.max(0, Math.min(1, (room - 1) / 2));
  aim.y = Math.max(-FIELD_HALF_W + 0.3, Math.min(FIELD_HALF_W - 0.3, aim.y + inside));
  aim.x = Math.max(BACK_X + 0.3, Math.min(END_X - 0.3, aim.x));
  const dir = norm(sub(aim, d.pos));
  steer(d, { x: dir.x * d.fx.vmax, y: dir.y * d.fx.vmax });
}

/** Track a moving point: its velocity plus a spring toward it. */
function track(d: Agent, at: V2, vel: V2, gain = 2.5): V2 {
  return { x: vel.x + (at.x - d.pos.x) * gain, y: vel.y + (at.y - d.pos.y) * gain };
}

/**
 * A pass rusher hunting the QB (feedback item 4). Engaged, the block moves
 * the pair toward wherever the QB is now (stepBlocks' goal). Free, he takes
 * his lane: the interior straight at the QB, the ends at his outside
 * shoulder, never rushing past his depth (lose contain and the QB walks out
 * of the pocket). Once the QB has left the pocket and he's read it, the
 * nearest free rusher chases, the ends keep contain (outside him, a yard in
 * front) and everyone else runs him down.
 */
export function rush(s: PlayState, d: Agent): void {
  if (blockOf(s, d.i)) return;
  const qb = s.agents[s.qb]!;
  const edge = d.slot === 'LE' ? 1 : d.slot === 'RE' ? -1 : 0;
  const escaped = s.escapeT >= 0 && s.t >= s.escapeT + reaction(s, d);
  d.anim = 'rush';
  if (escaped) {
    let chaser = -1;
    let cd = Infinity;
    for (const i of s.def) {
      const o = s.agents[i]!;
      if (o.down || blockOf(s, i) || s.setup.def.assign[o.slot as keyof typeof s.setup.def.assign].kind !== 'rush') continue;
      const k = dist(o.pos, qb.pos);
      if (k < cd) {
        cd = k;
        chaser = i;
      }
    }
    const onMySide = edge !== 0 && (qb.pos.y - (s.setup.ballY ?? 0)) * edge > 0;
    if (d.i === chaser || edge === 0 || onMySide) {
      redirect(s, d, sub(qb.pos, d.pos));
      pursue(s, d, qb);
      return;
    }
    // Contain from the far side: outside him and a yard in front, so he can't bounce back out.
    const aim = v2(Math.max(qb.pos.x + 1, s.setup.los - 1), qb.pos.y + edge * 2);
    redirect(s, d, sub(aim, d.pos));
    steer(d, arrive(d, aim, 1, 0.8));
    return;
  }
  let aim = qb.pos;
  if (edge !== 0) {
    // The end's lane: the QB's outside shoulder; past his depth, come back up to it.
    aim = d.pos.x < qb.pos.x - 0.5 ? v2(qb.pos.x + 0.6, qb.pos.y + edge * 1.3) : v2(qb.pos.x, qb.pos.y + edge * 0.9);
  }
  const dir = norm(sub(aim, d.pos));
  redirect(s, d, dir);
  steer(d, { x: dir.x * d.fx.vmax, y: dir.y * d.fx.vmax });
}

/** A rusher's plant-and-redirect when his target moves (the render plays the step); at most every half-second. */
function redirect(s: PlayState, d: Agent, want: V2): void {
  const sp = len(d.vel);
  const wl = len(want);
  if (sp < 3 || wl < 1e-6) return;
  const cos = (d.vel.x * want.x + d.vel.y * want.y) / (sp * wl);
  if (cos < 0.45 && s.t - ((d.mem.redirectAt as number | undefined) ?? -9) > 0.5) {
    d.mem.redirectAt = s.t;
    // Which way he cuts (+1 to his left): the plant is on the other foot.
    const side = d.vel.x * want.y - d.vel.y * want.x > 0 ? 1 : -1;
    s.events.push({ t: s.t, type: 'move', who: [d.i], data: { move: 'redirect', side } });
  }
}

/**
 * Man coverage: mirror the receiver with a delay (Man Coverage), inside
 * leverage. Pressed, he's on him from the line (the jam is at the snap);
 * off, he keeps his cushion and bails with him, giving up the underneath
 * to stay on top, and closes it as the route declares itself (by ~12 yd).
 */
export function manCover(s: PlayState, d: Agent, r: Agent): void {
  const delay = 0.08 + 0.3 * (1 - d.fx.a('manCov')) + latency(s) * 0.5;
  const v = seen(r, delay);
  const by = s.setup.ballY ?? 0;
  const inside = r.pos.y > by ? -0.7 : 0.7;
  const depth = r.pos.x - s.setup.los;
  const as = s.setup.def.assign[d.slot as keyof typeof s.setup.def.assign];
  const off = as.kind === 'man' && !as.press && (d.slot === 'LCB' || d.slot === 'RCB');
  // Stay a step over the top on deep routes; off man keeps a cushion that closes by ~12 yd.
  const over = Math.max(depth > 12 ? 1.2 : 0.4, off ? 5.5 - 0.42 * Math.max(0, depth) : 0);
  // He mirrors what he saw `delay` ago, projected to now.
  const aim = v2(v.pos.x + v.vel.x * delay + over, v.pos.y + v.vel.y * delay + inside);
  const want = track(d, aim, v.vel, 2.2);
  // Backpedal while he's in front, turn and run when he's even.
  const face = r.pos.x > d.pos.x - 0.5 ? atan2(v.vel.y, v.vel.x) : Math.PI;
  steer(d, boundaryGovern(d, want, 1), { face });
  d.anim = r.pos.x < d.pos.x - 1 && len(d.vel) < 5 ? 'backpedal' : 'run';
}

/** How a zone plays (GDD §10.4): deep (thirds, halves, the middle), the Tampa 2 runner, the flat, curl-to-flat, the hook. */
type ZoneRole = 'deep' | 'tampa' | 'flat' | 'curl' | 'hook';
/** How an underneath defender plays the man he's matched on. */
type MatchMode = 'carry' | 'wall' | 'expand' | 'cross' | 'sit';
const roleOf = (z: ZoneName): ZoneRole => (z === 'tampa' ? 'tampa' : ZONES[z].deep ? 'deep' : z.startsWith('flat') ? 'flat' : z.startsWith('curl') ? 'curl' : 'hook');

/**
 * Receivers numbered from the sideline in, each side of the ball, at the
 * snap (#1 the widest): the pattern-match rules read #1, #2 and #3. A back
 * in the backfield is #0 (he's the hook defenders' when he releases).
 */
export function numberReceivers(s: PlayState): void {
  const by = s.setup.ballY ?? 0;
  const runners = s.off.map((i) => s.agents[i]!).filter((a) => a.route);
  for (const side of [1, -1]) {
    const mine = runners.filter((a) => (a.pos.y - by) * side > 0.5 && a.pos.x > s.setup.los - 2.5).sort((p, q) => Math.abs(q.pos.y - by) - Math.abs(p.pos.y - by));
    mine.forEach((a, j) => {
      a.mem.rside = side;
      a.mem.rnum = j + 1;
    });
  }
  for (const a of runners) {
    if (a.mem.rnum !== undefined) continue;
    a.mem.rside = a.pos.y >= by ? 1 : -1;
    a.mem.rnum = 0;
  }
}

/** A deep defender over the top of him (deeper, within ~7 yd across): an underneath defender can pass him off. */
function deepHelp(s: PlayState, r: Agent, me: Agent): boolean {
  const call = s.setup.def.assign;
  for (const i of s.def) {
    const o = s.agents[i]!;
    if (o === me || o.down || blockOf(s, i)) continue;
    const a = call[o.slot as keyof typeof call];
    if (a.kind !== 'zone' || !ZONES[a.zone].deep) continue;
    if (o.pos.x > r.pos.x - 1.5 && Math.abs(o.pos.y - r.pos.y) < 7) return true;
  }
  return false;
}

/** Another underneath zone defender closer to him than I am (a crosser handed on), who isn't already carrying someone. */
function handOn(s: PlayState, r: Agent, me: Agent): boolean {
  const call = s.setup.def.assign;
  const mine = dist(me.pos, r.pos);
  for (const i of s.def) {
    const o = s.agents[i]!;
    if (o === me || o.down || blockOf(s, i)) continue;
    const a = call[o.slot as keyof typeof call];
    if (a.kind !== 'zone' || ZONES[a.zone].deep) continue;
    if (dist(o.pos, r.pos) < mine - 1 && ((o.mem.carry as number | undefined) ?? -1) < 0) return true;
  }
  return false;
}

/** Zone landmark with this defender's own depth and width on this snap (±1.2 yd deep, ±1 across: no two drops alike). */
function landmark(s: PlayState, d: Agent, zone: ZoneName): V2 {
  if (d.mem.zj === undefined) {
    d.mem.zj = (s.rng.ai() - 0.5) * 2.4;
    d.mem.zl = (s.rng.ai() - 0.5) * 2;
  }
  const at = zoneSpot(s, zone);
  return v2(at.x + (d.mem.zj as number), at.y + (d.mem.zl as number));
}

/**
 * Zone coverage with pattern matching (GDD §10.4). Every zone drops to its
 * landmark and reads the receivers by number:
 * - deep: the deepest threat in his area, staying over the top and inside;
 * - Tampa 2 middle: opens and runs the deep middle, carrying a vertical there;
 * - flat (a Cover 2 corner): the first man into the flat; with nothing
 *   there, he sinks under #1 going vertical, then comes back up;
 * - curl-to-flat: carries #2 vertical until a deep defender is over the top,
 *   expands to the flat when nobody else has it, and walls the curl under #1;
 * - hook: carries #3 up the seam, takes a crosser through his area and
 *   passes him on to the next underneath defender, sits in front of a checkdown.
 * An underneath defender matched on a man plays him tight (a yard underneath
 * and inside, at his speed); unmatched, he reads the QB's eyes (a pump
 * fake moves him) but never more than a few yards off his spot.
 */
export function zoneCover(s: PlayState, d: Agent, zone: ZoneName): void {
  const role = roleOf(zone);
  const deep = role === 'deep' || role === 'tampa';
  const los = s.setup.los;
  const by = s.setup.ballY ?? 0;
  const qb = s.agents[s.qb]!;
  let spot = landmark(s, d, zone);
  // A QB scrambling toward the line: the underneath zones come up to meet him
  // (they can't leave while he can still throw it over them from deep in the pocket).
  if (!deep && s.scrambleT >= 0 && s.t >= s.scrambleT + reaction(s, d)) {
    if (qb.pos.x > los - 2.5 && dist(d.pos, qb.pos) < 14) {
      pursue(s, d, qb);
      return;
    }
  }
  // Read step: underneath defenders (linebackers, the box safety) hold and
  // read their keys before they drop; if it's a run they're still there.
  if (!deep && s.t - s.snapT < reaction(s, d) + 0.1 && d.pos.x < los + 6) {
    steer(d, { x: 0.8, y: 0 }, { face: Math.PI });
    return;
  }
  const delay = reaction(s, d) * 0.7;
  const face = atan2(qb.pos.y - d.pos.y, qb.pos.x - d.pos.x);
  const bk = s.bracket && s.bracket.by === d.slot ? s.bracket : null;
  const bkR = bk ? s.agents[bk.r]! : null;
  const receivers = s.off.map((i) => s.agents[i]!).filter((a) => a.route && !a.down && !a.mem.outOfPlay && s.setup.play.assign[a.slot as keyof typeof s.setup.play.assign].kind === 'route');
  const depthOf = (p: V2) => p.x - los;
  const now = (r: Agent) => {
    const v = seen(r, delay);
    return { pos: { x: v.pos.x + v.vel.x * delay, y: v.pos.y + v.vel.y * delay }, vel: v.vel };
  };
  // The shade (a bracket): the safety's landmark leans toward the man they're doubling.
  if (bk && bkR && bk.how === 'shade') spot = v2(spot.x, spot.y + (bkR.pos.y - spot.y) * 0.45);

  if (deep) {
    // The deepest threat in my area (for the Tampa runner: a vertical in the
    // middle). A deep zone is a band across the field, not a circle round
    // the landmark: nobody gets behind me in my third or half however deep he goes.
    const band = role === 'tampa' ? 7 : zone === 'deepM' ? 9 : 10;
    let threat: Agent | null = null;
    let score = -Infinity;
    for (const r of receivers) {
      const v = now(r);
      const k = dist(v.pos, spot);
      if (Math.abs(v.pos.y - spot.y) > band + (bkR === r ? 4 : 0)) continue;
      const depth = depthOf(v.pos);
      if (depth < (role === 'tampa' ? 7 : 6)) continue;
      if (role === 'tampa' && v.vel.x < 2) continue;
      const sc = v.pos.x - k * 0.3 + (bkR === r ? 5 : 0);
      if (sc > score) {
        score = sc;
        threat = r;
      }
    }
    let aim = spot;
    let aimVel: V2 = { x: 0, y: 0 };
    if (threat) {
      const v = now(threat);
      // Stay deeper than him (a cushion that grows with his speed) and inside him.
      const cushion = 1.2 + 0.1 * len(v.vel);
      aim = v2(Math.max(spot.x - (role === 'tampa' ? 2 : 4), v.pos.x + cushion), v.pos.y * 0.75 + spot.y * 0.25);
      aimVel = { x: Math.max(0, v.vel.x), y: v.vel.y * 0.75 };
    }
    const want = threat ? track(d, aim, aimVel, 2.2) : arrive(d, aim, 0.95, 1.2);
    steer(d, boundaryGovern(d, want, 1), { face });
    d.anim = d.vel.x > 0.8 ? 'backpedal' : 'run';
    return;
  }

  const side = role === 'hook' ? (Math.sign(ZONES[zone].y) || 0) : Math.sign(ZONES[zone].y);
  const call = s.setup.def.assign;
  const flatHelp = role === 'curl' && Object.values(call).some((a) => a.kind === 'zone' && a.zone === (side > 0 ? 'flatL' : 'flatR'));
  // Keep carrying who I have, unless he's been handed on.
  let match: Agent | null = null;
  let mode: MatchMode | null = null;
  const cur = (d.mem.carry as number | undefined) ?? -1;
  const passed = (r: Agent) => d.mem[`po${r.i}`] === true;
  if (cur >= 0) {
    const r = s.agents[cur]!;
    const v = now(r);
    const depth = depthOf(v.pos);
    // A vertical is passed off once a deep defender is over him (and he's past the underneath depth).
    const handVertical = depth > 11 && deepHelp(s, r, d);
    // A crosser is handed on once he's out of my area and a teammate underneath is closer.
    const handCross = Math.abs(v.pos.y - spot.y) > 7 && handOn(s, r, d);
    if (r.down || r.mem.outOfPlay || handVertical || handCross || depth > 20) {
      d.mem[`po${r.i}`] = true;
      d.mem.carry = -1;
    } else {
      match = r;
      mode = (d.mem.mode as MatchMode | undefined) ?? 'wall';
    }
  }
  // A vertical being carried stays carried until it's handed off; any other
  // match is read again every tick (a curl-to-flat defender walling #1 still
  // expands when #2 breaks to the flat), keeping his man unless another
  // clearly outranks him.
  const keep = match && mode === 'carry';
  if (!keep) {
    const held = match;
    // Pick by the zone's rules.
    let best = -Infinity;
    for (const r of receivers) {
      if (passed(r)) continue;
      const v = now(r);
      const depth = depthOf(v.pos);
      const lat = (v.pos.y - by) * (side || 1);
      const inArea = Math.abs(v.pos.y - spot.y) < (role === 'curl' ? 9 : 7) && depth > -1 && depth < ZONES[zone].d + 6;
      const num = (r.mem.rnum as number | undefined) ?? 0;
      const mySide = side === 0 || (r.mem.rside as number | undefined) === side;
      const vertical = v.vel.x > 3.5 && depth > 4;
      // In the flat: short, and working out to it or sitting there (a wide receiver stemming upfield isn't a flat route yet).
      const toFlat = depth < 7 && v.vel.x < 5 && (v.vel.y * (side || 1) > 1.5 || len(v.vel) < 2);
      let sc = -Infinity;
      let m: MatchMode | null = null;
      if (role === 'flat') {
        if (mySide && toFlat && lat > 6) {
          sc = 30 - dist(v.pos, spot);
          m = 'expand';
        } else if (mySide && num === 1 && vertical && depth < 15) {
          sc = 10;
          m = 'carry';
        } else if (mySide && num === 1 && depth < 13 && inArea) {
          sc = 5 - dist(v.pos, spot) * 0.3;
          m = 'wall';
        }
      } else if (role === 'curl') {
        if (mySide && num === 2 && vertical && inArea) {
          sc = 30;
          m = 'carry';
        } else if (!flatHelp && mySide && toFlat && lat > Math.abs(ZONES[zone].y) - 3) {
          sc = 20 - dist(v.pos, spot) * 0.5;
          m = 'expand';
        } else if (inArea && depth >= 5) {
          sc = 12 - dist(v.pos, spot) * 0.5;
          m = 'wall';
        } else if (inArea && depth < 5 && Math.abs(v.vel.y) > 3) {
          sc = 6 - dist(v.pos, spot) * 0.5;
          m = 'cross';
        }
      } else {
        // Hook.
        if ((num === 3 || (num === 2 && side === 0)) && vertical && inArea && Math.abs(v.pos.y - by) < 9) {
          sc = 30;
          m = 'carry';
        } else if (inArea && depth >= 2 && Math.abs(v.vel.y) > 2.5) {
          sc = 20 - dist(v.pos, spot) * 0.5;
          m = 'cross';
        } else if (inArea && depth >= 3) {
          sc = 12 - dist(v.pos, spot) * 0.5;
          m = 'wall';
        } else if (inArea && depth < 3 && dist(v.pos, spot) < 9) {
          sc = 4 - dist(v.pos, spot) * 0.3;
          m = 'sit';
        }
      }
      // A robber (the lurk half of a bracket) takes his man first.
      if (bk && bk.how === 'lurk' && r === bkR && depth < 17) {
        sc = 50;
        m = vertical ? 'carry' : 'wall';
      }
      if (r === held && sc > -Infinity) sc += 6;
      if (sc > best) {
        best = sc;
        match = r;
        mode = m;
      }
    }
    if (best === -Infinity) {
      match = held;
      mode = held ? ((d.mem.mode as MatchMode | undefined) ?? 'wall') : null;
    }
    if (match && mode !== 'sit') {
      d.mem.carry = match.i;
      d.mem.mode = mode;
    } else d.mem.carry = -1;
  }
  let aim = spot;
  let aimVel: V2 = { x: 0, y: 0 };
  if (match) {
    const v = now(match);
    const ins = Math.sign(by - v.pos.y) || 1;
    switch (mode) {
      case 'carry':
        // Run with him up the seam, underneath and inside, until he's handed off.
        aim = v2(v.pos.x - 0.8, v.pos.y + ins * 0.9);
        aimVel = { x: v.vel.x, y: v.vel.y };
        break;
      case 'expand':
        // To the flat, outside-in, a step in front so he can't turn it up.
        aim = v2(v.pos.x + 1, v.pos.y - ins * 0.5);
        aimVel = { x: v.vel.x * 0.8, y: v.vel.y };
        break;
      case 'cross':
        // Match the crosser through my area, a yard underneath him.
        aim = v2(v.pos.x - 1, v.pos.y);
        aimVel = { x: v.vel.x, y: v.vel.y };
        break;
      case 'sit':
        // A checkdown in front of me: sit at 4–5 yd over him, ready to rally; don't chase him to the line.
        aim = v2(Math.max(los + 4, spot.x - 5), v.pos.y);
        break;
      default:
        // Wall: underneath and inside him, in the throwing lane.
        aim = v2(v.pos.x - 1.2 + (qb.pos.x - v.pos.x) * 0.04, v.pos.y + ins * 0.8);
        aimVel = { x: v.vel.x * 0.7, y: v.vel.y * 0.7 };
    }
    // A zone defender plays the man from his area: walling or matching a
    // crosser, he stays within a few yards of his landmark (the windows
    // between the zones are the offense's). Expanding to the flat he can
    // go to the sideline but not deep; carrying a vertical he goes with him.
    if (mode === 'wall' || mode === 'cross') {
      const w = role === 'hook' ? ZW : ZW + 1;
      aim.y = Math.max(spot.y - w, Math.min(spot.y + w, aim.y));
      aim.x = Math.max(los + 4, Math.min(spot.x + 2, aim.x));
    } else if (mode === 'expand') aim.x = Math.min(aim.x, los + 8);
  }
  // Read the QB's eyes (pump fakes move him: GDD §10.4): lean toward the
  // window he's looking at, at most a few yards off where I'd be.
  const bite = s.t < s.pumpUntil ? DIFFICULTY[s.setup.difficulty ?? 'pro'].pumpBite * 1.6 : 1;
  const pull = 0.25 * d.fx.a('zoneCov') * bite;
  const lim = (match ? 1.2 : 3) * bite;
  const ex = Math.max(-lim, Math.min(lim, (s.eyes.x - aim.x) * pull * 0.3));
  const ey = Math.max(-lim, Math.min(lim, (s.eyes.y - aim.y) * pull));
  aim = v2(aim.x + ex, aim.y + ey);
  const want = match && mode !== 'sit' ? track(d, aim, aimVel, 2.6) : arrive(d, aim, 0.9, 1.2);
  steer(d, boundaryGovern(d, want, 1), { face });
  d.anim = d.vel.x > 0.8 ? 'backpedal' : 'run';
}
/**
 * Break on a thrown ball: to the catch point, flat out while it's far and
 * braking to be there with the ball (not running through it: a defender over
 * the top who overran the spot was out of the play). One who can't get there
 * in time is still taking the right angle to it.
 */
export function breakOnBall(s: PlayState, d: Agent): void {
  const b = s.ball;
  const aim = { x: b.aim.x, y: b.aim.y };
  steer(d, arrive(d, aim, 1, 1));
  d.mem.onBall = true;
}
