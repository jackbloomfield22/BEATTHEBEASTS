// One play, snap to whistle (TECH_PLAN §10). `stepPlay` advances a fixed
// 1/60 s tick: inputs, roles, engagements, bodies, the ball, contact, and the
// whistle. The state is mutated in place and everything that happened is
// appended to `state.events` for the render, audio and commentary layers.

import { atan2 } from '@/engine/math/detmath';
import {
  assignProtection,
  assignRunBlocks,
  breakOnBall,
  carrierAI,
  manCover,
  openness,
  passBlock,
  pressureOn,
  pursue,
  qbRead,
  reaction,
  runBlock,
  runRoute,
  rush,
  setRoutes,
  zoneCover,
} from './ai';
import { stepFlight } from './ball';
import { blockOf, stepBlocks } from './blocks';
import { applyImpulse, fumbles, resolveTackle, separate, startMove, tickMoves } from './contact';
import { releaseTime } from './effects';
import { BULLET_CHARGE, TAP_MAX, type InputFrame } from './input';
import { remember, steer } from './movement';
import { planThrow, release, resolveCatch, stepAir } from './passing';
import { gauss } from './rand';
import type { PlayState } from './state';
import { BACK_X, END_X, FIELD_HALF_W, GOAL_X, OOB_FOOT, STEP_OUT, TICK, type Agent, type Move, type OffSlot, type PlayResult, type WhistleReason } from './types';
import { HOT_ROUTES } from './plays';
import { dist, len, norm, sub, v2, type V2 } from './vec';

/** Seconds the play keeps animating after the whistle. */
export const DEAD_HOLD = 1.6;
/** Safety net: a play that runs this long is whistled dead (the harness flags it). */
export const MAX_PLAY = 30;

const off = (s: PlayState, slot: string): Agent => s.agents[s.slot[slot]!]!;

/**
 * How far the ball's forward point sits ahead of the carrier's body centre
 * (yd): the 0.25 yd carry offset ballStep holds it at, plus half the ball's
 * length (11 in ≈ 0.31 yd). A dive stretches it out another ~0.4 yd (arms
 * extended). The goal line is the ball breaking the plane, not the body.
 */
const BALL_NOSE = 0.4;
const DIVE_REACH = 0.4;
export function ballNose(c: Agent, x = c.pos.x): number {
  const attack = c.side === 'off' ? 1 : -1;
  return x + attack * (BALL_NOSE + (c.move === 'dive' ? DIVE_REACH : 0));
}

function whistle(s: PlayState, reason: WhistleReason, spot: number, offenseBall: boolean, touchdown = false): void {
  if (s.result) return;
  const los = s.setup.los;
  const yards = offenseBall ? Math.round((spot - los) * 10) / 10 : 0;
  const res: PlayResult = { reason, spot, yards, offenseBall, touchdown, sack: s.sack, ticks: s.tick, ...(s.pass ? { pass: s.pass } : {}) };
  s.result = res;
  s.phase = 'dead';
  s.whistleT = s.t;
  if (s.ball.mode === 'air' || s.ball.mode === 'loose') s.ball.mode = 'dead';
  s.events.push({ t: s.t, type: 'whistle', data: { reason, yards, touchdown } });
}

function doSnap(s: PlayState): void {
  s.phase = 'snap';
  s.snapT = s.t;
  s.read = { idx: 0, since: s.t + s.setup.play.drop.set };
  setRoutes(s);
  assignProtection(s);
  assignRunBlocks(s);
  for (const a of s.agents) a.anim = a.side === 'off' && a.slot !== 'QB' ? 'run' : a.anim;
  s.ball.holder = s.qb;
  s.events.push({ t: s.t, type: 'snap', who: [s.slot.C!, s.qb] });
  // Press at the line: Beat Press against Press decides who's jammed.
  for (const i of s.def) {
    const d = s.agents[i]!;
    const as = s.setup.def.assign[d.slot as keyof typeof s.setup.def.assign];
    if (as.kind !== 'man' || !as.press) continue;
    const r = off(s, as.on);
    if (dist(r.pos, d.pos) > 2.5) continue;
    const edge = d.fx.a('press') - r.fx.a('beatPress') + 0.05 * gauss(s.rng.ai);
    if (edge > 0) r.busy = Math.round(60 * (0.12 + 0.9 * edge));
    else d.busy = Math.round(60 * (0.1 + 0.8 * -edge));
  }
}

/** Snap ball from the center to the QB (shotgun) and the QB's drop or mesh. */
function qbBeforeThrow(s: PlayState, inp: InputFrame): void {
  const qb = s.agents[s.qb]!;
  const play = s.setup.play;
  const since = s.t - s.snapT;
  const by = s.setup.ballY ?? 0;
  if (play.run) {
    // Mesh: step toward the back, hand it off.
    const rb = off(s, 'RB');
    steer(qb, s.phase === 'carrier' ? { x: 0, y: 0 } : { x: 0, y: (rb.pos.y - qb.pos.y) * 1.5 }, { pace: 0.4, face: atan2(rb.pos.y - qb.pos.y, rb.pos.x - qb.pos.x) });
    qb.anim = 'handoff';
    if (since >= play.run.mesh && s.phase !== 'carrier' && dist(qb.pos, rb.pos) < 1.8) {
      s.ball.holder = rb.i;
      s.carrier = rb.i;
      s.phase = 'carrier';
      s.runReadT = s.t;
      rb.anim = 'carry';
      s.events.push({ t: s.t, type: 'handoff', who: [qb.i, rb.i] });
    }
    return;
  }
  const dropX = s.setup.los - play.drop.depth;
  if (s.setup.user && since > 0.35 && (inp.move.x !== 0 || inp.move.y !== 0)) {
    // The user moves the QB (camera-relative input already turned into the field frame).
    const sp = inp.sprint ? 1 : 0.55;
    steer(qb, { x: inp.move.x * qb.fx.vmax * sp, y: inp.move.y * qb.fx.vmax * sp }, { face: 0 });
  } else if (qb.pos.x > dropX + 0.1 && since < play.drop.set + 0.2) {
    steer(qb, { x: -qb.fx.vmax * 0.55, y: (by - qb.pos.y) * 2 }, { face: 0 });
    qb.anim = 'drop';
  } else if (!s.setup.user) {
    // AI pocket: slide away from the nearest free rusher, step up against edge pressure.
    let push = v2();
    for (const i of s.def) {
      const d = s.agents[i]!;
      if (d.down || blockOf(s, i)) continue;
      const k = dist(d.pos, qb.pos);
      if (k < 4.5) {
        const away = norm(sub(qb.pos, d.pos));
        push = { x: push.x + away.x * (4.5 - k), y: push.y + away.y * (4.5 - k) };
      }
    }
    const pp = qb.fx.a('pocketPresence');
    const esc = (qb.mem.escape as number | undefined) ?? 0;
    steer(qb, { x: push.x * (0.6 + pp), y: push.y * (0.6 + pp) * 0.8 + esc * 5 }, { face: 0, pace: esc ? 0.9 : 0.6 });
  } else {
    steer(qb, { x: 0, y: 0 }, { face: 0 });
  }
  if (s.phase === 'snap' && since > 0.35) s.phase = 'dropback';
  if (s.phase === 'dropback' && since >= play.drop.set) s.phase = 'pocket';
  // Scramble: crossing the line makes him a runner (he can't throw after).
  if (qb.pos.x > s.setup.los + 0.3 && (s.phase === 'dropback' || s.phase === 'pocket')) {
    s.phase = 'carrier';
    s.carrier = qb.i;
    qb.anim = 'carry';
  }
}

/** Throw inputs (user) or reads (AI) in the pocket. */
function qbThrow(s: PlayState, inp: InputFrame): void {
  const qb = s.agents[s.qb]!;
  const since = s.t - s.snapT;
  if (s.setup.play.run || since < 0.35 || qb.down) return;
  if (s.windup) {
    qb.anim = 'throw';
    if (s.t >= s.windup.at) {
      const w = s.windup;
      s.windup = null;
      const pressure = pressureOn(s, qb);
      const offPlatform = since < s.setup.play.drop.set - 0.05 || len(qb.vel) > 3;
      if (w.away) {
        // Throw it away: over the nearest sideline.
        const side = qb.pos.y >= 0 ? 1 : -1;
        const rec = { ...qb, pos: v2(qb.pos.x + 12, side * (FIELD_HALF_W + 6)), vel: v2(), route: null } as Agent;
        const plan = planThrow(s, qb, rec, 0.3, v2(), 0, false);
        release(s, qb, s.agents[s.icons[0]!]!, plan);
        s.ball.target = -3;
        s.pass = { attempted: true, complete: false, intercepted: false, airYards: 0, target: -1 };
      } else {
        const rec = s.agents[s.icons[w.icon]!]!;
        const plan = planThrow(s, qb, rec, w.charge, w.aim, pressure, offPlatform);
        release(s, qb, rec, plan);
      }
      qb.busy = 20;
    }
    return;
  }
  const start = (icon: number, charge: number, aim: V2, away = false) => {
    s.windup = { at: s.t + releaseTime(qb.fx.r('release')), icon, charge, aim, away };
    qb.anim = 'throw';
    s.eyes = away ? s.eyes : { ...s.agents[s.icons[icon]!]!.pos };
  };
  if (s.setup.user) {
    if (inp.pumpFake && qb.busy === 0) {
      qb.busy = 18;
      s.pumpUntil = s.t + 0.45;
      s.events.push({ t: s.t, type: 'move', who: [qb.i], data: { move: 'pumpFake' } });
    }
    if (inp.throwAway && Math.abs(qb.pos.y - (s.setup.ballY ?? 0)) > 3.5) {
      start(0, 0.3, v2(), true);
      return;
    }
    if (inp.throwHeld > 0 && inp.throwHeld <= s.icons.length) {
      if (s.hold.icon !== inp.throwHeld) s.hold = { icon: inp.throwHeld, ticks: 0 };
      s.hold.ticks++;
      s.eyes = { ...s.agents[s.icons[inp.throwHeld - 1]!]!.pos };
    } else if (s.hold.icon > 0) {
      const held = s.hold.ticks * TICK;
      const charge = held <= TAP_MAX ? 0 : Math.min(1, (held - TAP_MAX) / BULLET_CHARGE);
      start(s.hold.icon - 1, charge, { x: inp.aim.x, y: inp.aim.y });
      s.hold = { icon: 0, ticks: 0 };
    }
    return;
  }
  if (s.phase !== 'pocket') return;
  const pressure = pressureOn(s, qb);
  const pick = qbRead(s, qb, pressure);
  if (pick >= 0) {
    const r = s.agents[s.icons[pick]!]!;
    const o = openness(s, qb, r);
    // Touch over the top on deep balls; bullets into windows.
    start(pick, o.bullet ? 0.6 : 0, v2());
  } else if ((pressure > 0.9 || s.t - s.snapT - s.setup.play.drop.set > 3) && Math.abs(qb.pos.y - (s.setup.ballY ?? 0)) > 3.5) {
    // Nothing there and he's outside the pocket: throw it away.
    start(0, 0.3, v2(), true);
  } else if (s.t - s.snapT - s.setup.play.drop.set > 3) {
    // Inside the pocket with nothing: escape toward the side with more room, to throw it away.
    const qbY = qb.pos.y - (s.setup.ballY ?? 0);
    qb.mem.escape = qbY >= 0 ? 1 : -1;
  }
}

/** Ticks a carrier move stays pressed when he can't start it yet (0.15 s). */
const MOVE_BUFFER = 9;
/**
 * A carrier move pressed this tick (or null). One pressed while he's still in
 * the last one stays pressed for MOVE_BUFFER ticks and fires on the first
 * tick he can start it, so a press a few frames early isn't lost.
 */
export function bufferedMove(s: PlayState, c: Agent, pressed: Move | null): void {
  if (pressed) {
    c.moveBuf = startMove(s, c, pressed) ? null : { mv: pressed, left: MOVE_BUFFER };
  } else if (c.moveBuf) {
    if (startMove(s, c, c.moveBuf.mv) || --c.moveBuf.left <= 0) c.moveBuf = null;
  }
}

/**
 * Braking when the carrier lets go of the stick, as a share of his cut
 * deceleration: he coasts down over a few strides instead of stopping dead.
 */
const CARRIER_COAST = 0.55;

/**
 * Weight in a cut: a ball carrier asked to change direction sharply at
 * speed slows into the plant first (the want is scaled down, so the steer
 * brakes before it turns), up to 40% for a reversal at full speed and
 * nothing for a gentle bend. A 90° cut at full speed asks for ~77% speed.
 */
export function cutWeight(c: Agent, want: V2): V2 {
  const sp = len(c.vel);
  const wl = len(want);
  if (sp < 0.3 || wl < 0.1) return want;
  const cos = (c.vel.x * want.x + c.vel.y * want.y) / (sp * wl);
  const plant = Math.max(0, Math.min(1, (0.7 - cos) / 1.2));
  const k = 1 - 0.4 * plant * Math.min(1, sp / c.fx.vmax);
  return { x: want.x * k, y: want.y * k };
}

/**
 * The side of a one-button juke. jukeL steps to the carrier's left of his
 * heading. Steering more than a little across the heading picks that side;
 * otherwise he jukes away from the nearest free defender in front of him
 * (to his right when nobody is there).
 */
export function jukeSide(s: PlayState, c: Agent, move: V2, attack: 1 | -1): 'jukeL' | 'jukeR' {
  const sp = len(c.vel);
  const hx = sp > 0.3 ? c.vel.x / sp : attack;
  const hy = sp > 0.3 ? c.vel.y / sp : 0;
  // Cross product of heading and stick: + is to his left.
  const cross = hx * move.y - hy * move.x;
  if (Math.abs(cross) > 0.25) return cross > 0 ? 'jukeL' : 'jukeR';
  let best = Infinity;
  let side = 0;
  for (const i of c.side === 'off' ? s.def : s.off) {
    const d = s.agents[i]!;
    if (d.down || blockOf(s, i)) continue;
    const rx = d.pos.x - c.pos.x;
    const ry = d.pos.y - c.pos.y;
    if (rx * hx + ry * hy < -0.5) continue;
    const k = rx * rx + ry * ry;
    if (k < best) {
      best = k;
      side = hx * ry - hy * rx;
    }
  }
  return side > 0 ? 'jukeR' : 'jukeL';
}

/** The ball carrier: the user's stick and moves, or the AI. */
function carrierStep(s: PlayState, inp: InputFrame): void {
  const c = s.agents[s.carrier]!;
  if (c.down) return;
  const attack: 1 | -1 = c.side === 'off' ? 1 : -1;
  const userCarrier = s.setup.user && c.side === 'off';
  let want: V2;
  if (userCarrier) {
    const sp = inp.sprint && c.stamina > 0.05 ? 1 : 0.84;
    want = { x: inp.move.x * c.fx.vmax * sp, y: inp.move.y * c.fx.vmax * sp };
    const pressed: Move | null = inp.jukeL
      ? 'jukeL'
      : inp.jukeR
        ? 'jukeR'
        : inp.juke
          ? jukeSide(s, c, inp.move, attack)
          : inp.spin
            ? 'spin'
            : inp.stiffArm
              ? 'stiffArm'
              : inp.truck
                ? 'truck'
                : inp.dive
                  ? 'dive'
                  : null;
    bufferedMove(s, c, pressed);
    if (inp.protect && !c.move) c.move = 'protect';
    if (!inp.protect && c.move === 'protect') c.move = null;
  } else {
    want = carrierAI(s, c, attack);
    // A defender squaring up close: try a move that suits him (AI).
    if (c.moveCooldown === 0 && c.busy === 0) {
      for (const i of attack > 0 ? s.def : s.off) {
        const d = s.agents[i]!;
        if (d.down || blockOf(s, i)) continue;
        const rel = sub(d.pos, c.pos);
        const ahead = rel.x * attack;
        const k = len(rel);
        if (k < 2.4 && ahead > 0.3) {
          const r = s.rng.ai();
          if (r < 0.08) {
            const elu = c.fx.a('elusiveness');
            const pow = c.fx.a('trucking') * (c.fx.mass / 110);
            const mv = pow > elu && r < 0.04 ? 'truck' : c.fx.a('stiffArm') > elu ? 'stiffArm' : rel.y > 0 ? 'jukeR' : 'jukeL';
            startMove(s, c, mv);
          }
          break;
        }
      }
    }
  }
  // Committed moves carry him (their velocity change builds over the plant); protecting costs speed.
  applyImpulse(c);
  if (c.busy > 0 && c.move && c.move !== 'protect' && c.move !== 'stiffArm') {
    steer(c, c.vel, { mult: 1 });
  } else {
    steer(c, cutWeight(c, want), { mult: c.move === 'protect' ? 0.88 : 1, brake: len(want) < 0.1 ? CARRIER_COAST : 1 });
  }
  if (c.anim !== 'juke' && c.anim !== 'spin' && c.anim !== 'stiffArm' && c.anim !== 'truck' && c.anim !== 'dive') c.anim = 'carry';
  if (c.move === 'dive' && c.busy <= 1) {
    c.down = true;
    c.anim = 'down';
    // The ball over the plane as he lands is a score, before the whistle for him being down.
    lineCheck(s, c);
    whistle(s, 'tackle', attack > 0 ? Math.max(s.maxX, ballNose(c)) : c.pos.x, c.side === 'off');
  }
}

/** Tackles on the ball carrier (or the QB in the pocket). */
function contactStep(s: PlayState): void {
  const holder = s.ball.mode === 'held' ? s.ball.holder : -1;
  if (holder < 0) return;
  const c = s.agents[holder]!;
  if (c.down || s.result) return;
  const inPocket = holder === s.qb && s.phase !== 'carrier';
  if (s.t - s.snapT < 0.4) return;
  for (const o of s.agents) {
    if (o.side === c.side || o.down || o.busy > 0) continue;
    // Engaged defenders can come off a block for an arm tackle as he passes (lower odds).
    const engaged = blockOf(s, o.i);
    if (engaged && (dist(o.pos, c.pos) > o.fx.radius + c.fx.radius + 0.35 || s.rng.contact() > 0.25)) continue;
    if (((o.mem.tackleCd as number | undefined) ?? -1) > s.t) continue;
    const k = dist(o.pos, c.pos);
    // Arms reach ~0.45 yd past the bodies; a diving tackle ~1 yd more when he
    // can't close on a runner pulling away (lower odds, and he's on the ground after).
    const armReach = o.fx.radius + c.fx.radius + 0.6;
    let dive = false;
    if (k > armReach) {
      // Level with him or losing ground: a diving tackle (~1 yd more reach).
      const closing = ((o.vel.x - c.vel.x) * (c.pos.x - o.pos.x) + (o.vel.y - c.vel.y) * (c.pos.y - o.pos.y)) / Math.max(1e-6, k);
      if (k < armReach + 1.0 && closing < 0.6 && s.rng.contact() < 0.05) dive = true;
      else continue;
    }
    const { out: out0, force } = resolveTackle(s, o, c);
    let out = out0;
    if (engaged) {
      // Off the block: he gets an arm on him half the time it would have been a tackle.
      if ((out === 'tackle' || out === 'bigHit') && s.rng.contact() < 0.5) out = 'broken';
      if (out === 'tackle' || out === 'bigHit') s.blocks.splice(s.blocks.indexOf(engaged), 1);
    }
    if (dive) {
      o.anim = 'dive';
      if ((out === 'tackle' || out === 'bigHit') && s.rng.contact() > 0.55) out = 'broken';
      if (out !== 'tackle' && out !== 'bigHit') {
        o.down = true;
        o.anim = 'down';
        s.events.push({ t: s.t, type: 'missedTackle', who: [o.i, c.i], data: { dive: true } });
        continue;
      }
    }
    if (out === 'missed') {
      o.busy = 36;
      o.vel.x *= 0.3;
      o.vel.y *= 0.3;
      o.mem.tackleCd = s.t + 1;
      s.events.push({ t: s.t, type: 'missedTackle', who: [o.i, c.i] });
      continue;
    }
    if (out === 'broken') {
      c.vel.x *= 0.62;
      c.vel.y *= 0.62;
      o.busy = 28;
      o.mem.tackleCd = s.t + 0.9;
      s.events.push({ t: s.t, type: 'brokenTackle', who: [c.i, o.i], data: { force: Math.round(force * 10) / 10 } });
      continue;
    }
    // Down he goes (or the ball comes out).
    s.events.push({ t: s.t, type: 'hit', who: [o.i, c.i], at: { ...c.pos }, data: { force: Math.round(force * 10) / 10, big: out === 'bigHit' } });
    o.anim = 'tackle';
    if (!inPocket && fumbles(s, o, c, out === 'bigHit')) {
      s.ball.mode = 'loose';
      s.ball.holder = -1;
      s.ball.pos = { x: c.pos.x, y: c.pos.y, z: 1 };
      s.ball.vel = { x: c.vel.x * 0.5 + gauss(s.rng.bounce) * 2, y: c.vel.y * 0.5 + gauss(s.rng.bounce) * 2, z: 2.5 };
      s.phase = 'loose';
      s.carrier = -1;
      c.down = true;
      c.anim = 'tackled';
      s.events.push({ t: s.t, type: 'fumble', who: [c.i, o.i], at: { ...c.pos } });
      return;
    }
    c.down = true;
    c.anim = 'tackled';
    o.down = out === 'bigHit' ? false : true;
    const attack = c.side === 'off' ? 1 : -1;
    if (inPocket) {
      s.sack = true;
      s.events.push({ t: s.t, type: 'sack', who: [o.i, c.i], at: { ...c.pos } });
      whistle(s, c.pos.x <= 0 ? 'safety' : 'sack', c.pos.x, true);
    } else {
      s.events.push({ t: s.t, type: 'tackle', who: [o.i, c.i], at: { ...c.pos }, data: { big: out === 'bigHit' } });
      whistle(s, 'tackle', attack > 0 ? Math.max(s.maxX, ballNose(c)) : c.pos.x, c.side === 'off');
    }
    return;
  }
}

/** The ball: in hands, in the air, or loose. */
function ballStep(s: PlayState): void {
  const b = s.ball;
  if (b.mode === 'held') {
    const h = s.agents[b.holder]!;
    // The snap travels from the center to the QB's hands (shotgun, ~0.3 s).
    const snapT = s.snapT < 0 ? 0 : Math.min(1, (s.t - s.snapT) / 0.33);
    const c = off(s, 'C');
    // Carried a quarter-yard ahead of his body, the way he's running (ballNose reads the same offset).
    const hx = h.pos.x + 0.25 * (h.side === 'off' ? 1 : -1);
    if (s.snapT >= 0 && snapT < 1 && b.holder === s.qb) {
      b.pos = { x: c.pos.x + (hx - c.pos.x) * snapT, y: c.pos.y + (h.pos.y - c.pos.y) * snapT, z: 0.2 + 0.9 * snapT };
    } else if (s.snapT >= 0) {
      b.pos = { x: hx, y: h.pos.y, z: h.down ? 0.25 : 1.15 };
    }
    return;
  }
  if (b.mode === 'air') {
    const who = stepAir(s);
    if (who >= 0) {
      s.touched.push(who);
      const a = s.agents[who]!;
      const out = resolveCatch(s, a);
      if (out === 'catch' || out === 'int') {
        b.mode = 'held';
        b.holder = who;
        s.carrier = who;
        s.phase = 'carrier';
        a.anim = 'catch';
        a.busy = Math.max(a.busy, 10);
        if (out === 'catch') {
          const type = s.catchType ?? 'rac';
          if (type === 'aggressive') {
            a.vel.x *= 0.35;
            a.vel.y *= 0.35;
          } else if (type === 'possession') {
            a.vel.x *= 0.6;
            a.vel.y *= 0.6;
          }
          if (s.pass) s.pass.complete = true;
          s.events.push({ t: s.t, type: 'catch', who: [who], at: { x: a.pos.x, y: a.pos.y }, data: { type } });
        } else {
          if (s.pass) s.pass.intercepted = true;
          s.events.push({ t: s.t, type: 'interception', who: [who], at: { x: a.pos.x, y: a.pos.y } });
        }
        // A catch out of bounds is an incompletion (no toe-tap unless
        // possession: GDD §9.2), and so is one behind an end line.
        const wide = Math.abs(a.pos.y) > FIELD_HALF_W - OOB_FOOT;
        const toe = wide && out === 'catch' && s.catchType === 'possession' && Math.abs(a.pos.y) < FIELD_HALF_W + 0.4;
        const deep = a.pos.x > END_X - OOB_FOOT || a.pos.x < BACK_X + OOB_FOOT;
        if ((wide && !toe) || deep) {
          if (s.pass) {
            s.pass.complete = false;
            s.pass.intercepted = false;
          }
          s.events.push({ t: s.t, type: 'catchOutOfBounds', who: [who], at: { x: a.pos.x, y: a.pos.y } });
          whistle(s, 'incomplete', s.setup.los, true);
        }
        return;
      }
      if (out === 'drop' || out === 'deflect') {
        // The ball pops up off his hands: live, anyone can play a tip.
        b.target = -2;
        b.vel = { x: b.vel.x * 0.25 + gauss(s.rng.bounce), y: b.vel.y * 0.25 + gauss(s.rng.bounce), z: 2.5 + 2 * s.rng.bounce() };
        // A contested ball knocked from a receiver's hands: credit the defender who got there.
        let by = who;
        if (out === 'deflect' && a.side === 'off') {
          let bd = Infinity;
          for (const i of s.def) {
            const k = dist(s.agents[i]!.pos, a.pos);
            if (k < bd) {
              bd = k;
              by = i;
            }
          }
        }
        s.events.push({ t: s.t, type: out === 'drop' ? 'drop' : 'deflection', who: by === who ? [who] : [by, who], at: { x: a.pos.x, y: a.pos.y } });
      }
    }
    if (b.pos.z <= 0.05) {
      b.pos.z = 0.05;
      whistle(s, 'incomplete', s.setup.los, true);
    }
    return;
  }
  if (b.mode === 'loose') {
    stepFlight(b.pos, b.vel);
    if (b.pos.z <= 0.1) {
      b.pos.z = 0.1;
      b.vel = { x: b.vel.x * 0.55 + gauss(s.rng.bounce) * 0.6, y: b.vel.y * 0.55 + gauss(s.rng.bounce) * 0.6, z: Math.abs(b.vel.z) * 0.4 };
    }
    if (Math.abs(b.pos.y) > FIELD_HALF_W) {
      whistle(s, 'fumbleOut', b.pos.x, true);
      return;
    }
    // Recovery: someone with the ball at his feet and a hand on it.
    for (const a of s.agents) {
      if (a.down) continue;
      if (dist(a.pos, { x: b.pos.x, y: b.pos.y }) < 0.8 && b.pos.z < 0.7 && s.rng.bounce() < 0.3) {
        b.mode = 'held';
        b.holder = a.i;
        s.carrier = a.i;
        s.phase = 'carrier';
        s.events.push({ t: s.t, type: 'recovery', who: [a.i], at: { ...a.pos } });
        return;
      }
    }
  }
}

function offenseRoles(s: PlayState, inp: InputFrame): void {
  const play = s.setup.play;
  const carrier = s.carrier >= 0 ? s.agents[s.carrier]! : null;
  for (const i of s.off) {
    const a = s.agents[i]!;
    if (a.down || i === s.carrier) continue;
    if (i === s.qb) {
      if (s.phase === 'snap' || s.phase === 'dropback' || s.phase === 'pocket' || (play.run && s.phase === 'carrier' && s.t - s.snapT < 1)) qbBeforeThrow(s, inp);
      else steer(a, { x: 0, y: 0 }, { pace: 0.3 });
      continue;
    }
    const as = play.assign[a.slot as keyof typeof play.assign];
    if (carrier && carrier.side === 'off') {
      // Blocking for the ball carrier (receivers mid-route keep running until close).
      if (as.kind === 'route' && s.ball.mode === 'held' && dist(a.pos, carrier.pos) > 12) runRoute(s, a);
      // Linemen keep driving at the point of attack; everyone else blocks downfield.
      else runBlock(s, a, carrier.pos, !(as.kind === 'runBlock' && (a.slot === 'LT' || a.slot === 'LG' || a.slot === 'C' || a.slot === 'RG' || a.slot === 'RT')));
      continue;
    }
    if (carrier && carrier.side === 'def') {
      // Turnover: everyone chases the returner.
      if (!blockOf(s, i)) pursueTackle(s, a, carrier);
      continue;
    }
    if (s.phase === 'loose' || s.ball.mode === 'loose') {
      steer(a, { x: (s.ball.pos.x - a.pos.x) * 3, y: (s.ball.pos.y - a.pos.y) * 3 });
      continue;
    }
    switch (as.kind) {
      case 'route':
        if (s.phase === 'air' && s.ball.target === i) {
          // Go get it: to the catch point, adjusting to where it's coming down.
          const to = { x: s.ball.aim.x, y: s.ball.aim.y };
          steer(a, { x: (to.x - a.pos.x) * 4, y: (to.y - a.pos.y) * 4 });
        } else runRoute(s, a);
        break;
      case 'passBlock':
        passBlock(s, a);
        break;
      case 'runBlock':
        runBlock(s, a, v2(s.setup.los + 3, (s.setup.ballY ?? 0) + (play.run?.aim ?? 0)));
        break;
      case 'carry': {
        // Before the handoff: to the mesh point beside the QB.
        const qb = s.agents[s.qb]!;
        const mesh = v2(qb.pos.x + 0.3, qb.pos.y + (play.run?.aim ?? 0) * 0.25);
        steer(a, { x: (mesh.x - a.pos.x) * 3, y: (mesh.y - a.pos.y) * 3 }, { pace: 0.7 });
        break;
      }
      default:
        break;
    }
  }
  if (carrier && carrier.side === 'off' && s.carrier === carrier.i) {
    // A handoff: first hit the aiming point, then read it.
    const freeNear = s.def.some((i) => !blockOf(s, i) && !s.agents[i]!.down && dist(s.agents[i]!.pos, carrier.pos) < 3);
    if (play.run && carrier.slot === 'RB' && carrier.pos.x < s.setup.los - 0.8 && s.t - s.runReadT < 1.2 && !freeNear) {
      const aim = v2(s.setup.los + 1, (s.setup.ballY ?? 0) + play.run.aim);
      steer(carrier, { x: (aim.x - carrier.pos.x) * 3, y: (aim.y - carrier.pos.y) * 3 });
      carrier.anim = 'carry';
    } else carrierStep(s, inp);
  } else if (carrier && carrier.side === 'def') {
    carrierStep(s, inp);
  }
}

function pursueTackle(s: PlayState, a: Agent, t: Agent): void {
  if (a.busy > 0) {
    steer(a, { x: 0, y: 0 });
    return;
  }
  pursue(s, a, t);
}

function defenseRoles(s: PlayState): void {
  const call = s.setup.def.assign;
  const carrier = s.carrier >= 0 ? s.agents[s.carrier]! : null;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down || i === s.carrier) continue;
    if (blockOf(s, i)) continue;
    if (d.busy > 0) {
      steer(d, { x: 0, y: 0 }, { pace: 0.3 });
      continue;
    }
    if (s.phase === 'loose' || s.ball.mode === 'loose') {
      steer(d, { x: (s.ball.pos.x - d.pos.x) * 3, y: (s.ball.pos.y - d.pos.y) * 3 });
      continue;
    }
    if (carrier && carrier.side === 'off') {
      // Run read: the front reacts first; after a catch everyone pursues.
      const readT = s.runReadT >= 0 ? s.runReadT + reaction(s, d) : -1;
      if (s.runReadT < 0 || s.t >= readT) {
        pursueTackle(s, d, carrier);
        continue;
      }
    }
    if (carrier && carrier.side === 'def') {
      // Our turnover: block for the returner (just head upfield with him).
      steer(d, { x: -d.fx.vmax * 0.8, y: (carrier.pos.y - d.pos.y) * 0.5 });
      continue;
    }
    if (s.phase === 'air') {
      const t0 = (d.mem.sawThrow as number | undefined) ?? -1;
      if (t0 < 0) d.mem.sawThrow = s.t;
      const since = s.t - ((d.mem.sawThrow as number | undefined) ?? s.t);
      const near = dist(d.pos, { x: s.ball.aim.x, y: s.ball.aim.y }) < 20;
      if (near && since >= reaction(s, d) && s.ball.target !== -3) {
        breakOnBall(s, d);
        continue;
      }
    }
    const as = call[d.slot as keyof typeof call];
    switch (as.kind) {
      case 'rush':
        if (s.phase === 'air') pursueTackle(s, d, s.agents[Math.max(0, s.ball.target)]!);
        else rush(s, d);
        break;
      case 'man':
        manCover(s, d, off(s, as.on));
        break;
      case 'zone':
        zoneCover(s, d, as.zone);
        break;
    }
  }
}

/** Advance the play one tick with this tick's input. */
export function stepPlay(s: PlayState, inp: InputFrame): void {
  s.tick++;
  s.t = s.tick * TICK;
  for (const a of s.agents) tickMoves(a);
  if (s.phase === 'presnap') {
    // A hot route called at the line: that receiver runs the new route from the snap.
    const h = inp.hotRoute;
    if (h && HOT_ROUTES.includes(h.route) && h.icon >= 1 && h.icon <= s.icons.length) {
      const a = s.agents[s.icons[h.icon - 1]!]!;
      s.hot[a.slot as OffSlot] = h.route;
      s.events.push({ t: s.t, type: 'hotRoute', who: [a.i], data: { route: h.route } });
    }
    if (inp.snap || (!s.setup.user && (s.setup.autoSnap ?? true))) doSnap(s);
    for (const a of s.agents) remember(a);
    return;
  }
  if (s.phase === 'dead') {
    // Dead ball: everyone pulls up.
    for (const a of s.agents) {
      if (!blockOf(s, a.i)) steer(a, { x: 0, y: 0 }, { pace: 0.2 });
      remember(a);
    }
    s.blocks.length = 0;
    return;
  }
  if (s.phase === 'air' && inp.catchType) s.catchType = inp.catchType;
  if (s.phase !== 'air' && s.phase !== 'carrier') qbThrow(s, inp);
  offenseRoles(s, inp);
  defenseRoles(s);
  const goal = s.carrier >= 0 ? s.agents[s.carrier]!.pos : s.agents[s.qb]!.pos;
  stepBlocks(s, goal);
  // Where the carrier's own move took him, before bodies push apart: a ball
  // that broke the plane in his stride is over, even if contact then shoves him back.
  const moved = s.carrier >= 0 ? { x: s.agents[s.carrier]!.pos.x, y: s.agents[s.carrier]!.pos.y } : null;
  separate(s);
  ballStep(s);
  // Forward progress, the lines, the goal line: before any tackle this tick.
  // A runner whose ball broke the plane scored, whoever hits him as it does;
  // a catch with the ball in the end zone is a score at the catch.
  if (s.carrier >= 0 && !s.result) lineCheck(s, s.agents[s.carrier]!, moved);
  contactStep(s);
  keepInBounds(s);
  if (!s.result && s.t - s.snapT > MAX_PLAY) whistle(s, 'timeout', Number.isFinite(s.maxX) ? s.maxX : s.setup.los, true);
  for (const a of s.agents) remember(a);
}

/**
 * Fraction (0..1) of this tick's move from p0 to p1 at which the carrier's
 * foot first touched a boundary (a sideline or an end line), or null if he's
 * in bounds at p1. 0 if he was already touching at p0.
 */
export function outAt(p0: V2, p1: V2): number | null {
  const lim = FIELD_HALF_W - OOB_FOOT;
  const out = (p: V2) => Math.abs(p.y) > lim || p.x > END_X - OOB_FOOT || p.x < BACK_X + OOB_FOOT;
  if (!out(p1)) return null;
  if (out(p0)) return 0;
  let f = 1;
  const cross = (a: number, b: number, line: number) => {
    if ((a - line) * (b - line) < 0) f = Math.min(f, (line - a) / (b - a));
  };
  cross(p0.y, p1.y, lim);
  cross(p0.y, p1.y, -lim);
  cross(p0.x, p1.x, END_X - OOB_FOOT);
  cross(p0.x, p1.x, BACK_X + OOB_FOOT);
  return f;
}

/** Fraction of the move at which he reached a goal line (x = goal, going the attack way), or null. 0 if already past it. */
function goalAt(p0: V2, p1: V2, goal: number, attack: 1 | -1): number | null {
  if ((p1.x - goal) * attack < 0) return null;
  if ((p0.x - goal) * attack >= 0) return 0;
  return (goal - p0.x) / (p1.x - p0.x);
}

/**
 * The ball carrier and the lines, in the order he met them this tick. A
 * score needs the ball across the goal line in bounds: if his foot touched a
 * sideline (or he was out the back) before the ball reached the goal line,
 * it's out of bounds where he went out, not a touchdown. Runs before the
 * tackle check each tick, and again at the end of a dive.
 */
function lineCheck(s: PlayState, c: Agent, moved: V2 | null = null): void {
  const p0 = c.hist[c.hist.length - 1]?.pos ?? c.pos;
  const p1 = c.pos;
  const attack: 1 | -1 = c.side === 'off' ? 1 : -1;
  const fo = outAt(p0, p1);
  // The goal line is the ball's forward point breaking the plane, at the
  // farthest he got this tick (his stride, before contact pushed him back).
  // (The ball carrier's run is the same line as `moved` → p1 give or take a
  // push of a few centimetres, so the fractions compare.)
  const far = moved && (moved.x - p1.x) * attack > 0 ? moved : p1;
  const fg = goalAt({ x: ballNose(c, p0.x), y: p0.y }, { x: ballNose(c, far.x), y: far.y }, attack > 0 ? GOAL_X : 0, attack);
  const at = (f: number) => ({ x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f });
  if (fg !== null && (fo === null || fg < fo)) {
    const o = at(fg);
    s.events.push({ t: s.t, type: 'touchdown', who: [c.i], at: { x: ballNose(c, o.x), y: o.y } });
    whistle(s, 'touchdown', attack > 0 ? GOAL_X : 0, attack > 0, true);
    return;
  }
  if (c.side === 'off') s.maxX = Math.max(s.maxX, Math.min(p1.x, fo !== null ? at(fo).x : p1.x));
  if (fo !== null) {
    const o = at(fo);
    s.events.push({ t: s.t, type: 'outOfBounds', who: [c.i], at: o });
    if (c.side === 'def' && o.x > END_X - 1) whistle(s, 'touchback', GOAL_X - 20, false);
    else if (c.side === 'off' && o.x < BACK_X + 1) whistle(s, 'safety', 0, true);
    else whistle(s, 'outOfBounds', c.side === 'off' ? Math.min(s.maxX, o.x) : o.x, c.side === 'off');
    return;
  }
  if (c.side === 'off' && c.slot === 'QB' && s.phase !== 'carrier' && p1.x <= 0) whistle(s, 'safety', 0, true);
}

/**
 * The lines as hard limits for everyone but the ball carrier (his are the
 * rules above): a player may drift a step past a sideline or an end line
 * while the play is live, no further; his outward speed is taken away there.
 */
function keepInBounds(s: PlayState): void {
  const yl = FIELD_HALF_W + STEP_OUT;
  for (const a of s.agents) {
    if (a.i === s.carrier) continue;
    if (a.pos.y > yl || a.pos.y < -yl) {
      a.pos.y = Math.sign(a.pos.y) * yl;
      if (a.vel.y * a.pos.y > 0) a.vel.y = 0;
    }
    if (a.pos.x > END_X + STEP_OUT) {
      a.pos.x = END_X + STEP_OUT;
      if (a.vel.x > 0) a.vel.x = 0;
    } else if (a.pos.x < BACK_X - STEP_OUT) {
      a.pos.x = BACK_X - STEP_OUT;
      if (a.vel.x < 0) a.vel.x = 0;
    }
  }
}

/** Run a play to its whistle with a fixed input source (headless). */
export function runToWhistle(s: PlayState, inputAt: (s: PlayState) => InputFrame, maxTicks = 60 * 40): PlayState {
  for (let k = 0; k < maxTicks && !s.result; k++) stepPlay(s, inputAt(s));
  return s;
}
