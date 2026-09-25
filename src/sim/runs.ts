// The run game (feedback item 6, GDD §9.4): blocking schemes, the back's
// path to the mesh and the aiming point, and the Beasts' run fits.
//
// Schemes are assigned once at the snap from where everyone lined up: each
// blocker gets a target (mem.target), a drive direction (mem.drive) and, for
// pullers, a hole to pull to (mem.pull). The defense reads what the offense
// shows (run or pass, and when), each defender at his own speed (Play
// Recognition), and fits his gap or plays pass until he's seen it: that
// window is what a play-action fake and a draw live in.

import { atan2 } from '@/engine/math/detmath';
import { blockOf } from './blocks';
import { arrive, steer } from './movement';
import { pursue, reaction, runBlock } from './ai';
import { fullbackSlot, inLine, ZONES, type OffPlay } from './plays';
import { manOf, type PlayState } from './state';
import { FIELD_HALF_W, type Agent, type OffSlot } from './types';
import { dist, v2, type V2 } from './vec';

/** Defensive backs read their receivers first: a beat longer to believe run (s; M5.5 0.15). */
const DB_READ = 0.05;
/** Deep zones are pass-first: a beat more still (s; M5.5 0.2, which left the deep safeties backpedalling as backs reached the second level). */
const DEEP_READ = 0.1;

/** How deep a linebacker sits over his gap before the back gets to the line (yd): level at depth, then downhill as he arrives. */
const LB_FIT = 1;

/** Gap offsets from the ball (yd): A (center–guard), B (guard–tackle), C (outside the tackle), D (outside the tight end). */
export const GAPS = [0.7, 2.0, 3.4, 5.2];

const OL = ['LT', 'LG', 'C', 'RG', 'RT'];

/**
 * Each blocker's job on a play, from the play data alone (the play art draws
 * it; assignRunBlocks runs it, so they can't disagree). Zone: step play-side
 * (outside zone reaches); gap schemes: the play side and the center block
 * down, the backside guard pulls and kicks out, counter's backside tackle
 * pulls and leads, power's backside tackle hinges; on power the play-side
 * tight end climbs to the linebacker over the hole. Receivers stalk.
 */
export type BlockRole = 'zone' | 'reach' | 'down' | 'hinge' | 'kick' | 'lead' | 'climb' | 'stalk' | 'pass' | 'release';

/** Schemes the line blocks like zone (a play-side step, the man in the gap): the iso's base blocks and the sneak's wedge too. */
const ZONE_LIKE = ['insideZone', 'iso', 'sneak'];
/** Schemes the line reaches on (outside zone and the toss). */
const REACH = ['outsideZone', 'toss'];

export function blockRoles(play: OffPlay): Partial<Record<OffSlot, BlockRole>> {
  const out: Partial<Record<OffSlot, BlockRole>> = {};
  const run = play.run;
  const fb = fullbackSlot(play.formation);
  const pulls = pullers(play);
  for (const k of Object.keys(play.assign) as OffSlot[]) {
    const a = play.assign[k];
    if (a.kind === 'passBlock') out[k] = play.screen && OL.includes(k) ? 'release' : 'pass';
    else if (a.kind === 'stalk') out[k] = 'stalk';
    else if (a.kind === 'runBlock') {
      const lineman = OL.includes(k);
      const te = inLine(play.formation, k);
      const side = (run?.aim ?? -1) >= 0 ? 1 : -1;
      const dy = play.formation.align[k].dy * side;
      if (!run || run.scheme === 'draw') out[k] = lineman ? 'pass' : 'stalk';
      else if (k === pulls.kick) out[k] = 'kick';
      else if (k === pulls.lead) out[k] = 'lead';
      // The fullback leads through the hole (iso, the dive, zone) or around the edge (toss).
      else if (k === fb) out[k] = 'lead';
      else if (!lineman && !te) out[k] = 'stalk';
      else if (ZONE_LIKE.includes(run.scheme)) out[k] = !lineman && dy < 0 ? 'hinge' : 'zone';
      else if (REACH.includes(run.scheme)) out[k] = !lineman && dy < 0 ? 'hinge' : 'reach';
      else if (te) out[k] = dy > 0 ? (run.scheme === 'power' && !fb ? 'climb' : 'down') : 'hinge';
      else out[k] = dy > -0.5 ? 'down' : 'hinge';
    }
  }
  return out;
}

/**
 * Gap schemes' pullers: the backside guard kicks out; on counter the
 * backside tackle leads too. With a fullback (Power O from the I or heavy
 * sets) the fullback kicks out the end and the guard wraps up through the
 * hole to the linebacker.
 */
export function pullers(play: OffPlay): { kick?: OffSlot; lead?: OffSlot } {
  const run = play.run;
  if (!run || (run.scheme !== 'power' && run.scheme !== 'counter')) return {};
  const left = run.aim >= 0; // running to the offense's left: the backside is the right
  const guard: OffSlot = left ? 'RG' : 'LG';
  const fb = fullbackSlot(play.formation);
  if (run.scheme === 'power' && fb) return { kick: fb, lead: guard };
  return { kick: guard, ...(run.scheme === 'counter' ? { lead: left ? 'RT' : 'LT' } : {}) };
}
/** The play side (+1 = offense's left) of a run or a play-action fake. */
export function playSide(s: PlayState): 1 | -1 {
  const aim = s.setup.play.run?.aim ?? s.setup.play.pa?.aim ?? -1;
  return aim >= 0 ? 1 : -1;
}

function nearestFree(s: PlayState, pool: number[], at: V2, taken: Set<number>, within = Infinity): number {
  let best = -1;
  let bd = within;
  for (const i of pool) {
    if (taken.has(i)) continue;
    const k = dist(s.agents[i]!.pos, at);
    if (k < bd) {
      bd = k;
      best = i;
    }
  }
  return best;
}

/**
 * Blocking assignments at the snap, by scheme. Zone: the man in my play-side
 * gap, else climb to the nearest linebacker (outside zone reaches wider and
 * drives him to the sideline). Gap schemes (power, counter): the play side
 * down-blocks the man inside, the backside guard pulls (and on counter the
 * backside tackle too), the backside tackle otherwise hinges. The draw's line
 * pass-sets (assignProtection), so nothing here.
 */
export function assignRunBlocks(s: PlayState): void {
  const run = s.setup.play.run;
  if (!run || run.scheme === 'draw') return;
  const side = run.aim >= 0 ? 1 : -1;
  const by = s.setup.ballY ?? 0;
  const los = s.setup.los;
  const front = s.def.filter((i) => s.agents[i]!.pos.x < los + 2.5);
  const second = s.def.filter((i) => {
    const d = s.agents[i]!;
    return d.pos.x >= los + 2.5 && d.pos.x < los + 8;
  });
  const taken = new Set<number>();
  // Play side first (the pullers come from the far end).
  const line = OL.map((k) => s.agents[s.slot[k]!]!).sort((p, q) => (q.pos.y - p.pos.y) * side);
  const gap = run.scheme === 'power' || run.scheme === 'counter';
  const pulls = pullers(s.setup.play);
  const pullG = pulls.kick ? s.agents[s.slot[pulls.kick]!] : undefined;
  const pullT = pulls.lead ? s.agents[s.slot[pulls.lead]!] : undefined;
  const fbSlot = fullbackSlot(s.setup.play.formation);
  const fb = fbSlot && s.setup.play.assign[fbSlot].kind === 'runBlock' ? s.agents[s.slot[fbSlot]!] : undefined;
  const hole = v2(los + 0.6, by + run.aim);
  for (const b of line) {
    delete b.mem.drive;
    b.mem.pull = null;
    if (b === pullG || b === pullT) continue;
    let tgt: number;
    if (gap && (b.pos.y - by) * side > -0.5) {
      // Play side and the center: down-block the man inside (drive him inside, away from the hole).
      tgt = nearestFree(s, front, v2(b.pos.x + 1.2, b.pos.y - side * 1.1), taken, 2.6);
      b.mem.drive = -side * 0.8;
    } else if (gap) {
      // Backside tackle on power: hinge on the man over or outside him.
      tgt = nearestFree(s, front, v2(b.pos.x + 1.2, b.pos.y - side * 0.8), taken, 2.6);
      b.mem.drive = 0;
    } else if (run.scheme === 'sneak') {
      // The wedge: everyone fires straight ahead into the man in front of him.
      tgt = nearestFree(s, front, v2(b.pos.x + 1.2, b.pos.y), taken, 2.2);
      b.mem.drive = 0;
    } else if (run.scheme === 'iso') {
      // Iso: base blocks, the man over me (a half-step play-side), driven straight back.
      tgt = nearestFree(s, front, v2(b.pos.x + 1.2, b.pos.y + side * 0.5), taken, 2.2);
      b.mem.drive = side * 0.15;
    } else {
      // Zone: my play-side gap; outside zone and the toss reach a step wider.
      const wide = run.scheme === 'outsideZone' || run.scheme === 'toss';
      const reach = wide ? 1.6 : 1.1;
      tgt = nearestFree(s, front, v2(b.pos.x + 1.2, b.pos.y + side * reach), taken, 2.2);
      b.mem.drive = side * (wide ? 0.9 : 0.3);
    }
    // Uncovered: climb to the linebacker on my play side (on the iso, leave the one over the hole to the fullback).
    if (tgt < 0) tgt = nearestFree(s, second, v2(b.pos.x + 5, b.pos.y + side * 1.5), taken);
    if (tgt >= 0) {
      taken.add(tgt);
      b.mem.target = tgt;
    }
  }
  // Pullers: the kick-out on the end at the play side (the guard, or the
  // fullback on Power O); the lead through the hole to the linebacker (the
  // counter's tackle, or the guard wrapping on Power O).
  const end = nearestFree(s, s.def, v2(los + 1, by + side * 4.5), taken);
  if (pullG) {
    pullG.mem.pull = hole;
    pullG.mem.target = end;
    pullG.mem.drive = side * 1.0;
    if (end >= 0) taken.add(end);
  }
  if (pullT) {
    pullT.mem.pull = v2(hole.x + 0.5, hole.y - side * 0.4);
    const lb = nearestFree(s, second, v2(los + 4.5, hole.y), taken);
    pullT.mem.target = lb;
    pullT.mem.drive = side * 0.2;
    if (lb >= 0) taken.add(lb);
  }
  // The fullback's lead (not a puller): through the hole to the linebacker
  // over it (iso, the dive, zone), or around the edge to the force defender
  // (the toss). He runs his path first (mem.pull), then blocks.
  if (fb && fb !== pullG && fb !== pullT) {
    const toss = run.scheme === 'toss';
    const at = toss ? v2(los + 2.5, by + run.aim + side * 1.5) : v2(los + 4.5, hole.y);
    const tgt = nearestFree(s, toss ? s.def : second.length ? second : s.def, at, taken);
    fb.mem.pull = toss ? v2(los - 0.5, by + run.aim) : v2(hole.x, hole.y);
    fb.mem.target = tgt;
    fb.mem.drive = side * (toss ? 0.8 : 0.2);
    if (tgt >= 0) taken.add(tgt);
  }
  // Tight ends (whoever's in-line) and receivers: on power (no fullback) the
  // play-side tight end climbs to the linebacker over the hole; on counter
  // and Power O he down-blocks; on the reach schemes he reaches the end;
  // everyone else stalks the nearest man to his side.
  for (const k of ['TE', 'X', 'Z', 'SLOT']) {
    const b = s.agents[s.slot[k]!]!;
    if (b === fb || b === pullG || b === pullT) continue;
    b.mem.pull = null;
    if (s.setup.play.assign[k as 'TE'].kind !== 'runBlock') continue;
    const inline = Math.abs(b.pos.y - by) < 5.5 && b.pos.x > los - 1.2;
    const playSide = (b.pos.y - by) * side > 0;
    let tgt = -1;
    if (inline && run.scheme === 'power' && playSide && !fb) {
      tgt = nearestFree(s, [...second, ...front], v2(los + 4, hole.y), taken, 6);
      b.mem.drive = side * 0.3;
    } else if (inline && gap && playSide) {
      tgt = nearestFree(s, front, v2(b.pos.x + 1.2, b.pos.y - side * 1.2), taken, 3);
      b.mem.drive = -side * 0.8;
      // Nobody to down-block: the linebacker over the hole.
      if (tgt < 0) tgt = nearestFree(s, second, v2(los + 4, hole.y), taken, 6);
    } else if (inline && (run.scheme === 'outsideZone' || run.scheme === 'toss') && playSide) {
      tgt = nearestFree(s, s.def, v2(b.pos.x + 1.4, b.pos.y + side * 1.8), taken, 3.5);
      b.mem.drive = side * 0.9;
    } else if (inline && playSide) {
      // Iso, the sneak and inside zone: the man over or just outside him, driven out.
      tgt = nearestFree(s, s.def, v2(b.pos.x + 1.2, b.pos.y + side * 0.6), taken, 3);
      b.mem.drive = side * 0.4;
    } else if (inline) {
      // Backside: cut off the man over him (hinge), keep him from chasing it down.
      tgt = nearestFree(s, s.def, v2(b.pos.x + 1.2, b.pos.y + side * 0.8), taken, 3);
      b.mem.drive = side * 0.3;
    }
    if (tgt < 0) tgt = nearestFree(s, s.def, v2(b.pos.x + 3, b.pos.y), taken);
    if (tgt >= 0) {
      taken.add(tgt);
      b.mem.target = tgt;
    }
  }
}

/**
 * A lineman or tight end on a run: pullers get to their hole first (flat
 * behind the line, then up through it), then everyone blocks their man
 * (runBlock), driving him the scheme's way.
 */
export function schemeBlock(s: PlayState, b: Agent): void {
  const run = s.setup.play.run;
  const pull = b.mem.pull as V2 | null | undefined;
  if (pull && !blockOf(s, b.i) && b.busy === 0) {
    const los = s.setup.los;
    // Flat down the line a yard deep until level with the hole, then up into it.
    const lateral = Math.abs(b.pos.y - pull.y);
    if (lateral > 1.0) {
      steer(b, arrive(b, v2(los - 1.1, pull.y), 1), {});
      b.anim = 'run';
      return;
    }
    b.mem.pull = null;
  }
  const toward = v2(s.setup.los + 3, (s.setup.ballY ?? 0) + (run?.aim ?? 0));
  runBlock(s, b, toward, false);
  // Drive him the scheme's way (a down block inside, a reach to the sideline, a kick-out away from the hole).
  if (blockOf(s, b.i) && b.mem.drive !== undefined) b.mem.driveY = b.mem.drive as number;
}

/**
 * The back before the handoff: his path to the mesh, by scheme. The counter
 * steps away first; the draw shows pass protection, then comes to the QB.
 */
export function backToMesh(s: PlayState, rb: Agent): void {
  const run = s.setup.play.run!;
  const qb = s.agents[s.qb]!;
  const since = s.t - s.snapT;
  const side = run.aim >= 0 ? 1 : -1;
  if (run.scheme === 'counter' && since < 0.35) {
    // Counter step: a jab the wrong way sells the backside.
    steer(rb, { x: 0.8, y: -side * rb.fx.vmax * 0.5 }, { pace: 0.55 });
    rb.anim = 'run';
    return;
  }
  if (run.scheme === 'draw' && since < run.mesh - 0.35) {
    // Pass-protection look: a step up and set.
    steer(rb, arrive(rb, v2(qb.pos.x + 1.2, rb.pos.y), 0.4, 1), { face: 0 });
    rb.anim = 'block';
    return;
  }
  if (run.scheme === 'toss') {
    // The toss: the back opens and runs for the edge from the snap, a yard
    // or two deeper than the QB so the pitch comes back to him on the run.
    const edge = v2(s.setup.los - 4.5, (s.setup.ballY ?? 0) + run.aim);
    steer(rb, arrive(rb, edge, 1), {});
    rb.anim = 'run';
    return;
  }
  if (run.scheme === 'sneak') {
    // The sneak: the back's a blocker behind the wedge (a push from behind).
    steer(rb, arrive(rb, v2(qb.pos.x - 0.6, qb.pos.y), 0.6, 1), { face: 0 });
    return;
  }
  const mesh = v2(qb.pos.x + 0.3, qb.pos.y + run.aim * 0.25);
  steer(rb, { x: (mesh.x - rb.pos.x) * 3, y: (mesh.y - rb.pos.y) * 3 }, { pace: run.scheme === 'outsideZone' ? 0.8 : run.scheme === 'iso' ? 0.85 : 0.7 });
}

/**
 * The QB's side of the mesh: a reverse pivot from under center (back and
 * toward the play), a slide toward the back from the gun; the draw first
 * shows a three-step drop; on the toss he opens to the play side and pitches.
 */
export function qbMesh(s: PlayState, qb: Agent, rb: Agent): void {
  const run = s.setup.play.run!;
  const since = s.t - s.snapT;
  const center = s.setup.play.formation.center === true;
  if (run.scheme === 'draw' && since < run.mesh - 0.3) {
    steer(qb, { x: -qb.fx.vmax * 0.45, y: 0 }, { face: 0 });
    qb.anim = 'drop';
    return;
  }
  if (run.scheme === 'toss') {
    // A reverse pivot and a step back toward the play side, facing the back for the pitch.
    const side = run.aim >= 0 ? 1 : -1;
    steer(qb, s.phase === 'carrier' ? { x: 0, y: 0 } : { x: -qb.fx.vmax * 0.35, y: side * qb.fx.vmax * 0.3 }, { pace: 0.5, face: atan2(rb.pos.y - qb.pos.y, rb.pos.x - qb.pos.x) });
    qb.anim = 'handoff';
    return;
  }
  const want = center && since < 0.45 ? { x: -qb.fx.vmax * 0.5, y: run.aim * 0.9 } : { x: 0, y: (rb.pos.y - qb.pos.y) * 1.5 };
  steer(qb, s.phase === 'carrier' ? { x: 0, y: 0 } : want, { pace: center ? 0.6 : 0.4, face: atan2(rb.pos.y - qb.pos.y, rb.pos.x - qb.pos.x) });
  qb.anim = 'handoff';
}

// ---- The defense against the run ---------------------------------------------

/**
 * Run fits at the snap: each front defender (the four down linemen, the
 * three linebackers and a safety in the box) owns a gap; the widest on each
 * side has contain (keep the ball inside). Defensive backs outside the box
 * are force and alley players (they come up once they've read run).
 */
export function assignRunFits(s: PlayState): void {
  const by = s.setup.ballY ?? 0;
  const los = s.setup.los;
  const gaps = [...GAPS.map((g) => by + g), ...GAPS.map((g) => by - g)];
  const box = s.def.filter((i) => {
    const d = s.agents[i]!;
    return d.pos.x < los + 8 && Math.abs(d.pos.y - by) < 7.5;
  });
  // Linemen first (they're on the line), then the second level, closest to the ball first.
  const order = [...box].sort((p, q) => {
    const a = s.agents[p]!;
    const b = s.agents[q]!;
    const la = a.pos.x < los + 2 ? 0 : 1;
    const lb = b.pos.x < los + 2 ? 0 : 1;
    return la - lb || Math.abs(a.pos.y - by) - Math.abs(b.pos.y - by);
  });
  const used = new Set<number>();
  for (const i of order) {
    const d = s.agents[i]!;
    let best = -1;
    let bd = Infinity;
    gaps.forEach((g, k) => {
      if (used.has(k)) return;
      const c = Math.abs(g - d.pos.y);
      if (c < bd) {
        bd = c;
        best = k;
      }
    });
    if (best >= 0) {
      used.add(best);
      d.mem.gap = gaps[best]!;
    }
  }
  // Contain: the widest front defender on each side.
  for (const sgn of [1, -1]) {
    let w = -1;
    let wy = -Infinity;
    for (const i of box) {
      const d = s.agents[i]!;
      if (d.pos.x > los + 2) continue;
      const y = (d.pos.y - by) * sgn;
      if (y > wy) {
        wy = y;
        w = i;
      }
    }
    if (w >= 0) s.agents[w]!.mem.contain = sgn;
  }
}

/**
 * What a defender believes the play is now: 'run' or 'pass'. The offense
 * shows run (the line fires out, a handoff or a fake) and pass (the line
 * sets, the QB drops or pulls the ball out of a fake) at given times; each
 * defender registers a show after his read time, and believes the latest one
 * he has registered. Defensive backs read their receivers first (+0.25 s on
 * a run show).
 */
export function belief(s: PlayState, d: Agent): 'run' | 'pass' {
  const as = s.setup.def.assign[d.slot as keyof typeof s.setup.def.assign];
  const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
  const past = c !== null && c.side === 'off' && c.pos.x > s.setup.los;
  // A man-coverage defender's key is his man: he plays the run only when his
  // man blocks (or the ball's across the line), never off a backfield fake.
  if (as.kind === 'man') {
    const m = manOf(s, d)!;
    // His man blocking (or the back he's on carrying it: his run key) shows him run; he fits his gap.
    const k = s.setup.play.assign[m.slot as keyof typeof s.setup.play.assign].kind;
    const blocking = k !== 'route';
    return past || (blocking && s.runShow >= 0 && s.t >= s.runShow + reaction(s, d)) ? 'run' : 'pass';
  }
  const rt = reaction(s, d);
  const db = d.p.pos === 'CB' || d.p.pos === 'S';
  // Deep zones are pass-first by coaching (a ball over your head is the one
  // unforgivable thing): they need to see run a beat longer, longer still
  // against a play-action look (the fake is built to hold them).
  const deep = as.kind === 'zone' && ZONES[as.zone].deep;
  const tRun = s.runShow >= 0 ? s.runShow + rt + (db ? DB_READ : 0) + (deep ? (s.setup.play.pa ? 0.35 : DEEP_READ) : 0) : Infinity;
  // Seeing the ball come out of a fake takes a sharper eye than seeing the
  // fake (Play Recognition: the best read it almost at once, the worst a
  // quarter-second late).
  const tPass = s.passShow >= 0 ? s.passShow + rt + (s.setup.play.pa ? 0.25 * (1 - d.fx.a('playRec')) : 0) : Infinity;
  const seenRun = s.t >= tRun;
  const seenPass = s.t >= tPass;
  if (seenRun && seenPass) return s.runShow > s.passShow ? 'run' : 'pass';
  return seenRun ? 'run' : 'pass';
}

/**
 * A defender who has read run. Engaged defenders are handled by the blocks.
 * Once the ball carrier is at or past the line (or right on him) everyone
 * pursues; before that, linemen and linebackers fill their gap downhill, the
 * contain man stays outside the ball, and the force and alley players come
 * up outside-in. Before a handoff the "ball" is the mesh (QB and back).
 */
export function runFit(s: PlayState, d: Agent): void {
  const los = s.setup.los;
  const by = s.setup.ballY ?? 0;
  const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
  const ball = c ?? s.agents[s.qb]!;
  const committed = c !== null && (c.pos.x > los - 0.5 || s.t - s.runReadT > 0.9);
  if (committed || dist(d.pos, ball.pos) < 3) {
    // Contain: pursue, but never let him outside me.
    const k = d.mem.contain as number | undefined;
    if (k !== undefined && c && (c.pos.y - d.pos.y) * k > -0.5 && c.pos.x < los + 1.5) {
      steer(d, arrive(d, v2(Math.max(los, c.pos.x + 1), c.pos.y + k * 1.2), 1), {});
      return;
    }
    pursue(s, d, ball);
    return;
  }
  const gap = d.mem.gap as number | undefined;
  const k = d.mem.contain as number | undefined;
  if (k !== undefined) {
    // Set the edge: squeeze to a yard outside the widest blocker, a yard deep.
    steer(d, arrive(d, v2(los + 1, Math.max(-FIELD_HALF_W + 1, Math.min(FIELD_HALF_W - 1, by + k * 5.5))), 1, 1), {});
    return;
  }
  if (gap !== undefined) {
    if (d.pos.x < los + 2.5) {
      // A lineman: into his gap at the line.
      steer(d, arrive(d, v2(los + 0.3, gap), 1, 0.6), {});
      return;
    }
    // A linebacker: patient. Level at depth, flowing with the ball over his
    // gap, and downhill only as the back gets to the line (read and flow,
    // then fill: attack too early and the back cuts behind him).
    const toLine = Math.max(0, los - ball.pos.x);
    const depth = Math.max(LB_FIT, Math.min(4.5, LB_FIT + toLine * 0.5));
    const flow = (ball.pos.y - by) * 0.6;
    steer(d, arrive(d, v2(los + depth, gap + flow), 1, 0.6), {});
    return;
  }
  // Force / alley: come up outside-in toward where the ball is heading.
  const aimY = by + (s.setup.play.run?.aim ?? 0) * 1.5;
  const alley = v2(los + 3.5, aimY + Math.sign(d.pos.y - aimY) * 2.5);
  steer(d, arrive(d, alley, 1, 1), {});
}

/** Receivers' stalk blocks on a screen: the man over me, driven away from the ball. */
export function stalk(s: PlayState, b: Agent, toward: V2): void {
  runBlock(s, b, toward, true);
}
