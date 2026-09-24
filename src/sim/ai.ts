// Role behaviors (TECH_PLAN §10 "AI", GDD §10.3–10.4): small functions that
// read the play's shared state (the QB's eyes, the ball, the carrier) and ask
// the movement model for a velocity. Every reaction goes through delayed
// perception, and the delays come from the ratings (Play Recognition, Man
// Coverage, Awareness) plus the difficulty's latency, never from dice alone.

import { atan2, cos, sin } from '@/engine/math/detmath';
import { blockOf, engage } from './blocks';
import { arrive, CRUISE, seen, steer } from './movement';
import { maxThrowSpeed, releaseTime } from './effects';
import { lead } from './passing';
import { ROUTE_DELAY, ROUTES, ZONES, type OffPlay, type RouteName } from './plays';
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
  const pts = ROUTES[name].map((q) => v2(Math.min(END_X - ROUTE_ROOM, a.pos.x + q.d), Math.max(-FIELD_HALF_W + ROUTE_ROOM, Math.min(FIELD_HALF_W - ROUTE_ROOM, a.pos.y + q.o * out))));
  return { pts, sit: ROUTES[name].map((q) => !!q.sit), name };
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
  if (room < 4 && Math.sign(dir.y) === Math.sign(at.y)) {
    const k = Math.max(0, room - 1.5) / 2.5; // 1 → keep the leg, 0 → straight upfield
    return norm({ x: dir.x * k + (1 - k), y: dir.y * k });
  }
  return dir;
}

/** Run the route: stem at pace, sharp breaks for good route runners, settle on sits. */
export function runRoute(s: PlayState, a: Agent): void {
  const rt = a.route;
  if (!rt) return;
  if (a.busy > 0) {
    // Jammed at the line: fighting to get off press.
    steer(a, { x: 0, y: 0 });
    return;
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
    if (dist(a.pos, q) < (rt.sit[rt.idx] ? 0.25 : early)) {
      rt.idx++;
    }
  }
  if (rt.idx < rt.pts.length) {
    const q = rt.pts[rt.idx]!;
    const sit = rt.sit[rt.idx];
    // Stem at ~90% selling the vertical, full speed after the break.
    const pace = rt.idx === 0 ? 0.92 : 1;
    steer(a, sit ? arrive(a, q, 1, 1) : arrive(a, q, pace), {});
    return;
  }
  // Settled on a sit route: face the QB and work to the open window.
  if (rt.sit[rt.pts.length - 1]) {
    const qb = s.agents[s.qb]!;
    steer(a, { x: 0, y: 0 }, { face: atan2(qb.pos.y - a.pos.y, qb.pos.x - a.pos.x) });
    return;
  }
  // Past the last point: keep running the line, bending away from the sideline.
  const n = rt.pts.length;
  const p0 = n > 1 ? rt.pts[n - 2]! : a.pos;
  const p1 = rt.pts[n - 1]!;
  const dir = continueDir(a.pos, p0, p1);
  steer(a, { x: dir.x * a.fx.vmax, y: dir.y * a.fx.vmax });
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
export const blockable = (s: PlayState, d: Agent): boolean => s.t - ((d.mem.shedAt as number | undefined) ?? -9) > (s.carrier >= 0 ? 0.8 : 1.6) && !d.down;

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
  if (engageOk && between && blockable(s, d) && dist(b.pos, d.pos) < b.fx.radius + d.fx.radius + 0.25) {
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
export function openness(s: PlayState, qb: Agent, r: Agent, bullet?: boolean, peek = false): { sep: number; at: V2; T: number; bullet: boolean } {
  const react = (d: Agent) => (peek ? reactionPeek(s, d) : reaction(s, d));
  const vmax = maxThrowSpeed(qb.fx.r('throwPower'));
  // First guess at the throw: bullets for short and mid windows, touch deep.
  let at = lead(r, 0.8);
  const deep = at.x - s.setup.los > 20;
  const isBullet = bullet ?? !deep;
  const speed = isBullet ? vmax * 0.85 : vmax * 0.62;
  let T = 0.8;
  for (let k = 0; k < 3; k++) {
    T = dist(qb.pos, at) / speed + 0.12 + releaseTime(qb.fx.r('release'));
    at = lead(r, T);
  }
  let sep = 99;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down) continue;
    // Where he'll be when the ball arrives: carrying on as he is until he
    // reacts to the throw, then breaking on the ball.
    const rt0 = react(d);
    const carry = Math.min(T, rt0);
    const px = d.pos.x + d.vel.x * carry;
    const py = d.pos.y + d.vel.y * carry;
    // After his read he runs flat out to the catch point (breakOnBall), less
    // the time to turn and get going (~a quarter of his flight after the read).
    const closing = Math.max(0, T - rt0) * d.fx.vmax * 0.8;
    sep = Math.min(sep, Math.sqrt((px - at.x) * (px - at.x) + (py - at.y) * (py - at.y)) - closing);
  }
  // Throwing lanes: a defender who can get to the ball's path before it
  // passes (the last two-thirds of the flight) can undercut it. Better
  // decision makers see it; worse ones throw into it.
  const see = 0.4 + 0.6 * qb.fx.a('decision');
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down) continue;
    for (const f of [0.4, 0.6, 0.8]) {
      const px = qb.pos.x + (at.x - qb.pos.x) * f;
      const py = qb.pos.y + (at.y - qb.pos.y) * f;
      const tBall = T * f;
      const k = Math.sqrt((d.pos.x - px) * (d.pos.x - px) + (d.pos.y - py) * (d.pos.y - py));
      const canCover = Math.max(0, tBall - react(d)) * d.fx.vmax * 0.7 + 0.5;
      if (k < canCover) sep = Math.min(sep, sep + (k - canCover) * 0.5 * see);
    }
  }
  // Before his break a receiver isn't a target yet (go routes once they're
  // past 12 yards); sit routes are open once he settles.
  const rt = r.route;
  if (rt && rt.idx === 0 && !(rt.pts.length === 1 && r.pos.x - s.setup.los > 12)) sep -= 1.5;
  // Out of bounds catch points aren't open.
  if (Math.abs(at.y) > FIELD_HALF_W - 0.8) sep -= 3;
  return { sep, at, T, bullet: isBullet };
}

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
  const noise = (1 - qb.fx.a('decision')) * 1.2 * (s.rng.ai() - 0.5);
  // The clock in his head: past ~2.2 s from the set he takes what's there.
  const held = s.t - s.snapT - s.setup.play.drop.set;
  const need = 1.4 - 1.1 * pressure - Math.min(0.8, held * 0.3) - (held > 2.2 ? 2 : 0);
  s.eyes = { x: r.pos.x, y: r.pos.y };
  // A deep ball needs a step on the coverage: the longer it hangs, the more
  // a small misread costs (NFL QBs throw ~12% of attempts 20+ air yards and
  // complete ~35–45% of them). About a yard more margin per 20 yd downfield.
  const risk = Math.max(0, o.at.x - s.setup.los - 10) * 0.05;
  // A screen goes to its man on schedule unless a defender is on him (it's
  // built on blockers in front of him, not on separation).
  const screen = s.setup.play.type === 'screen' && cur === 0 && s.t - s.snapT >= s.setup.play.drop.set;
  if (screen ? o.sep + noise > -0.5 : o.sep + noise > need + risk) return cur;
  if (since > readTime) {
    s.read.idx++;
    s.read.since = s.t;
  }
  // Under heavy pressure or out of time: the best available, or nothing (throw it away / take it).
  if (pressure > 0.85 || held > 2.2) {
    let best = -1;
    let bs = -Infinity;
    icons.forEach((k, j) => {
      const oq = openness(s, qb, s.agents[k]!);
      const q = oq.sep - Math.max(0, oq.at.x - s.setup.los - 10) * 0.05;
      if (q > bs) {
        bs = q;
        best = j;
      }
    });
    return bs > 0.3 ? best : -1;
  }
  return -1;
}

/** Pressure on the QB 0..1: the closest free defender and how fast he's closing. */
export function pressureOn(s: PlayState, qb: Agent): number {
  let p = 0;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down || blockOf(s, i)) continue;
    const k = dist(d.pos, qb.pos);
    p = Math.max(p, Math.max(0, 1 - (k - 1) / 3.5));
  }
  return Math.min(1, p);
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
    if (behind && aimY !== null) score -= Math.abs(c.pos.y + dir.y * 3 - aimY) * 0.35;
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
    }
    const side = c.pos.y + dir.y * 5;
    if (Math.abs(side) > FIELD_HALF_W - 1.5) score -= 3;
    // Never through the line: a lane that runs him out within a couple of strides is out.
    if (Math.abs(c.pos.y + dir.y * 2) > FIELD_HALF_W - 0.6) score -= 8;
    if (dir.x * attack > 0 && c.pos.x + dir.x * 2 > END_X) score -= 8;
    // Reads aren't perfect: a lower Vision misjudges lanes (held per lane for a beat).
    score += ((c.mem[`lane${k}`] as number | undefined) ?? 0) * (1.6 - 1.3 * c.fx.a('vision'));
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
 * Chase a ball carrier. A good pursuer takes the cut-off angle (the intercept
 * point); a poor one chases where the runner is, and ends up trailing (Pursuit).
 */
export function pursue(s: PlayState, d: Agent, t: Agent): void {
  const seenT = seen(t, reaction(s, d) * 0.4);
  // Where he's going: a runner accelerates toward the goal line, so blend
  // what he's doing with a full-speed run upfield (half and half).
  const attack = t.side === 'off' ? 1 : -1;
  const upNow = seenT.vel.x * attack;
  const upSoon = Math.max(upNow, 0.55 * t.fx.vmax);
  const vt = { x: attack * (upNow + (upSoon - upNow) * 0.5), y: seenT.vel.y * 0.7 };
  const cut = intercept(d.pos, d.fx.vmax * 0.95, seenT.pos, vt);
  const k = 0.35 + 0.65 * d.fx.a('pursuit');
  const naive = { x: seenT.pos.x + vt.x * 0.25, y: seenT.pos.y + vt.y * 0.25 };
  const aim = cut ? { x: naive.x + (cut.x - naive.x) * k, y: naive.y + (cut.y - naive.y) * k } : { x: seenT.pos.x + vt.x * 0.6, y: seenT.pos.y + vt.y * 0.6 };
  // Inside-out: a step inside him, and never aim out of bounds (the sideline is the 12th defender).
  // Close in: attack him (a small lead), don't aim at a point he can cut under.
  const close = dist(d.pos, seenT.pos);
  if (close < 3.5) {
    // Close in: attack where he's going. Where the two of us meet at my
    // speed and his current run (the intercept point); a runner I can't
    // head off, lead by the time it takes to get to him.
    const meet = intercept(d.pos, d.fx.vmax, seenT.pos, seenT.vel);
    const lead = Math.max(0.1, Math.min(0.6, close / Math.max(4, d.fx.vmax)));
    const at = meet ?? { x: seenT.pos.x + seenT.vel.x * lead, y: seenT.pos.y + seenT.vel.y * lead };
    const dir = norm(sub(at, d.pos));
    steer(d, { x: dir.x * d.fx.vmax, y: dir.y * d.fx.vmax });
    return;
  }
  const room = FIELD_HALF_W - Math.abs(t.pos.y);
  const inside = Math.sign(-t.pos.y) * 0.6 * Math.max(0, Math.min(1, (room - 1) / 2));
  aim.y = Math.max(-FIELD_HALF_W + 0.3, Math.min(FIELD_HALF_W - 0.3, aim.y + inside));
  aim.x = Math.max(BACK_X + 0.3, Math.min(END_X - 0.3, aim.x));
  const dir = norm(sub(aim, d.pos));
  steer(d, { x: dir.x * d.fx.vmax, y: dir.y * d.fx.vmax });
}

/** Track a moving point: its velocity plus a spring toward it. */
function track(d: Agent, at: V2, vel: V2, gain = 2.5): V2 {
  return { x: vel.x + (at.x - d.pos.x) * gain, y: vel.y + (at.y - d.pos.y) * gain };
}

/** Pass rusher: at the QB until blocked (blocks.ts moves engaged pairs). */
export function rush(s: PlayState, d: Agent): void {
  if (blockOf(s, d.i)) return;
  const qb = s.agents[s.qb]!;
  const dir = norm(sub(qb.pos, d.pos));
  steer(d, { x: dir.x * d.fx.vmax, y: dir.y * d.fx.vmax });
  d.anim = 'rush';
}

/** Man coverage: mirror the receiver with a delay (Man Coverage), inside leverage, cushion by depth. */
export function manCover(s: PlayState, d: Agent, r: Agent): void {
  const delay = 0.08 + 0.3 * (1 - d.fx.a('manCov')) + latency(s) * 0.5;
  const v = seen(r, delay);
  const by = s.setup.ballY ?? 0;
  const inside = r.pos.y > by ? -0.7 : 0.7;
  // Cushion shrinks as the route develops; stay a step over the top on deep routes.
  const depth = r.pos.x - s.setup.los;
  const over = depth > 12 ? 1.2 : 0.4;
  // He mirrors what he saw `delay` ago, projected to now.
  const aim = v2(v.pos.x + v.vel.x * delay + over, v.pos.y + v.vel.y * delay + inside);
  const want = track(d, aim, v.vel, 2.2);
  // Backpedal while he's in front, turn and run when he's even.
  const face = r.pos.x > d.pos.x - 0.5 ? atan2(v.vel.y, v.vel.x) : Math.PI;
  steer(d, want, { face });
  d.anim = r.pos.x < d.pos.x - 1 && len(d.vel) < 5 ? 'backpedal' : 'run';
}

/** Zone coverage: drop to the landmark, then guard the most dangerous route in it, shading to the QB's eyes. */
export function zoneCover(s: PlayState, d: Agent, zone: NonNullable<Parameters<typeof zoneSpot>[1]>): void {
  const spot = zoneSpot(s, zone);
  const deep = zone.startsWith('deep') || zone.startsWith('half');
  // Read step: underneath defenders (linebackers, the box safety) hold and
  // read their keys before they drop; if it's a run they're still there.
  if (!deep && s.t - s.snapT < reaction(s, d) + 0.1 && d.pos.x < s.setup.los + 6) {
    steer(d, { x: 0.8, y: 0 }, { face: Math.PI });
    return;
  }
  const rad = deep ? 11 : 7;
  const delay = reaction(s, d) * 0.7;
  // The most dangerous receiver in my area: the deepest for deep zones, the closest otherwise.
  let threat: Agent | null = null;
  let score = -Infinity;
  const Z = ZONES[zone];
  for (const i of s.icons) {
    const r = s.agents[i]!;
    const v = seen(r, delay);
    const k = dist(v.pos, spot);
    if (k > rad) continue;
    // Pass off vertical routes: underneath zones guard their depth band, deep
    // zones only routes already past the underneath coverage.
    const depth = v.pos.x - s.setup.los;
    if (!deep && depth > Z.d + 5) continue;
    if (deep && depth < 6) continue;
    const sc = deep ? v.pos.x - k * 0.3 : -k;
    if (sc > score) {
      score = sc;
      threat = r;
    }
  }
  let aim = spot;
  let aimVel: V2 = { x: 0, y: 0 };
  if (threat) {
    const v = seen(threat, delay);
    const qb = s.agents[s.qb]!;
    const now = { x: v.pos.x + v.vel.x * delay, y: v.pos.y + v.vel.y * delay };
    if (deep) {
      // Stay deeper than him (a cushion that grows with his speed) and inside him.
      const cushion = 1.2 + 0.1 * len(v.vel);
      aim = v2(Math.max(spot.x - 4, now.x + cushion), now.y * 0.75 + spot.y * 0.25);
      aimVel = { x: Math.max(0, v.vel.x), y: v.vel.y * 0.75 };
    } else {
      // Undercut: between him and the QB, closing to the catch window.
      aim = v2(now.x - 1 + (qb.pos.x - now.x) * 0.08, now.y + (qb.pos.y - now.y) * 0.12);
      aimVel = { x: v.vel.x, y: v.vel.y };
    }
  }
  // Read the QB's eyes (pump fakes move him: GDD §10.4).
  const eyesPull = 0.25 * d.fx.a('zoneCov') * (s.t < s.pumpUntil ? DIFFICULTY[s.setup.difficulty ?? 'pro'].pumpBite * 1.6 : 1);
  aim = v2(aim.x + (s.eyes.x - aim.x) * eyesPull * 0.3, aim.y + (s.eyes.y - aim.y) * eyesPull);
  const qb = s.agents[s.qb]!;
  steer(d, threat ? track(d, aim, aimVel, 2.2) : arrive(d, aim, deep ? 0.95 : 0.85, 1.2), { face: atan2(qb.pos.y - d.pos.y, qb.pos.x - d.pos.x) });
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
