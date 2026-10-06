// One play, snap to whistle (TECH_PLAN §10). `stepPlay` advances a fixed
// 1/60 s tick: inputs, roles, engagements, bodies, the ball, contact, and the
// whistle. The state is mutated in place and everything that happened is
// appended to `state.events` for the render, audio and commentary layers.

import { atan2, cos, sin } from '@/engine/math/detmath';
import { assignRunBlocks, assignRunFits, assignStalks, backToMesh, belief, keepIt, qbMesh, qbRunner, readEndStep, readKeep, runFit, schemeBlock, setZoneRead, stalk } from './runs';
import {
  assignProtection,
  breakOnBall,
  carrierAI,
  intercept,
  convoySide,
  convoySpot,
  screenConvoy,
  manCover,
  onRhythm,
  RHYTHM_READ,
  boundaryGovern,
  numberReceivers,
  passBlock,
  openness,
  pressureOn,
  pressureFrom,
  pursue,
  qbRead,
  reaction,
  routeOf,
  runBlock,
  runRoute,
  rush,
  setRoutes,
  zoneCover,
} from './ai';
import { stepFlight } from './ball';
import { blockOf, stepBlocks } from './blocks';
import { applyImpulse, fumbles, goesLow, resolveTackle, separate, slides, startMove, tackleOdds, tickMoves } from './contact';
import { feetStep, grab, holdKind, knockDown, pileStep, tickDowned } from './tackle';
import { LOFT_CHARGE, TAP_MAX, type InputFrame } from './input';
import { advance, arrive, remember, steer, timeTo } from './movement';
import { aiMove, autoMove, carrierOptions, OPTIONS_EVERY, type MoveOption } from './moves';
import { autoCatch, catchLook, findsBallAt, LAP_R, planThrow, reach, release, releaseOf, resolveCatch, stepAir } from './passing';
import { gauss } from './rand';
import { has } from './traits';
import { manOf, type PlayState } from './state';
import { BACK_X, END_X, FIELD_HALF_W, GOAL_X, OOB_FOOT, STEP_OUT, TICK, type Agent, type Move, type OffSlot, type PlayResult, type WhistleReason } from './types';
import { DRAWS, HOT_ROUTES } from './plays';
import { dist, len, norm, sub, v2, type V2 } from './vec';
import { readTag, routePoints } from './ai';

/** The hitch off a dropback (s): a step up into the pocket before the throw (the rhythm of a five-step drop and hitch). */
const HITCH = 0.3;

/** The window (yd, openness()) a scrambling AI QB still throws into: a man running free. */
const SCRAMBLE_THROW = 5;

/**
 * Where a tackler gets his hands on a man (yd): each man's reach base
 * (effects.ts `reach`) plus this. For the tackler that's his hands' reach
 * from his centre, 0.9–1.0 m to the side as docs/m65/BODIES.md measured the
 * model (reach base ~0.33–0.42 m plus 0.55 m); for the ball carrier, his
 * pads and the jersey a hand closes on. The same distance the sim always
 * had, which the run game's yards before contact and the pass game's yards
 * after the catch are calibrated on. (From the fitted pads with 0.7–0.8 m
 * of arm, contact came 0.25 yd earlier on runs, yards a carry 4.7 → 3.5.)
 */
const ARM_REACH = 0.6;
/** How much further than his arms a defender going by can lunge (yd): a full-length dive at the legs. */
const LUNGE = 1.0;
/** ...and only this far past the line (yd). */
const LUNGE_PAST = 4;
/** ...and how much of a squared-up tackle he keeps at the fingertips. */
const LUNGE_KEEP = 0.85;

/** The closest to a sideline a player who isn't carrying it pulls up (yd): a stride inside the white (keepInBounds); route runners keep more. */
const PULL_UP = 0.35;

/** A toss's flight, s: a 4–5 yd underhand pitch at ~15 yd/s (about 0.3 s). */
const PITCH_T = 0.3;
/** A zone-read keep: the back carries out his fake into the line this long (s) before he blocks. */
const KEEP_FAKE = 0.6;
/** The QB draw's show (s): a step back as the line sets, then he sits in the pocket until he takes off (the play's mesh). */
const QB_DRAW_SHOW = 0.3;

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
  // (Going down in a tackle, the ball goes with him: tackle.ts fallReach, along x the way he attacks.)
  return x + attack * (BALL_NOSE + (c.move === 'dive' ? DIVE_REACH : 0)) + ((c.mem.fallReach as number | undefined) ?? 0);
}

function whistle(s: PlayState, reason: WhistleReason, spot: number, offenseBall: boolean, touchdown = false): void {
  if (s.result) return;
  const los = s.setup.los;
  const yards = offenseBall ? Math.round((spot - los) * 10) / 10 : 0;
  const res: PlayResult = { reason, spot, yards, offenseBall, touchdown, sack: s.sack, ticks: s.tick, ...(s.pass ? { pass: s.pass } : {}), ...(s.bigHit ? { bigHit: s.bigHit } : {}) };
  s.result = res;
  s.phase = 'dead';
  s.whistleT = s.t;
  if (s.ball.mode === 'air' || s.ball.mode === 'loose') s.ball.mode = 'dead';
  s.events.push({ t: s.t, type: 'whistle', data: { reason, yards, touchdown } });
}

function doSnap(s: PlayState): void {
  s.phase = 'snap';
  s.snapT = s.t;
  s.read = { idx: 0, since: s.t + s.setup.play.drop.set, noise: 0, noiseFor: -1 };
  setRoutes(s);
  numberReceivers(s);
  assignProtection(s);
  setZoneRead(s);
  assignRunBlocks(s);
  assignRunFits(s);
  assignStalks(s);
  // What the offense shows the defense, and when (runs.ts belief): a run
  // fires out at the snap; the draw shows pass first (its run show is the
  // handoff); play action shows run, then pass when the ball comes out of
  // the fake; everything else is a pass from the first step.
  const play = s.setup.play;
  if (play.run && !DRAWS.includes(play.run.scheme)) s.runShow = s.t + 0.05;
  else if (play.pa) {
    s.runShow = s.t + 0.05;
    s.passShow = s.t + 0.25 + play.pa.fake;
  } else s.passShow = s.t;
  // The play-action back carries out his fake before his route (set when the fake ends).
  if (play.pa) off(s, 'RB').route = null;
  for (const a of s.agents) a.anim = a.side === 'off' && a.slot !== 'QB' ? 'run' : a.anim;
  s.ball.holder = s.qb;
  s.events.push({ t: s.t, type: 'snap', who: [s.slot.C!, s.qb] });
  // Press at the line: Beat Press against Press decides who's jammed.
  for (const i of s.def) {
    const d = s.agents[i]!;
    const as = s.setup.def.assign[d.slot as keyof typeof s.setup.def.assign];
    const r = manOf(s, d);
    if (as.kind !== 'man' || !as.press || !r) continue;
    if (dist(r.pos, d.pos) > 2.5) continue;
    // A Release Artist beats the jam 25% more often (a quarter of the
    // spread's worth of edge) and is never knocked off his stem; a Jam
    // Artist's jam holds 0.15 s longer (the trait catalog's lines).
    const edge = d.fx.a('press') - r.fx.a('beatPress') + 0.05 * gauss(s.rng.ai) - (has(r, 'release-artist') ? 0.05 : 0);
    if (edge > 0 && !has(r, 'release-artist')) r.busy = Math.round(60 * (0.12 + 0.9 * edge + (has(d, 'jam-artist') ? 0.15 : 0)));
    else if (edge <= 0) d.busy = Math.round(60 * (0.1 + 0.8 * -edge));
  }
}

/** Tuck it and go: the scramble starts (the render plays the tuck and take-off). */
function startScramble(s: PlayState, qb: Agent): void {
  s.scrambleT = s.t;
  s.hold = { icon: 0, ticks: 0 };
  qb.anim = 'carry';
  s.events.push({ t: s.t, type: 'move', who: [qb.i], data: { move: 'tuck' } });
}

/**
 * The AI QB tucks it and runs when coverage has held (he's through most of
 * his reads), the rush hasn't got to him, and there's a running lane up the
 * field (runningLane). Mobile QBs (Speed, Elusiveness) take it more often;
 * a pocket passer mostly keeps looking, then throws it away.
 */
function aiScrambles(s: PlayState, qb: Agent): boolean {
  if (s.phase !== 'pocket' || s.windup || s.ball.mode !== 'held') return false;
  const held = s.t - s.snapT - s.setup.play.drop.set;
  // Through his first reads with nothing there, or the pocket closing on
  // him (M6: most NFL scrambles are escapes from pressure; M5.5 only ran
  // with nobody near him, which with the quicker rush almost never came).
  const pressure = pressureOn(s, qb);
  if (held < (pressure > 0.5 ? 0.9 : 1.6) || qb.pos.x < s.setup.los - 10) return false;
  const lane = runningLane(s, qb);
  if (!lane) return false;
  // Checked every tenth of a second while it's there: a mobile QB takes it
  // within about a second (half the time), a statue almost never; pressure
  // makes it likelier.
  // (His Scramble rating, the QB's own: Elusiveness is a back's rating, so
  // every QB read as a 50 there and Manning left the pocket nearly as often as
  // Lamar Jackson. A Statue only steps up or drifts: a third as often.)
  const mobile = (qb.fx.a('speed') * 0.5 + qb.fx.a('scramble') * 0.5) * (has(qb, 'statue') ? 0.33 : 1);
  if (!(s.tick % 6 === 0 && s.rng.ai() < (0.01 + 0.045 * mobile) * (1 + 2 * pressure))) return false;
  qb.mem.laneX = lane.x;
  qb.mem.laneY = lane.y;
  return true;
}

/**
 * A running lane from the pocket: of five paths up the field (straight, and
 * 20° and 40° either side) to 3 yd past the line, the first with nobody in
 * it: no free defender within 2.5 yd of the path, no engaged one within 1.2
 * (he'd shed into it). Null if the pocket has none.
 */
function runningLane(s: PlayState, qb: Agent): V2 | null {
  const len0 = Math.max(4, s.setup.los + 3 - qb.pos.x);
  for (const deg of [0, 20, -20, 40, -40]) {
    const a = (deg * Math.PI) / 180;
    const dx = cos(a);
    const dy = sin(a);
    let clear = true;
    for (const i of s.def) {
      const d = s.agents[i]!;
      if (d.down) continue;
      const rx = d.pos.x - qb.pos.x;
      const ry = d.pos.y - qb.pos.y;
      const along = Math.max(0, Math.min(len0, rx * dx + ry * dy));
      const px = rx - dx * along;
      const py = ry - dy * along;
      if (Math.sqrt(px * px + py * py) < (blockOf(s, i) ? 1.2 : 2.5)) {
        clear = false;
        break;
      }
    }
    if (clear) return { x: dx, y: dy };
  }
  return null;
}

/**
 * The AI's scramble path. Inside the pocket: escape it, away from the
 * nearest rusher (or to the wider side), bending up a little, clear of the
 * engaged pairs. Once he's outside the tackles or near the line: read the
 * field like a ball carrier (carrierAI).
 */
function scrambleLane(s: PlayState, qb: Agent, pace: number): V2 {
  const by = s.setup.ballY ?? 0;
  // Up the lane he saw, until he's at the line.
  const lx = qb.mem.laneX as number | undefined;
  if (lx !== undefined && qb.pos.x < s.setup.los) {
    const ly = qb.mem.laneY as number;
    return { x: lx * qb.fx.vmax * pace, y: ly * qb.fx.vmax * pace };
  }
  if (Math.abs(qb.pos.y - by) < 5.5 && qb.pos.x < s.setup.los - 1.5) {
    let near: Agent | null = null;
    let nd = Infinity;
    for (const i of s.def) {
      const d = s.agents[i]!;
      if (d.down) continue;
      const k = dist(d.pos, qb.pos);
      if (k < nd) {
        nd = k;
        near = d;
      }
    }
    const away = near && Math.abs(qb.pos.y - near.pos.y) > 0.3 ? Math.sign(qb.pos.y - near.pos.y) : by <= 0 ? 1 : -1;
    const side = (qb.mem.scrambleSide as number | undefined) ?? away;
    qb.mem.scrambleSide = side;
    const n = Math.sqrt(0.3 * 0.3 + 1);
    return { x: (0.3 / n) * qb.fx.vmax * pace, y: (side / n) * qb.fx.vmax * pace };
  }
  const w = carrierAI(s, qb, 1);
  return { x: w.x * pace, y: w.y * pace };
}

/**
 * The play-action fake: from under center a reverse pivot back toward the
 * back's path, the ball extended to his belly, then pulled out (the drop
 * continues from there).
 */
function paFake(s: PlayState, qb: Agent): void {
  const pa = s.setup.play.pa!;
  const rb = off(s, 'RB');
  const mesh = v2(s.setup.los - 3.2, (s.setup.ballY ?? 0) + pa.aim * 0.3);
  steer(qb, arrive(qb, mesh, 0.6, 1), { face: atan2(rb.pos.y - qb.pos.y, rb.pos.x - qb.pos.x) });
  qb.anim = 'handoff';
}

/** Snap ball from the center to the QB (shotgun) and the QB's drop or mesh. */
function qbBeforeThrow(s: PlayState, inp: InputFrame): void {
  const qb = s.agents[s.qb]!;
  const play = s.setup.play;
  const since = s.t - s.snapT;
  const by = s.setup.ballY ?? 0;
  if (play.run) {
    if (play.run.scheme === 'sneak') {
      // The sneak: he keeps it, over the center's back behind the wedge (a designed run: no slide).
      if (since >= play.run.mesh && s.phase !== 'carrier') {
        s.carrier = qb.i;
        s.phase = 'carrier';
        s.runReadT = s.t;
        if (s.runShow < 0) s.runShow = s.t;
        qbRunner(qb);
        qb.anim = 'carry';
      } else steer(qb, { x: qb.fx.vmax * 0.3, y: 0 }, { face: 0 });
      return;
    }
    if (play.run.scheme === 'qbDraw') {
      // The QB draw (a Designed Runner's play): he shows his drop as the line
      // sets, then takes it himself up the middle as the rush runs past.
      if (since >= play.run.mesh && s.phase !== 'carrier') {
        s.carrier = qb.i;
        s.phase = 'carrier';
        s.runReadT = s.t;
        if (s.runShow < 0) s.runShow = s.t;
        qbRunner(qb);
        qb.anim = 'carry';
        s.events.push({ t: s.t, type: 'move', who: [qb.i], data: { move: 'tuck', run: 'draw' } });
      } else if (since < QB_DRAW_SHOW) {
        // The show: a step back as if to throw (from the gun he's already at 5 yd: a deep drop would put him behind the rush he's about to run past).
        steer(qb, { x: -qb.fx.vmax * 0.35, y: 0 }, { face: 0 });
        qb.anim = 'drop';
      } else steer(qb, { x: 0, y: 0 }, { face: 0 });
      return;
    }
    // Mesh: the reverse pivot or the slide to the back, and the handoff (the toss: a pitch, up to ~5 yd).
    const rb = off(s, 'RB');
    qbMesh(s, qb, rb);
    // The zone read: at the mesh he reads the backside end, and keeps it if the end has crashed on the back.
    if (play.run.scheme === 'zoneRead' && since >= play.run.mesh && s.phase !== 'carrier' && qb.mem.keep === undefined && dist(qb.pos, rb.pos) < 1.8) {
      qb.mem.keep = readKeep(s, qb, rb);
      if (qb.mem.keep) {
        keepIt(s, qb);
        return;
      }
    }
    const toss = play.run.scheme === 'toss';
    if (since >= play.run.mesh && s.phase !== 'carrier' && dist(qb.pos, rb.pos) < (toss ? 5.5 : 1.8)) {
      if (toss) s.pitch = { t: s.t, from: { x: qb.pos.x, y: qb.pos.y } };
      s.ball.holder = rb.i;
      s.carrier = rb.i;
      s.phase = 'carrier';
      s.runReadT = s.t;
      // The draw's run show is the handoff itself.
      if (s.runShow < 0) s.runShow = s.t;
      rb.anim = 'carry';
      s.events.push({ t: s.t, type: 'handoff', who: [qb.i, rb.i] });
      rb.mem.handoffAt = s.t;
    }
    return;
  }
  if (play.pa && since < 0.2 + play.pa.fake && !s.setup.user) {
    paFake(s, qb);
    return;
  }
  if (play.pa && since < 0.2 + play.pa.fake && s.setup.user && inp.move.x === 0 && inp.move.y === 0) {
    paFake(s, qb);
    return;
  }
  const dropX = s.setup.los - play.drop.depth;
  // The scramble: the user's key, or the AI when the pocket's gone and nobody's open.
  if (s.scrambleT < 0 && since > 0.35 && (s.setup.user ? inp.scramble : aiScrambles(s, qb))) startScramble(s, qb);
  if (s.scrambleT >= 0) {
    // Tucked: he runs like a ball carrier (context speed, cuts), eyes still downfield until the line.
    // A Statue outside the tackle box (~4 yd off the ball) runs 15% slower (the trait catalog's line).
    const ctxPace = carrierPace(s, qb, 1) * (Math.abs(qb.pos.y - (s.setup.ballY ?? 0)) > 4 && has(qb, 'statue') ? 0.85 : 1);
    const pace = s.setup.user ? userPace(qb, ctxPace, inp) : ctxPace;
    const dir = stickDir(inp.move);
    const want = s.setup.user ? { x: dir.x * qb.fx.vmax * pace, y: dir.y * qb.fx.vmax * pace } : scrambleLane(s, qb, pace);
    autoBurst(s, qb, ctxPace, want);
    steer(qb, cutWeight(qb, want), { brake: len(want) < 0.1 ? CARRIER_COAST : 1, burst: qb.burst > 0 });
    if (qb.anim !== 'throw') qb.anim = 'carry';
  } else if (s.setup.user && since > 0.35 && (inp.move.x !== 0 || inp.move.y !== 0)) {
    // The user moves the QB in the pocket (camera-relative input already in the field frame): controlled steps, eyes downfield.
    const sp = 0.55;
    steer(qb, { x: inp.move.x * qb.fx.vmax * sp, y: inp.move.y * qb.fx.vmax * sp }, { face: 0 });
  } else if (play.drop.boot && since < play.drop.set + 0.2 && dist(qb.pos, v2(dropX, by + play.drop.boot)) > 0.6) {
    // The bootleg: out of the fake he rolls to the boot side, gaining depth, eyes downfield.
    const to = v2(dropX, by + play.drop.boot);
    steer(qb, arrive(qb, to, 0.85, 1), { face: 0 });
    qb.anim = 'drop';
  } else if (!play.drop.boot && qb.pos.x > dropX + 0.1 && since < play.drop.set + 0.2) {
    steer(qb, { x: -qb.fx.vmax * 0.55, y: (by - qb.pos.y) * 2 }, { face: 0 });
    qb.anim = 'drop';
  } else if (!s.setup.user && play.drop.boot && s.windup === null) {
    // Set on the edge after a boot: keep drifting with the flow, square to the line, ready to throw on the run.
    const side = Math.sign(play.drop.boot);
    const room = FIELD_HALF_W - 3 - Math.abs(qb.pos.y);
    steer(qb, { x: 0.6, y: room > 0 ? side * 2.2 : 0 }, { face: 0, pace: 0.5 });
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
    // A Climber steps up into the pocket instead of bailing when the edge
    // collapses (the trait catalog's line): up, not out.
    if (has(qb, 'climber') && (push.x !== 0 || push.y !== 0)) push = { x: Math.abs(push.x) + 0.5 * Math.abs(push.y), y: push.y * 0.4 };
    const esc = (qb.mem.escape as number | undefined) ?? 0;
    // A slow screen: once his line lets the rush go he drifts back, drawing
    // it up the field and buying the beat the convoy needs to get out.
    const drift = play.screen && since >= play.screen.release && qb.pos.x > dropX - SCREEN_DRIFT ? SCREEN_DRIFT_V : 0;
    steer(qb, { x: push.x * (0.6 + pp) - drift, y: push.y * (0.6 + pp) * 0.8 + esc * 5 }, { face: 0, pace: esc ? 0.9 : 0.6 });
  } else {
    steer(qb, { x: 0, y: 0 }, { face: 0 });
  }
  if (s.phase === 'snap' && since > 0.35) s.phase = 'dropback';
  if (s.phase === 'dropback' && since >= play.drop.set) s.phase = 'pocket';
  // Out of the pocket: outside the tackles, or tucked. The rush reacts to it.
  if (s.escapeT < 0 && since > 0.35 && (s.scrambleT >= 0 || Math.abs(qb.pos.y - by) > 4.5)) s.escapeT = s.t;
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
  // Wrapped up in the pocket: no new throw, and one in his motion is smothered
  // unless the ball's about to leave his hand (the last WRAP_THROW s).
  if (wrapped(qb)) {
    if (!s.windup || s.windup.at - s.t > WRAP_THROW) {
      s.windup = null;
      return;
    }
  }
  if (s.windup) {
    qb.anim = 'throw';
    // The player's placement stays live through the windup, until the ball
    // leaves his hand (Playtest 1: it was taken on the key's release and
    // frozen for the ~0.3–0.5 s of the throwing motion).
    if (s.setup.user && !s.windup.away) s.windup.aim = { x: inp.aim.x, y: inp.aim.y };
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
    s.windup = { at: s.t + releaseOf(qb), from: s.t, icon, charge, aim, away };
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
      // A tap drives it; a hold adds touch (more air the longer he holds).
      const tap = s.setup.tapMax ?? TAP_MAX;
      const charge = held <= tap ? 0 : Math.min(1, (held - tap) / LOFT_CHARGE);
      start(s.hold.icon - 1, charge, { x: inp.aim.x, y: inp.aim.y });
      s.hold = { icon: 0, ticks: 0 };
    }
    return;
  }
  if (s.phase !== 'pocket') return;
  const pressure = pressureOn(s, qb);
  // Tucked and running: he'll still throw it to a man running free before the line, nothing tighter.
  if (s.scrambleT >= 0) {
    let best = -1;
    let bs = -Infinity;
    s.icons.forEach((k, j) => {
      const o = openness(s, qb, s.agents[k]!).sep;
      if (o > bs) {
        bs = o;
        best = j;
      }
    });
    if (bs > SCRAMBLE_THROW) start(best, 0, v2());
    return;
  }
  if (s.setup.play.hailMary) {
    // The Hail Mary: let them get there (~1 s after the set, a 9-yd drop
    // gives them 35+ yd), then put it up for the deepest man, all the loft
    // he has, high (a jump ball in a crowd).
    if (s.t - s.snapT - s.setup.play.drop.set >= 0.9 || pressure > 0.8) {
      let deep = 0;
      s.icons.forEach((k, j) => {
        if (s.agents[k]!.pos.x > s.agents[s.icons[deep]!]!.pos.x) deep = j;
      });
      start(deep, 1, v2(0, 0.8));
    }
    return;
  }
  // The rhythm of the drop: off a five-step or a play-action drop he
  // hitches up into the pocket before he lets it go (the quick game and
  // screens are thrown off the top of the drop). Pressure speeds him up.
  const quick = s.setup.play.type === 'quick' || s.setup.play.type === 'screen';
  if (!quick && pressure < 0.6 && s.t - s.snapT < s.setup.play.drop.set + HITCH) return;
  const pick = qbRead(s, qb, pressure);
  if (pick >= 0) {
    // The driven ball; planThrow puts air under it when a defender is in the way.
    // A vertical with the corner on top of him (level or deeper, on his
    // hip): the back-shoulder ball, short and behind him, where only he can
    // turn back to it (M6.5 #6).
    start(pick, 0, backShoulder(s, s.agents[s.icons[pick]!]!) ? v2(-1, -0.2) : v2());
  } else if ((pressure > 0.9 || s.t - s.snapT - s.setup.play.drop.set > 3) && Math.abs(qb.pos.y - (s.setup.ballY ?? 0)) > 3.5) {
    // Nothing there and he's outside the pocket: throw it away.
    start(0, 0.3, v2(), true);
  } else if (s.t - s.snapT - s.setup.play.drop.set > 3) {
    // Inside the pocket with nothing: escape toward the side with more room, to throw it away.
    const qbY = qb.pos.y - (s.setup.ballY ?? 0);
    qb.mem.escape = qbY >= 0 ? 1 : -1;
  }
}

/**
 * A ball batted down at the line (M6.5 calibration: the sim had none; ~2% of
 * NFL attempts, PFF's batted passes). In the first BAT_T of its flight, a
 * defensive lineman whose hands the ball goes by (within BAT_R, under the
 * top of his reach) gets one chance to get a hand on it: BAT_P for a
 * 6'6" lineman, less for a shorter one. It pops up, live, and dies.
 */
function batAtLine(s: PlayState): boolean {
  const b = s.ball;
  if (s.t - b.releaseT > BAT_T || b.target < 0) return false;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down || (d.p.pos !== 'DE' && d.p.pos !== 'DT') || s.touched.includes(i)) continue;
    const dh = Math.sqrt((b.pos.x - d.pos.x) * (b.pos.x - d.pos.x) + (b.pos.y - d.pos.y) * (b.pos.y - d.pos.y));
    if (dh > BAT_R || b.pos.z > reach(d).top || b.pos.z < 1.2) continue;
    s.touched.push(i);
    const tall = Math.max(0, Math.min(1, (d.p.heightIn - 72) / 6));
    // Locked up with a blocker his hands are on the man in front of him: he
    // gets them up into the lane on BAT_ENGAGED of the throws he'd have
    // reached free, unless he's been driven back into the QB's lap.
    const engaged = !!blockOf(s, i) && dist(d.pos, s.agents[b.thrower]!.pos) > LAP_R;
    if (s.rng.catch() >= BAT_P * (0.5 + 0.5 * tall) * (engaged ? BAT_ENGAGED : 1)) continue;
    b.vel = { x: b.vel.x * 0.1 + gauss(s.rng.bounce) * 1.5, y: b.vel.y * 0.1 + gauss(s.rng.bounce) * 1.5, z: 3 + 2 * s.rng.bounce() };
    b.target = -2;
    d.anim = 'rush';
    s.events.push({ t: s.t, type: 'deflection', who: [i], at: { x: b.pos.x, y: b.pos.y }, data: { batted: true } });
    return true;
  }
  return false;
}
const BAT_T = 0.3;
const BAT_R = 0.7;
const BAT_P = 0.45;
/**
 * The share of throws an engaged rusher in the lane gets his hands up to:
 * set so the AI pass game has ~2% of its attempts batted at the line (the
 * NFL runs ~1.5–2%; tools/sim/batted.ts: 1.4% from free rushers and the
 * QB's lap alone, 5.8% with every engaged rusher batting like a free one,
 * 4.2% before the second slant pass, when clearLoft lofted over them).
 */
const BAT_ENGAGED = 0.15;

/** A vertical route with the man covering him level or on top of him, close: the back-shoulder throw. */
function backShoulder(s: PlayState, r: Agent): boolean {
  const name = routeOf(s, r);
  if (name !== 'go' && name !== 'fade' && name !== 'seam') return false;
  // A 12–25 yd ball (past that it's a bomb, not a back-shoulder).
  const depth = r.pos.x - s.setup.los;
  if (depth < 10 || depth > 22 || r.vel.x < 5) return false;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down) continue;
    if (dist(d.pos, r.pos) < 2.2 && d.pos.x > r.pos.x - 0.5) return true;
  }
  return false;
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

/** A SECURE catch goes down with the ball when a defender is this close (yd) as it's caught. */
const SECURE_DOWN = 2;
/** Ticks from a diving catch to landing on the turf (catch_dive: secure at the reach, chest down ~0.4 s later). */
const DIVE_CATCH_LAND = 24;

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
  // The player's arrows are steering him (not the after-catch plan): his changes of direction are planted cuts.
  let steering = false;
  // Context speed (feedback item 3): flat out in space, controlled with a tackler on him.
  const ctxPace = carrierPace(s, c, attack);
  const pace = userCarrier ? userPace(c, ctxPace, inp) : ctxPace;
  if (userCarrier) {
    // The stick is a direction only: his speed is the situation's (a diagonal is as fast as straight ahead).
    const dir = stickDir(inp.move);
    want = { x: dir.x * c.fx.vmax * pace, y: dir.y * c.fx.vmax * pace };
    // A receiver with the ball comes out of the catch already running his
    // plan (the lane he'd take: upfield, the sideline when it's there) until
    // the player steers. M6.5 #4: with the stick at rest through the catch
    // (the thumb was on the catch button) he coasted to a stop, so every
    // catch began with him slowing down in front of the pursuit.
    steering = dir.x !== 0 || dir.y !== 0;
    // In a tackle, the stick is where he drives the pile (tackle.ts pileStep).
    c.mem.wantX = steering ? dir.x : 0;
    c.mem.wantY = steering ? dir.y : 0;
    if (steering) c.mem.steered = true;
    else if (s.t < ((c.mem.cutHold as number | undefined) ?? -1)) {
      // A tapped cut (the arrow let go in the plant) runs on out of it along its new line.
      want = { x: (c.mem.cutDx as number) * c.fx.vmax * pace, y: (c.mem.cutDy as number) * c.fx.vmax * pace };
    } else if (c.mem.caughtAt !== undefined && !c.mem.steered) {
      const plan = carrierAI(s, c, attack);
      want = { x: plan.x * pace, y: plan.y * pace };
    }
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
    // The three options on the HUD (M6.5 #9), re-read every OPTIONS_EVERY
    // ticks; a press of 1–3 is the move in that slot now.
    if (c.mem.opts === undefined || s.tick % OPTIONS_EVERY === 0) c.mem.opts = carrierOptions(s, c).join(',');
    const opt = inp.option > 0 ? ((c.mem.opts as string).split(',')[inp.option - 1] as MoveOption | undefined) : undefined;
    const optMove: Move | null = !opt ? null : opt === 'juke' ? jukeSide(s, c, inp.move, attack) : opt === 'protect' ? null : opt;
    // The one action button: the game picks the move for the picture in front of him (moves.ts autoMove).
    const auto = inp.auto ? autoMove(s, c) : null;
    const autoPick: Move | null = auto && auto !== 'protect' ? auto : null;
    // Protecting from the options (or the action button) holds until the next move (the direct key is held).
    if (opt === 'protect' || auto === 'protect') {
      c.mem.optProtect = true;
      if (!c.move) c.move = 'protect';
    } else if (optMove || pressed || autoPick) c.mem.optProtect = false;
    bufferedMove(s, c, pressed ?? optMove ?? autoPick);
    if (inp.protect && !c.move) c.move = 'protect';
    if (!inp.protect && c.move === 'protect' && !c.mem.optProtect) c.move = null;
  } else {
    want = carrierAI(s, c, attack);
    // A Dancer hesitates in the backfield: a 0.15 s stutter before the hole
    // unless the lane's clean (nobody free within 3 yd) (the trait catalog's line).
    const since = s.t - ((c.mem.handoffAt as number | undefined) ?? -9);
    const stutter = since < 0.15 && has(c, 'dancer') && (attack > 0 ? s.def : s.off).some((i) => !blockOf(s, i) && dist(s.agents[i]!.pos, c.pos) < 3);
    want = { x: want.x * pace * (stutter ? 0.4 : 1), y: want.y * pace * (stutter ? 0.4 : 1) };
    // A quarterback past the line protects himself: he slides a couple of
    // strides before a tackler gets there (as QBs are taught) rather than take the hit.
    if (slides(c) && c.moveCooldown === 0 && c.busy === 0 && (c.pos.x - s.setup.los) * attack > 1) {
      for (const i of attack > 0 ? s.def : s.off) {
        const d = s.agents[i]!;
        if (d.down || blockOf(s, i)) continue;
        if (dist(d.pos, c.pos) < 3.5 && (d.pos.x - c.pos.x) * attack > -1) {
          startMove(s, c, 'dive');
          break;
        }
      }
    }
    // A defender squaring up close: try a move that suits him (AI). Not a
    // QB on a sneak still in the pile (within a yard of the line): he
    // lowers his pads and pushes; a juke there looked like a stumble.
    const inPile = s.setup.play.run?.scheme === 'sneak' && c.i === s.qb && (c.pos.x - s.setup.los) * attack < 1;
    if (c.moveCooldown === 0 && c.busy === 0 && !inPile) {
      for (const i of attack > 0 ? s.def : s.off) {
        const d = s.agents[i]!;
        if (d.down || blockOf(s, i)) continue;
        const rel = sub(d.pos, c.pos);
        const ahead = rel.x * attack;
        const k = len(rel);
        if (k < 2.4 && ahead > 0.3) {
          // One decision per tackler as he closes (M6: a roll every tick
          // tried a move on nearly every one, and broken or missed tackles
          // ran at 0.4 a carry against the NFL's ~0.2): a back with moves
          // tries one on ~30–45% of them.
          if (c.mem[`mv${d.i}`]) break;
          c.mem[`mv${d.i}`] = true;
          const r = s.rng.ai() * (0.12 / (0.25 + 0.2 * Math.max(c.fx.a('elusiveness'), c.fx.a('stiffArm'))));
          if (r < 0.08) {
            startMove(s, c, aiMove(s, c, d));
          }
          break;
        }
      }
    }
  }
  // Bodies on the ground in his path: over them (the AI, or the one button at speed) or through them (tackle.ts).
  if (!s.pile && feetStep(s, c, !userCarrier || inp.auto, (d) => startMove(s, c, 'hurdle', d))) {
    whistle(s, 'tackle', attack > 0 ? Math.min(Math.max(s.maxX, ballNose(c)), GOAL_X - 0.05) : Math.max(ballNose(c), 0.05), c.side === 'off');
    return;
  }
  autoBurst(s, c, ctxPace, want);
  // Committed moves carry him (their velocity change builds over the plant); protecting costs speed.
  applyImpulse(c);
  if (c.busy > 0 && c.move && c.move !== 'protect' && c.move !== 'stiffArm') {
    c.mem.cutLeft = 0;
    steer(c, c.vel, { mult: 1 });
  } else if (userCarrier && (steering || (c.mem.cutLeft as number) > 0) && plantCut(s, c, want, ctxPace)) {
    // In a planted cut (M6.5 #10): the cut sets his velocity itself.
  } else {
    // Protecting the ball (two hands, covered up) is the one slow gait: a jog.
    steer(c, cutWeight(c, want), { mult: c.move === 'protect' ? PROTECT_PACE : 1, brake: len(want) < 0.1 ? CARRIER_COAST : 1, burst: c.burst > 0 });
  }
  if (c.anim !== 'juke' && c.anim !== 'spin' && c.anim !== 'stiffArm' && c.anim !== 'truck' && c.anim !== 'hurdle' && c.anim !== 'dive') c.anim = 'carry';
  if (c.move === 'dive' && c.busy <= 1) {
    c.down = true;
    c.anim = 'down';
    // The ball over the plane as he lands is a score, before the whistle for him being down.
    lineCheck(s, c);
    // A slide is down where it began (the ball carried, not reached out); a dive where the ball ends up.
    const slideX = c.mem.slideX as number | undefined;
    whistle(s, 'tackle', attack > 0 ? (slideX !== undefined ? slideX + BALL_NOSE : Math.max(s.maxX, ballNose(c))) : c.pos.x, c.side === 'off');
  }
}

/** The smallest distance between two agents over this tick's moves (their last recorded positions to now). */
function sweptGap(o: Agent, c: Agent): number {
  const o0 = o.hist[o.hist.length - 1]?.pos ?? o.pos;
  const c0 = c.hist[c.hist.length - 1]?.pos ?? c.pos;
  const ax = o0.x - c0.x;
  const ay = o0.y - c0.y;
  const bx = o.pos.x - c.pos.x;
  const by = o.pos.y - c.pos.y;
  const dx = bx - ax;
  const dy = by - ay;
  const dd = dx * dx + dy * dy;
  const u = dd > 1e-9 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / dd)) : 1;
  const ex = ax + dx * u;
  const ey = ay + dy * u;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Carrier speed by context (feedback item 3). Flat out in open field or
 * through a lane; a controlled run (86% at a yard, full again by 2.5 yd) when
 * a free tackler is within a couple of yards in front of him, so a cut or a
 * move can land (the ~85% "breakdown" pace backs use to set up a tackler);
 * never a jog in the open. Speed and Acceleration are the ceiling (steer).
 */
export function carrierPace(s: PlayState, c: Agent, attack: 1 | -1): number {
  const sp = len(c.vel);
  const hx = sp > 1 ? c.vel.x / sp : attack;
  const hy = sp > 1 ? c.vel.y / sp : 0;
  let near = Infinity;
  for (const i of attack > 0 ? s.def : s.off) {
    const d = s.agents[i]!;
    if (d.down || blockOf(s, i)) continue;
    const rx = d.pos.x - c.pos.x;
    const ry = d.pos.y - c.pos.y;
    if (rx * hx + ry * hy < -0.3) continue; // behind him: run away from him
    near = Math.min(near, Math.sqrt(rx * rx + ry * ry));
  }
  return near < 2.5 ? 0.86 + 0.14 * Math.max(0, Math.min(1, (near - 1.2) / 1.3)) : 1;
}

/**
 * Hold-to-sprint (Playtest 1 #2), for the carrier the player controls (a
 * scrambling QB too); AI carriers keep the context pace. Unheld he runs
 * CRUISE of his top speed in space, the controlled pace near a tackler as
 * before: a run, never a jog, and under movement.ts's 90% effort line, so
 * his stamina comes back. Held he finds the last gear everywhere, the
 * breakdown near a tackler included, so his cuts lose CUT_NEAR's
 * sharpness and take SPRINT_CUT longer, and he pays stamina for every tick
 * over 90% (movement.ts advance). His top speed falls with his stamina
 * (0.86 + 0.14·stamina, movement.ts), so a long sprint fades on its own;
 * spent (under SPRINT_MIN) he can't sprint at all. On mem.sprint for the cut and the HUD.
 */
export function userPace(c: Agent, ctxPace: number, inp: InputFrame): number {
  const sprint = !!inp.sprint && c.stamina >= SPRINT_MIN;
  c.mem.sprint = sprint;
  return sprint ? 1 : Math.min(ctxPace, CRUISE);
}
/** Unheld, the share of top speed he runs in space: on the 90% effort line (movement.ts), so stamina recovers. */
const CRUISE = 0.9;
/** Below this stamina there's no sprint left in him. */
const SPRINT_MIN = 0.15;
/** A cut at a sprint takes this much longer than one at the context pace (the plant against the extra speed). */
const SPRINT_CUT = 1.15;

/**
 * A stick reading as a direction: any push past the dead zone is a full
 * push. A pad's diagonal often reads ~0.85–0.9 at full tilt (and a keyboard
 * diagonal is normalised already), so speed never comes from how far it's pushed.
 */
export function stickDir(m: V2): V2 {
  const k = Math.sqrt(m.x * m.x + m.y * m.y);
  return k < 0.2 ? { x: 0, y: 0 } : { x: m.x / k, y: m.y / k };
}

/**
 * The burst is his own, not a key (round-two feedback): the extra gear a
 * back finds accelerating out of a cut, or when he clears the last tackler
 * near him and hits open grass. It lasts 0.3 s for a 0-Acceleration runner
 * up to 0.6 s at 99 (the elite "burst" trait's ~0.15 s sooner to top speed,
 * catalogOffense.ts), costs stamina, and can't come again for 1.5 s or
 * when he's spent. movement.ts turns it into the compressed sprint phase.
 */
const BURST_COOLDOWN = 90;
const BURST_COST = 0.05;
const BURST_MIN = 0.2;
/** A cut: asked to run more than ~35° off the line he's on. */
const CUT_COS = 0.82;

function autoBurst(s: PlayState, c: Agent, pace: number, want: V2): void {
  const lastPace = (c.mem.lastPace as number | undefined) ?? pace;
  c.mem.lastPace = pace;
  // A juke or spin that just ended (its plant done, he's coming out of it).
  const prev = c.mem.prevMove as string | undefined;
  if ((prev === 'jukeL' || prev === 'jukeR' || prev === 'spin') && c.move !== prev) c.mem.moveEnd = s.t;
  c.mem.prevMove = c.move ?? '';
  const sp = len(c.vel);
  const wl = len(want);
  if (sp < 1.5 || wl < 0.5 * c.fx.vmax) return;
  const along = (c.vel.x * want.x + c.vel.y * want.y) / (sp * wl);
  // In a cut: asked to run well off the line he's on.
  if (along < CUT_COS && sp > 3) c.mem.cutT = s.t;
  if (c.burst > 0 || c.burstCd > 0 || c.stamina < BURST_MIN || c.busy > 0 || c.move === 'protect') return;
  // Coming out of it: going where he's asked to (not still in the turn).
  if (along < 0.95) return;
  // Clearing the tackler: the controlled pace gives way to open field.
  const cleared = lastPace < 0.97 && pace >= 1;
  // Out of a cut in the last half second, or a juke or spin just finished.
  const cut = s.t - ((c.mem.cutT as number | undefined) ?? -9) < 0.5;
  const moved = s.t - ((c.mem.moveEnd as number | undefined) ?? -9) < 0.25;
  if (!cleared && !cut && !moved) return;
  c.burst = Math.round(60 * (0.3 + 0.3 * c.fx.a('acceleration')));
  c.burstCd = BURST_COOLDOWN;
  c.stamina = Math.max(0, c.stamina - BURST_COST);
  s.events.push({ t: s.t, type: 'move', who: [c.i], data: { move: 'burst' } });
}
/**
 * A planted cut (M6.5 #10). Asked at speed for a direction CUT_MIN or more
 * off his run, the carrier plants and cuts: over the plant his velocity goes
 * straight from the old run to the new one at the exit speed (the plant foot
 * takes the old speed off as the hips turn), then the burst out of the cut
 * (autoBurst) takes him back up to speed. Before, a direction change was the
 * steer's lateral-acceleration limit alone: an arc of ~11 yd radius at full
 * speed, 1.05 s to turn 90° for a 90-Agility back and 4.5 yd carried on the
 * old line (tools/sim/cuts.ts). The brief's measure: 90° at full speed in
 * under 0.4 s for a 90-Agility back.
 *
 * The plant's length (s): (CUT_T0 + CUT_T1·angle/π) × (1.6 − 0.85·Agility)
 * × (0.55 + 0.45·speed/top speed), ×CUT_NEAR with a tackler on him (the
 * controlled pace makes cuts sharper, not slower). A 90° cut at full speed:
 * ~0.26 s at 90 Agility, ~0.34 s at 60; a reversal ~0.38 s and ~0.5 s. One
 * change-of-direction plant step on film is ~0.2–0.3 s of ground contact
 * plus the push-off (Dos'Santos et al. 2018 on cutting mechanics).
 *
 * The speed kept: 1 − (0.55 − 0.2·Agility)·angle/90°, at least CUT_KEEP_MIN:
 * a 90° cut keeps ~63% at 90 Agility and ~57% at 60, a reversal ~25%, a 45°
 * cut ~80%. The arrow let go in the plant (a tap) still finishes the cut and
 * runs on along it for CUT_HOLD.
 */
function plantCut(s: PlayState, c: Agent, want: V2, pace: number): boolean {
  let left = (c.mem.cutLeft as number | undefined) ?? 0;
  if (left > 0) {
    // Hit in the plant (a tackle broken, a collision): the cut is off; he runs from what the hit left him.
    if (Math.abs(c.vel.x - (c.mem.cutVx as number)) + Math.abs(c.vel.y - (c.mem.cutVy as number)) > 1.5) {
      c.mem.cutLeft = 0;
      return false;
    }
  } else {
    const sp = len(c.vel);
    const wl = len(want);
    if (sp < CUT_MIN_SPEED || wl < 0.3 * c.fx.vmax) return false;
    const dot = (c.vel.x * want.x + c.vel.y * want.y) / (sp * wl);
    const cross = (c.vel.x * want.y - c.vel.y * want.x) / (sp * wl);
    const ang = Math.abs(atan2(cross, dot));
    if (ang < CUT_MIN) return false;
    const ag = c.fx.a('agility');
    const T = (CUT_T0 + (CUT_T1 * ang) / Math.PI) * (1.6 - 0.85 * ag) * (0.55 + 0.45 * Math.min(1, sp / c.fx.vmax)) * (c.mem.sprint ? SPRINT_CUT : pace < 1 ? CUT_NEAR : 1);
    const keep = Math.max(CUT_KEEP_MIN, 1 - (0.55 - 0.2 * ag) * (ang / (Math.PI / 2)));
    const out = Math.min(keep * sp, wl);
    left = Math.max(3, Math.round(T / TICK));
    c.mem.cutN = left;
    c.mem.cutX0 = c.vel.x;
    c.mem.cutY0 = c.vel.y;
    c.mem.cutDx = want.x / wl;
    c.mem.cutDy = want.y / wl;
    c.mem.cutX1 = (want.x / wl) * out;
    c.mem.cutY1 = (want.y / wl) * out;
    // For the render's plant-and-cut (M6.5 #11): which way, how sharp, how long.
    s.events.push({ t: s.t, type: 'move', who: [c.i], data: { move: 'cut', side: cross > 0 ? 'L' : 'R', deg: Math.round((ang * 180) / Math.PI), dur: left * TICK } });
  }
  const n = c.mem.cutN as number;
  const u = 1 - (left - 1) / n;
  const x0 = c.mem.cutX0 as number;
  const y0 = c.mem.cutY0 as number;
  c.vel.x = x0 + ((c.mem.cutX1 as number) - x0) * u;
  c.vel.y = y0 + ((c.mem.cutY1 as number) - y0) * u;
  c.mem.cutVx = c.vel.x;
  c.mem.cutVy = c.vel.y;
  c.mem.cutLeft = left - 1;
  if (left === 1) c.mem.cutHold = s.t + CUT_HOLD;
  advance(c, len(c.vel));
  return true;
}
/** A change of direction at least this far off his run (rad, 30°) is a planted cut; less is a bend (the steer's lateral limit). */
const CUT_MIN = Math.PI / 6;
/** Below this speed (yd/s) there's nothing to plant against: he just turns. */
const CUT_MIN_SPEED = 3;
/** The plant's base length and its growth with the angle (s, before Agility and speed). */
const CUT_T0 = 0.16;
const CUT_T1 = 0.3;
/** The plant with a tackler on him: shorter (the controlled pace sets him up to cut). */
const CUT_NEAR = 0.85;
/** The least of his speed a cut keeps (a full reversal). */
const CUT_KEEP_MIN = 0.15;
/** After a tapped cut, he runs on along its line this long (s) before the stick at rest lets him coast. */
const CUT_HOLD = 0.3;

/** Protecting the ball: a jog, ~78% (two hands on it, pads over it). */
const PROTECT_PACE = 0.78;

/**
 * The box score's pressures (the game layer's per-defender tallies): each
 * defender the first time his own share of the pressure on the QB reaches
 * the harness's 0.45 (pressureT's threshold), and the blocker he beat: the
 * man still on him (a collapsing pocket) or the last one he shed, −1 if he
 * came free. Bookkeeping only: nothing in the sim reads it, and it isn't hashed.
 */
function notePressures(s: PlayState): void {
  const qb = s.agents[s.qb]!;
  for (const i of s.def) {
    if (pressureFrom(s, qb, i) < 0.45 || s.pressures.some((p) => p.by === i)) continue;
    let beat = blockOf(s, i)?.b ?? -1;
    for (let k = s.events.length - 1; beat < 0 && k >= 0; k--) {
      const e = s.events[k]!;
      if (e.type === 'shed' && e.who?.[0] === i) beat = e.who[1] ?? -1;
    }
    s.pressures.push({ by: i, beat, t: s.t });
  }
}

/** How far past the two bodies a pocket rusher gets a hand on the QB (yd, as in the open field: the wrap, not a smaller reach, is what makes a touch not a sack). */
const POCKET_REACH = 0.6;
/** A throw this close to leaving his hand (s) still gets away when he's wrapped. */
const WRAP_THROW = 0.1;
/** The longest a wrap lasts before he's down (s). */
const WRAP_MAX = 0.8;
/** A wrap ends when he's slowed to this (yd/s). */
const WRAP_STOP = 0.5;
/** A second tackler joining the wrap cuts what's left of the drive to this share. */
const WRAP_JOIN = 0.4;
/** A move of his own this early in a wrap (s) gets one try to break it... */
const WRAP_BREAK_T = 0.25;
/** ...at this share of the chance the tackle had of failing in the first place. */
const WRAP_BREAK = 0.5;

/** In a tackler's wrap (and not down yet). */
function wrapped(c: Agent): boolean {
  return ((c.mem.wrapBy as number | undefined) ?? -1) >= 0 && !c.down;
}

/**
 * The wrap in the pocket begins: the rusher has the quarterback. He drives
 * on a step or so (a quarter of his speed, at most a yard) while a throw
 * already leaving his hand still gets away (WRAP_THROW); then he's down.
 * (Ball carriers are tackled by the bodies in tackle.ts.)
 */
function startWrap(s: PlayState, c: Agent, o: Agent): void {
  const attack = c.side === 'off' ? 1 : -1;
  const sp = len(c.vel);
  const path = Math.min(1, sp * 0.25);
  // Slowing from his speed to a stop over that path: v² = 2·a·path (capped so it's done inside WRAP_MAX).
  const v0 = Math.max(sp, 0.01);
  const T = Math.min(WRAP_MAX, path > 0.02 ? (2 * path) / v0 : 0.1);
  c.mem.wrapBy = o.i;
  c.mem.wrapT0 = s.t;
  c.mem.wrapEnd = s.t + T;
  c.mem.wrapDx = sp > 0.3 ? c.vel.x / sp : attack;
  c.mem.wrapDy = sp > 0.3 ? c.vel.y / sp : 0;
  c.mem.wrapV = path > 0.02 ? Math.min(v0, (2 * path) / Math.max(T, 1e-3)) : 0;
  c.mem.wrapA = T > 0 ? (c.mem.wrapV as number) / T : 0;
  // A move he was already in counted in the tackle roll: only one started inside the wrap gets the extra try.
  c.mem.wrapTried = c.busy > 0 && !!c.move && c.move !== 'protect';
  // Where the tackler rides: on the side he came from, bodies touching.
  const ox = o.pos.x - c.pos.x;
  const oy = o.pos.y - c.pos.y;
  const ol = Math.max(1e-6, Math.sqrt(ox * ox + oy * oy));
  c.mem.wrapOx = (ox / ol) * (o.fx.radius + c.fx.radius) * 0.8;
  c.mem.wrapOy = (oy / ol) * (o.fx.radius + c.fx.radius) * 0.8;
  o.busy = Math.max(o.busy, Math.round(T / TICK) + 6);
  o.mem.tackleCd = s.t + T + 0.5;
  o.anim = 'tackle';
}

/** Another man gets there during the wrap: the pile finishes it sooner. */
function joinWrap(s: PlayState, c: Agent, o: Agent): void {
  const left = Math.max(0, (c.mem.wrapEnd as number) - s.t);
  c.mem.wrapEnd = s.t + left * WRAP_JOIN;
  c.mem.wrapV = (c.mem.wrapV as number) * WRAP_JOIN;
  o.busy = Math.max(o.busy, Math.round((left * WRAP_JOIN) / TICK) + 6);
  o.mem.tackleCd = s.t + left + 0.5;
  o.anim = 'tackle';
  s.events.push({ t: s.t, type: 'hit', who: [o.i, c.i], at: { ...c.pos }, data: { force: 0, big: false, wrap: true, join: true } });
}

/**
 * One tick of a wrap: he drives on, slowing, the tackler riding him; a move
 * of his own early in it gets one try to break it; then he's down where the
 * ball is. True when the play's over (he's down).
 */
function wrapStep(s: PlayState, c: Agent, inPocket: boolean): boolean {
  const o = s.agents[c.mem.wrapBy as number]!;
  const t0 = c.mem.wrapT0 as number;
  // His own move early in the wrap (a spin off, a stiff arm, lowering the shoulder): one try.
  if (!c.mem.wrapTried && s.t - t0 < WRAP_BREAK_T && c.busy > 0 && (c.move === 'spin' || c.move === 'stiffArm' || c.move === 'truck' || c.move === 'jukeL' || c.move === 'jukeR')) {
    c.mem.wrapTried = true;
    const odds = tackleOdds(s, o, c, c.move);
    // Low Center: balance back 30% faster after contact (the trait catalog's line).
    if (s.rng.contact() < WRAP_BREAK * (1 - odds.tackle) * (has(c, 'low-center') ? 1.3 : 1)) {
      c.mem.wrapBy = -1;
      c.vel.x *= 0.6;
      c.vel.y *= 0.6;
      o.busy = 28;
      o.mem.tackleCd = s.t + 0.9;
      s.events.push({ t: s.t, type: 'brokenTackle', who: [c.i, o.i], at: { ...c.pos }, data: { force: 0, wrap: true } });
      return false;
    }
  }
  // The drive: along his run at the slowing speed (whatever his legs asked for this tick).
  const v = Math.max(0, (c.mem.wrapV as number) - (c.mem.wrapA as number) * (s.t - t0));
  const dx = c.mem.wrapDx as number;
  const dy = c.mem.wrapDy as number;
  const px = (c.mem.wrapPx as number | undefined) ?? c.pos.x;
  const py = (c.mem.wrapPy as number | undefined) ?? c.pos.y;
  c.pos.x = px + dx * v * TICK;
  c.pos.y = py + dy * v * TICK;
  c.vel.x = dx * v;
  c.vel.y = dy * v;
  c.mem.wrapPx = c.pos.x;
  c.mem.wrapPy = c.pos.y;
  o.pos.x = c.pos.x + (c.mem.wrapOx as number);
  o.pos.y = c.pos.y + (c.mem.wrapOy as number);
  o.vel.x = c.vel.x;
  o.vel.y = c.vel.y;
  if (s.t < (c.mem.wrapEnd as number) && v > WRAP_STOP) return false;
  // Down: where the ball is as he lands.
  c.down = true;
  c.anim = 'tackled';
  o.down = true;
  c.mem.wrapBy = -1;
  const attack = c.side === 'off' ? 1 : -1;
  if (inPocket) {
    s.sack = true;
    s.events.push({ t: s.t, type: 'sack', who: [o.i, c.i], at: { ...c.pos } });
    // The strip sack: roughly one sack in ten jars the ball loose (NFL
    // 2010s: ~1 fumble per 9–10 sacks), a Strip Sack from his blind side
    // (behind him) 25% more often, a sack artist's Strip Sack trait being the
    // catalog's line. A QB who protects it (Ball Security, where rated) less.
    const blind = (o.pos.x - c.pos.x) * attack < 0;
    if (s.rng.contact() < 0.1 * (1.3 - 0.6 * c.fx.a('ballSecurity')) * (blind && has(o, 'strip-sack') ? 1.25 : 1)) {
      s.ball.mode = 'loose';
      s.ball.holder = -1;
      s.ball.pos = { x: c.pos.x, y: c.pos.y, z: 0.8 };
      s.ball.vel = { x: gauss(s.rng.bounce) * 2, y: gauss(s.rng.bounce) * 2, z: 2 };
      s.phase = 'loose';
      s.carrier = -1;
      s.events.push({ t: s.t, type: 'fumble', who: [c.i, o.i], at: { ...c.pos }, data: { sack: true } });
      return true;
    }
    whistle(s, c.pos.x <= 0 ? 'safety' : 'sack', c.pos.x, true);
  } else {
    s.events.push({ t: s.t, type: 'tackle', who: [o.i, c.i], at: { ...c.pos }, data: { big: false, wrapT: Math.round((s.t - t0) * 100) / 100 } });
    const at = attack > 0 ? Math.max(s.maxX, ballNose(c)) : c.pos.x;
    whistle(s, 'tackle', attack > 0 ? Math.min(at, GOAL_X - 0.05) : Math.max(at, 0.05), c.side === 'off');
  }
  return true;
}

/** Tackles on the ball carrier (or the QB in the pocket). */
function contactStep(s: PlayState): void {
  // A QB wrapped up as the ball left his hand: he goes down with the throw away (no sack).
  const qb = s.agents[s.qb]!;
  if (wrapped(qb) && !(s.ball.mode === 'held' && s.ball.holder === s.qb)) {
    qb.mem.wrapBy = -1;
    qb.down = true;
    qb.anim = 'tackled';
  }
  const holder = s.ball.mode === 'held' ? s.ball.holder : -1;
  // The ball came out of a pile, or changed hands: the pile is over.
  if (s.pile && s.pile.c !== holder) s.pile = null;
  if (holder < 0) return;
  const c = s.agents[holder]!;
  if (c.down || s.result) return;
  const inPocket = holder === s.qb && s.phase !== 'carrier';
  if (s.t - s.snapT < 0.4) return;
  // A sliding quarterback has given himself up: nobody may hit him.
  if (c.move === 'dive' && slides(c) && !inPocket) return;
  // In a wrap in the pocket: he drives on, the rusher rides him down (wrapStep).
  if (wrapped(c) && wrapStep(s, c, inPocket)) return;
  const attack = c.side === 'off' ? 1 : -1;
  // A tackle being decided (tackle.ts): the bodies settle it, then he's down where the ball is.
  if (s.pile) {
    const r = pileStep(s, c, (c.mem.wantX as number | undefined) ?? 0, (c.mem.wantY as number | undefined) ?? 0);
    if (r.state === 'down' || r.state === 'stood') {
      downInPile(s, c, r.spot, r.state === 'stood');
      return;
    }
  }
  for (const o of s.agents) {
    if (o.side === c.side || o.down || o.busy > 0 || o.mem.outOfPlay) continue;
    // Engaged defenders can come off a block for an arm tackle as he passes:
    // one reach per pass (M6.5 #8: a 25% roll every tick gave a blocked
    // tackle near-certain tries at every back going by; 36% of the 1–4 yd
    // runs were first stopped by a man still in a block, tools/sim/rundiag.ts).
    const engaged = blockOf(s, o.i);
    if (engaged) {
      if (dist(o.pos, c.pos) > o.fx.reach + c.fx.reach + 0.35) continue;
      if (((o.mem.armAt as number | undefined) ?? -9) > s.t - 1) continue;
      o.mem.armAt = s.t;
    }
    if (((o.mem.tackleCd as number | undefined) ?? -1) > s.t) continue;
    // Closest they came during this tick (both moving: at 18 yd/s closing a
    // pair covers 0.3 yd a tick, so the end-of-tick gap alone lets a runner
    // slip through a tackler's reach).
    const k = sweptGap(o, c);
    // Hands on him at ARM_REACH past the reach bases; a diving tackle ~1 yd more when he can't close on
    // a runner pulling away (lower odds, and he's on the ground after).
    // In the pocket it takes a hand on him, not a reach past him (Playtest 1: a sack with no contact).
    const armReach = o.fx.reach + c.fx.reach + (inPocket ? POCKET_REACH : ARM_REACH);
    let dive = false;
    let lunge = -1;
    if (k > armReach) {
      // Level with him or losing ground: a diving tackle (~1 yd more reach).
      const closing = ((o.vel.x - c.vel.x) * (c.pos.x - o.pos.x) + (o.vel.y - c.vel.y) * (c.pos.y - o.pos.y)) / Math.max(1e-6, k);
      // A man who was in front of him as he goes by (M6.5 #8): he lunges
      // once, at the closest point. Without it, 40% of the open-field
      // meetings with a defensive back in front went by at 1.5–2.5 yd with
      // no try at all, and one in five runs that got past the linebackers
      // got past every safety too (tools/sim/rundiag.ts).
      // (Attacking him, closing fast, in the last half-second: a man he runs by, not one chasing from behind.)
      if (closing > 2 && k < armReach + 3) o.mem.attackT = s.t;
      const attacking = s.t - ((o.mem.attackT as number | undefined) ?? -9) < 0.5;
      const lungeAt = (o.mem.lungeAt as number | undefined) ?? -9;
      // In the open field only: in the trash at the line a back going by a man a yard and a half off is past him.
      const openField = !inPocket && (c.pos.x - s.setup.los) * attack > LUNGE_PAST;
      if (!engaged && openField && k < armReach + LUNGE && closing < 0.6 && attacking && s.t - lungeAt > 1.5) {
        o.mem.lungeAt = s.t;
        lunge = (k - armReach) / LUNGE;
        dive = true;
      } else if (k < armReach + 1.0 && closing < 0.6 && s.rng.contact() < 0.02) dive = true; // M6: 5% a tick dove at nearly every runner pulling away (0.15 missed dives a carry)
      else continue;
    }
    const { out: out0, force } = resolveTackle(s, o, c);
    let out = out0;
    // Joining a pile: only a man who gets him (or lays him out) counts; one who bounces off it does nothing.
    if ((s.pile || wrapped(c)) && out !== 'tackle' && out !== 'bigHit') {
      o.mem.tackleCd = s.t + 0.5;
      continue;
    }
    if (wrapped(c) && out === 'bigHit') c.mem.wrapBy = -1;
    if (engaged) {
      // Off the block it's only an arm, and only if he's winning the block:
      // a lineman his blocker has controlled (leverage toward −1) can't get
      // free enough to finish (~16% of what would have been a tackle, even
      // block; ~45% when he's about to shed).
      const hold = 0.9 - 0.3 * Math.max(0, engaged.lev + 0.2);
      if ((out === 'tackle' || out === 'bigHit') && s.rng.contact() < hold) out = 'broken';
      if (out === 'bigHit') out = 'tackle';
      if (out === 'tackle') s.blocks.splice(s.blocks.indexOf(engaged), 1);
    }
    if (dive) {
      o.anim = 'dive';
      // A dive at a man pulling away keeps 65% of a squared-up tackle; a lunge at
      // a man going by, LUNGE_KEEP at the fingertips down to 0.3 less at full stretch.
      if ((out === 'tackle' || out === 'bigHit') && s.rng.contact() > (lunge >= 0 ? LUNGE_KEEP - 0.3 * lunge : 0.65)) out = 'broken';
      if (out !== 'tackle' && out !== 'bigHit') {
        // On the turf where he dove: a body in the way until he's up (tackle.ts).
        knockDown(s, o, c.pos.x - o.pos.x, c.pos.y - o.pos.y);
        o.anim = 'down';
        s.events.push({ t: s.t, type: 'missedTackle', who: [o.i, c.i], at: { ...c.pos }, data: { dive: true } });
        continue;
      }
    }
    if (out === 'missed') {
      o.busy = 36;
      o.vel.x *= 0.3;
      o.vel.y *= 0.3;
      o.mem.tackleCd = s.t + 1;
      // Ankle Breaker: a defender who bites on his juke falls down (the catalog's line).
      const bit = (c.move === 'jukeL' || c.move === 'jukeR') && has(c, 'ankle-breaker');
      if (bit) knockDown(s, o, o.vel.x - c.vel.x, o.vel.y - c.vel.y);
      s.events.push({ t: s.t, type: 'missedTackle', who: [o.i, c.i], at: { ...c.pos }, ...(bit ? { data: { fell: true } } : {}) });
      continue;
    }
    const low = goesLow(s, c, o);
    if (out === 'broken' && !inPocket) {
      // A hand on him (tackle.ts): run through at once, or dragged until the hand gives or help arrives.
      grab(s, c, o, 'arm', { engaged: !!engaged, low, force });
      if (c.down || s.result) return;
      continue;
    }
    if (out === 'broken') {
      // An arm off a block barely slows him (M6.5 #8); a real tackle broken costs him his stride.
      const keep = engaged ? 0.88 : 0.62;
      c.vel.x *= keep;
      c.vel.y *= keep;
      o.busy = 28;
      o.mem.tackleCd = s.t + 0.9;
      s.events.push({ t: s.t, type: 'brokenTackle', who: [c.i, o.i], at: { ...c.pos }, data: { force: Math.round(force * 10) / 10, move: c.move ?? '' } });
      continue;
    }
    if (out === 'bigHit') s.bigHit = { by: o.i, on: c.i, force: Math.round(force * 10) / 10 };
    if (!inPocket) {
      // The hit and the hold (tackle.ts): how he got there sets it.
      const dx = c.pos.x - o.pos.x;
      const dy = c.pos.y - o.pos.y;
      const dd = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
      const cs = len(c.vel);
      const headOn = cs > 0.5 ? -(c.vel.x * dx + c.vel.y * dy) / (cs * dd) : 0;
      const closing = Math.max(0, ((o.vel.x - c.vel.x) * dx + (o.vel.y - c.vel.y) * dy) / dd);
      const kind = engaged ? 'wrap' : holdKind(c, o, headOn, closing, out === 'bigHit', dive, low);
      grab(s, c, o, kind, { low, force, extra: afterContact(s, c, o, headOn) });
      o.mem.tackleCd = s.t + 1;
      if (fumbles(s, o, c, out === 'bigHit')) {
        s.pile = null;
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
      continue;
    }
    // In the pocket: the rusher has him (the sack, or a big hit that ends it there).
    s.events.push({ t: s.t, type: 'hit', who: [o.i, c.i], at: { ...c.pos }, data: { force: Math.round(force * 10) / 10, big: out === 'bigHit', ...(out === 'bigHit' ? { kind: 'big' } : { wrap: true, kind: 'wrap' }) } });
    o.anim = 'tackle';
    if (out !== 'bigHit') {
      if (wrapped(c)) {
        joinWrap(s, c, o);
        continue;
      }
      startWrap(s, c, o);
      return;
    }
    c.down = true;
    c.anim = 'tackled';
    o.down = false;
    s.sack = true;
    s.events.push({ t: s.t, type: 'sack', who: [o.i, c.i], at: { ...c.pos } });
    whistle(s, c.pos.x <= 0 ? 'safety' : 'sack', c.pos.x, true);
    return;
  }
}

/**
 * The after-contact yards the trait catalog promises, put on the fall: a
 * Battering Ram meeting him head on +0.8 yd; a Goal-Line Hammer inside the
 * 5 falls forward +1 yd; a Thumper in the hole takes 0.5 yd back between
 * the tackles; an Undersized tackler gives up 0.5 yd; a Grinder's stuffed
 * inside run falls forward a yard.
 */
function afterContact(s: PlayState, c: Agent, o: Agent, headOn: number): number {
  const attack = c.side === 'off' ? 1 : -1;
  const inside = Math.abs(c.pos.y - (s.setup.ballY ?? 0)) < 4;
  let extra = (headOn > 0.3 && has(c, 'battering-ram') ? 0.8 : 0) + (c.pos.x * attack > (attack > 0 ? GOAL_X - 5 : -5) && has(c, 'goal-line-hammer') ? 1 : 0) - (inside && has(o, 'thumper') ? 0.5 : 0) + (has(o, 'undersized') ? 0.5 : 0);
  const stuffed = (c.pos.x - s.setup.los) * attack < 0.5 && inside && !!s.setup.play.run && has(c, 'grinder');
  if (stuffed) extra = Math.max(extra, 1);
  return extra;
}

/** Down in the pile (or held up and whistled): the tackle, and the ball spotted. */
function downInPile(s: PlayState, c: Agent, spot: number, stood: boolean): void {
  const p = s.pile!;
  const attack = c.side === 'off' ? 1 : -1;
  if (!stood) {
    c.down = true;
    c.anim = 'tackled';
    // The men who had him go down with him (not the hitter who laid him out).
    for (const g of p.grips) {
      const o = s.agents[g.by]!;
      if (g.kind === 'big') continue;
      if (!o.down) knockDown(s, o, p.fx * attack, p.fy);
      o.anim = 'tackle';
    }
  }
  s.pile = null;
  whistle(s, 'tackle', attack > 0 ? Math.min(spot, GOAL_X - 0.05) : Math.max(spot, 0.05), c.side === 'off');
}

/** The ball: in hands, in the air, or loose. */
function ballStep(s: PlayState): void {
  const b = s.ball;
  if (b.mode === 'held') {
    const h = s.agents[b.holder]!;
    // The snap travels from the center to the QB's hands (shotgun, ~0.3 s).
    // (Under center the exchange is a hand-to-hand ~0.1 s.)
    const snapT = s.snapT < 0 ? 0 : Math.min(1, (s.t - s.snapT) / (s.setup.play.formation.center ? 0.1 : 0.33));
    const c = off(s, 'C');
    // Carried a quarter-yard ahead of his body, the way he's running (ballNose reads the same offset).
    const hx = h.pos.x + 0.25 * (h.side === 'off' ? 1 : -1);
    const pitchF = s.pitch && b.holder !== s.qb ? (s.t - s.pitch.t) / PITCH_T : 1;
    if (s.snapT >= 0 && snapT < 1 && b.holder === s.qb) {
      b.pos = { x: c.pos.x + (hx - c.pos.x) * snapT, y: c.pos.y + (h.pos.y - c.pos.y) * snapT, z: 0.2 + 0.9 * snapT };
    } else if (s.pitch && pitchF < 1) {
      // The toss in the air: underhand from the QB's hip to the back's hands, a little arc.
      const f = pitchF;
      b.pos = { x: s.pitch.from.x + (hx - s.pitch.from.x) * f, y: s.pitch.from.y + (h.pos.y - s.pitch.from.y) * f, z: 1.0 + 0.15 * 4 * f * (1 - f) };
    } else if (s.snapT >= 0) {
      b.pos = { x: hx, y: h.pos.y, z: h.down ? 0.25 : 1.15 };
    }
    return;
  }
  if (b.mode === 'air') {
    if (batAtLine(s)) return;
    const who = stepAir(s);
    if (who >= 0) {
      s.touched.push(who);
      const a = s.agents[who]!;
      // A receiver who stepped out and came back can't be the first to touch it: incomplete.
      if (a.side === 'off' && a.mem.outOfPlay) {
        s.events.push({ t: s.t, type: 'catchOutOfBounds', who: [who], at: { x: a.pos.x, y: a.pos.y }, data: { illegalTouch: true } });
        whistle(s, 'incomplete', s.setup.los, true);
        return;
      }
      const out = resolveCatch(s, a);
      if (out === 'catch' || out === 'int') {
        b.mode = 'held';
        b.holder = who;
        s.carrier = who;
        s.phase = 'carrier';
        a.anim = 'catch';
        if (out === 'catch') {
          // No hitch at the catch (round two): he catches at speed and keeps
          // going. Only the hands are busy (frames to tuck it before a move:
          // tuck ~0.07 s, secure ~0.13 s, high point ~0.2 s from the catch
          // clips); going up for it costs a little of his run as he lands.
          const type = s.catchType ?? 'rac';
          const keep = type === 'aggressive' ? 0.9 : 1;
          a.vel.x *= keep;
          a.vel.y *= keep;
          a.busy = Math.max(a.busy, type === 'aggressive' ? 12 : type === 'possession' ? 8 : 4);
          if (s.pass) s.pass.complete = true;
          a.mem.caughtAt = s.t;
          const look = catchLook(s, a, b.pos);
          s.events.push({ t: s.t, type: 'catch', who: [who], at: { x: a.pos.x, y: a.pos.y }, data: { type, look } });
          // SECURE in traffic: he cradles it and goes to the ground with it
          // where he caught it (M6.5 #5), rather than turn upfield into the hit.
          if (look === 'body' && s.def.some((d) => !s.agents[d]!.down && dist(s.agents[d]!.pos, a.pos) < SECURE_DOWN)) {
            a.down = true;
            a.anim = 'down';
            s.events.push({ t: s.t, type: 'move', who: [who], data: { move: 'secureDown' } });
            whistle(s, 'tackle', Math.max(s.maxX, ballNose(a)), true);
            return;
          }
          // Laid out for it low and away: he lands with it and is down where
          // the ball ends up, like the carrier's dive (the catch_dive clip lands
          // on the forearms and chest about 0.4 s after the catch).
          if (look === 'dive') {
            a.move = 'dive';
            a.busy = Math.max(a.busy, DIVE_CATCH_LAND);
          }
        } else {
          a.busy = Math.max(a.busy, 10);
          if (s.pass) s.pass.intercepted = true;
          s.events.push({ t: s.t, type: 'interception', who: [who], at: { x: a.pos.x, y: a.pos.y } });
        }
        // A catch out of bounds is an incompletion (no toe-tap unless
        // possession: GDD §9.2), and so is one behind an end line.
        const wide = Math.abs(a.pos.y) > FIELD_HALF_W - OOB_FOOT;
        // Sideline Toe-Tap: he always gets both feet in on a catchable ball (the trait catalog's line).
        const toe = wide && out === 'catch' && (s.catchType === 'possession' || has(a, 'sideline-toe-tap')) && Math.abs(a.pos.y) < FIELD_HALF_W + 0.4;
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
        // It dies on contact (Playtest 1: it popped 2.5–4.5 yd/s up like a beach
    // ball): a football off hands or pads loses most of its speed and pops
    // a foot or two, enough for a tip drill in a crowd, no more.
    b.vel = { x: b.vel.x * 0.2 + gauss(s.rng.bounce) * 0.6, y: b.vel.y * 0.2 + gauss(s.rng.bounce) * 0.6, z: 0.8 + 1.2 * s.rng.bounce() };
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
        s.events.push({ t: s.t, type: out === 'drop' ? 'drop' : 'deflection', who: by === who ? [who] : [by, who], at: { x: a.pos.x, y: a.pos.y }, ...(out === 'drop' && s.pass?.hard ? { data: { why: s.pass.hard } } : {}) });
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
      // A football on turf: a low, skidding bounce that loses most of its pace (restitution ~0.25).
      b.vel = { x: b.vel.x * 0.45 + gauss(s.rng.bounce) * 0.6, y: b.vel.y * 0.45 + gauss(s.rng.bounce) * 0.6, z: Math.abs(b.vel.z) * 0.25 };
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

/** The rushers a screen lets in: past the line and on their way to the QB, they aren't the releasing linemen's (the second level is). */
const screenLetIn = (d: Agent): boolean => d.side === 'def' && d.mem.screenLetIn === true;

/** The punch before a screen release (ticks, ~0.2 s): his hands on the rusher, then off him and out. Ours. */
const SCREEN_PUNCH = 12;
/** ...and the rusher it lands on is stood up for this long (ticks, ~0.13 s) before he's off to the QB again. Ours. */
const PUNCH_STUN = 8;
/** The QB's drift on a slow screen: up to this much further back than his drop (yd), at this rate (yd/s, before the pocket pace). Ours. */
const SCREEN_DRIFT = 2.5;
const SCREEN_DRIFT_V = 4;

function offenseRoles(s: PlayState, inp: InputFrame): void {
  const play = s.setup.play;
  const carrier = s.carrier >= 0 ? s.agents[s.carrier]! : null;
  for (const i of s.off) {
    const a = s.agents[i]!;
    if (a.down || i === s.carrier) continue;
    if (a.mem.outOfPlay && i !== s.qb) {
      steer(a, { x: 0, y: 0 }, { pace: 0.3 });
      continue;
    }
    if (i === s.qb) {
      if (s.phase === 'snap' || s.phase === 'dropback' || s.phase === 'pocket' || (play.run && s.phase === 'carrier' && s.t - s.snapT < 1)) qbBeforeThrow(s, inp);
      else steer(a, { x: 0, y: 0 }, { pace: 0.3 });
      continue;
    }
    const as = play.assign[a.slot as keyof typeof play.assign];
    // A zone-read keep: the back carries out his fake into the line, holding the linebackers who key him.
    const keepT = s.agents[s.qb]!.mem.keepT as number | undefined;
    if (play.run && a.slot === 'RB' && keepT !== undefined && s.carrier === s.qb && s.t < keepT + KEEP_FAKE) {
      steer(a, arrive(a, v2(s.setup.los + 0.5, (s.setup.ballY ?? 0) + play.run.aim), 0.8), {});
      a.anim = 'carry';
      continue;
    }
    if (carrier && carrier.side === 'off') {
      // Blocking for the ball carrier. Linemen keep driving at the point of
      // attack; everyone else, receivers included the moment the ball is
      // caught, blocks downfield (feedback item 7: YAC comes from the blocks).
      // A screen's convoy keeps to its lanes in front of him.
      const lane = a.mem.convoy ? convoySpot(s, a, v2(a.mem.spotX as number, a.mem.spotY as number), carrier) : null;
      if (lane) screenConvoy(s, a, lane, carrier.pos, screenLetIn);
      else if (as.kind === 'stalk') stalk(s, a, carrier.pos);
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
    // The play-action back: carry out the fake through the mesh toward the hole, then run his route or pick up a rusher.
    if (play.pa && a.slot === 'RB' && s.t - s.snapT < 0.3 + play.pa.fake) {
      const hole = v2(s.setup.los + 0.5, (s.setup.ballY ?? 0) + play.pa.aim);
      steer(a, arrive(a, hole, 0.75), {});
      a.anim = 'carry';
      if (s.t - s.snapT >= 0.3 + play.pa.fake - TICK && as.kind === 'route') {
        // Out of the fake he reads a tagged route (a Receiving Back's wheel against man, else the book's arrow).
        readTag(s, a);
        const r = routePoints(s, a);
        if (r) a.route = { pts: r.pts, sit: r.sit, idx: 0 };
      }
      continue;
    }
    // Screens: the line pass-sets, then releases to lead the screen. Set,
    // punch, let him go: a guard or the center with a rusher on him lets him
    // run on at the QB (the ball goes over him) and releases, a beat later,
    // to his landmark in the convoy (ai.ts screenConvoy): the linebackers
    // and the defensive backs coming downhill to the ball, never the rushers
    // he let in (they're past the play). The man who has the back runs into
    // the release (M6.6 trait pass: the linemen stayed on their pass blocks
    // and the man on the back came down untouched; RB screens against man
    // fell to ~6 yd a throw).
    if (play.screen && as.kind === 'passBlock' && a.p.pos === 'OL' && s.t - s.snapT >= play.screen.release) {
      const to = s.agents[s.icons[0]!]!;
      if (a.mem.spotX === undefined) {
        // The catch spot the convoy is laid off: where the screen's route sets up.
        const end = to.route?.pts[to.route.pts.length - 1] ?? to.pos;
        a.mem.spotX = end.x;
        a.mem.spotY = end.y;
      }
      const spot = v2(a.mem.spotX as number, a.mem.spotY as number);
      const lane = convoySpot(s, a, spot);
      // The tackles ride the ends up the field past the back (their pass sets)
      // until the ball's out, then block what's left in front of it. Released
      // with the rest, they picked the ends up again as run blocks four yards
      // deep, right where the back sets up, and an end who shed made the tackle.
      if (!lane) {
        if (s.ball.mode === 'held') passBlock(s, a);
        else if (s.phase === 'air') runBlock(s, a, to.pos, true, true, screenLetIn);
        continue;
      }
      if (!a.mem.screenRel) {
        a.mem.screenRel = true;
        const k = s.blocks.findIndex((q) => q.b === i && q.kind === 'pass');
        if (k >= 0) {
          const d = s.agents[s.blocks[k]!.d]!;
          s.blocks.splice(k, 1);
          d.mem.shedAt = s.t;
          d.mem.screenLetIn = true;
          d.busy = Math.max(d.busy, PUNCH_STUN);
          d.anim = 'rush';
          a.anim = 'run';
          a.busy = Math.max(a.busy, SCREEN_PUNCH);
        }
      }
      a.mem.convoy = true;
      const side = convoySide(s, spot);
      if (a.slot === side.lead) a.mem.convoyLead = side.ps;
      if (s.phase === 'air' || s.ball.mode === 'held') screenConvoy(s, a, lane, spot, screenLetIn);
      continue;
    }
    switch (as.kind) {
      case 'stalk':
        stalk(s, a, s.agents[s.icons[0]!]!.pos);
        break;
      case 'route':
        // Thrown to him: on an anticipation throw he runs his route through
        // the break to the leg the ball's thrown to (M6.5 #6: he used to cut
        // straight for the catch point the moment it left, rounding off the
        // break), unless it's off target and he's found it in the air.
        if (s.phase === 'air' && s.ball.target === i) {
          const leg = (a.mem.catchLeg as number | undefined) ?? -1;
          const off = s.t > findsBallAt(s, a) && dist(s.ball.aim, s.ball.meant) > 1.2;
          if (a.route && leg > a.route.idx && !off) runRoute(s, a);
          else runToBall(s, a);
        }
        // The ball's thrown to someone else: work to the nearest threat to
        // the catch point, ready to block when it's caught (no contact before
        // the catch: that's interference).
        else if (s.phase === 'air' && s.ball.target >= 0 && a.busy === 0) runBlock(s, a, { x: s.ball.aim.x, y: s.ball.aim.y }, true, false);
        else runRoute(s, a);
        break;
      case 'passBlock':
        passBlock(s, a);
        break;
      case 'runBlock':
        // The draw's line shows pass until the handoff.
        if (play.run && DRAWS.includes(play.run.scheme) && a.p.pos === 'OL') passBlock(s, a);
        else schemeBlock(s, a);
        break;
      case 'carry':
        // Before the handoff: his path to the mesh, by scheme.
        if (play.run) backToMesh(s, a);
        break;
      default:
        break;
    }
  }
  if (carrier && carrier.side === 'off' && s.carrier === carrier.i) {
    // A handoff: first hit the aiming point, then read it.
    const freeNear = s.def.some((i) => !blockOf(s, i) && !s.agents[i]!.down && dist(s.agents[i]!.pos, carrier.pos) < 3);
    // (He presses the aiming point for a beat after the mesh, then reads it: the lanes are carrierAI's.)
    // Gap schemes press the aiming point all the way to the line (the puller
    // clears it), and so do the downhill ones (the iso and dive behind the
    // fullback, the toss to the edge, the sneak); zone presses for a beat, then reads.
    const sc = play.run?.scheme;
    const gapRun = sc === 'power' || sc === 'counter' || sc === 'iso' || sc === 'toss' || sc === 'sneak';
    // A Designed Runner's QB draw and zone-read keep are designed runs too (the sneak is its own: a dive behind the wedge).
    const qbRun = carrier.i === s.qb && carrier.mem.designed === true && sc !== 'sneak';
    const keeper = qbRun && sc === 'zoneRead';
    const designed = carrier.slot === 'RB' || (sc === 'sneak' && carrier.i === s.qb) || qbRun;
    const aimY = (carrier.mem.runAim as number | undefined) ?? play.run?.aim ?? 0;
    const edgeFirst = sc === 'toss' || keeper;
    if (play.run && designed && carrier.pos.x < s.setup.los - (sc === 'sneak' ? 0 : 0.8) && (gapRun || keeper || s.t - s.runReadT < 0.35) && !freeNear) {
      // The toss (and the keeper round the read end) gets to the edge first (outside the tight end's block, still behind the line), then turns it up.
      const aim = edgeFirst && Math.abs(carrier.pos.y - (s.setup.ballY ?? 0) - aimY * 1.2) > 1.5 ? v2(s.setup.los - 0.5, (s.setup.ballY ?? 0) + aimY * 1.2) : v2(s.setup.los + 1, (s.setup.ballY ?? 0) + aimY * (edgeFirst ? 1.2 : 1));
      steer(carrier, { x: (aim.x - carrier.pos.x) * 3, y: (aim.y - carrier.pos.y) * 3 });
      carrier.anim = 'carry';
    } else carrierStep(s, inp);
  } else if (carrier && carrier.side === 'def') {
    carrierStep(s, inp);
  }
}

/**
 * The target with the ball in the air (feedback item 7): he catches it in
 * stride. The throw was led to where he'd be flat out, so he runs his path
 * bent onto the catch point at the pace that gets him there when the ball
 * does: full speed on a ball led well, a stride short on one underthrown,
 * never a stop to wait. Once the ball is on him he runs through the catch.
 * Only a settle route (curl, hitch, comeback, sit) works back to the ball.
 */
function runToBall(s: PlayState, a: Agent): void {
  const b = s.ball;
  const rt = a.route;
  const settle = !!rt && rt.sit[rt.pts.length - 1] === true && rt.idx >= rt.pts.length - 1;
  // Until he finds the ball in the air he runs to where it should come (the
  // QB's lead and placement). Then he reads where it's really going, better
  // the longer he watches it (all of it by three-quarters of the way), and
  // his legs chase the read. Finding it: 0.2–0.45 s by Catching. So a short
  // throw off target stays off target (no time to correct), a deep one he
  // can run under: which is what accuracy is for.
  const findT = findsBallAt(s, a);
  const read = b.arrive > findT ? Math.max(0, Math.min(1, ((s.t - findT) / (b.arrive - findT)) * 1.33)) : 1;
  const to = { x: b.meant.x + (b.aim.x - b.meant.x) * read, y: b.meant.y + (b.aim.y - b.meant.y) * read };
  const d = dist(a.pos, to);
  const left = b.arrive - s.t;
  if (settle) {
    // Come back to the ball: at it by the time it gets there, braking into the catch.
    steer(a, boundaryGovern(a, arrive(a, to, 1, 1), 0.25));
    return;
  }
  const top = a.fx.vmax;
  if (left > 0.1 && d > 0.25) {
    // On time at full stride: never brake to wait for the ball before he's
    // found it (it's led to where he'll be at speed). Only a ball well short
    // of him (it needs him at under 60% of his run) makes him throttle down
    // and come back to it.
    const need = d / left;
    const cur = len(a.vel);
    // A back-shoulder ball he paces to exactly: he throttles down and turns
    // back to it as it comes (M6.5 #6: at full stride he ran past every one).
    // And once he's found it he tracks it (M6.6, the second slant pass): a
    // ball a step behind his run he gathers himself for, at the pace that
    // meets it, instead of running on past the spot and having it arrive
    // behind him. (With the lead now on his real path, a ball on time needs
    // his full speed anyway.)
    const back = (b.place ?? 0) < -0.5;
    const sp = Math.min(top, back || need < 0.6 * cur || read > 0 ? need : Math.max(need, cur));
    steer(a, boundaryGovern(a, { x: ((to.x - a.pos.x) / d) * sp, y: ((to.y - a.pos.y) / d) * sp }, 0.25));
    return;
  }
  // The ball's on him: run through the catch the way he's going.
  const v = len(a.vel);
  if (v > 0.5) steer(a, boundaryGovern(a, { x: (a.vel.x / v) * top, y: (a.vel.y / v) * top }, 0.25));
  else steer(a, { x: to.x - a.pos.x, y: to.y - a.pos.y });
}

function pursueTackle(s: PlayState, a: Agent, t: Agent): void {
  if (a.busy > 0) {
    steer(a, { x: 0, y: 0 });
    return;
  }
  pursue(s, a, t);
}

/** Defenders who rally to a throw: at most two (round-two feedback: four or five used to arrive at once). */
const MAX_RALLY = 2;
/** A real angle: he can be at the catch point within this of the ball (to contest it or tackle on the catch). */
const RALLY_SLACK = 0.35;

/**
 * Who breaks on this throw, decided at the release: the man covering the
 * target, then whoever can get to the catch point soonest (his read of the
 * throw plus the run), if he can be there within RALLY_SLACK of the ball.
 * Everyone else keeps his man or his zone until the catch; that's how a
 * defense flows to the ball without leaving the field empty behind it.
 */
function rallies(s: PlayState): number[] {
  if (s.rally && s.rally.at === s.ball.releaseT) return s.rally.who;
  const aim = { x: s.ball.aim.x, y: s.ball.aim.y };
  const left = s.ball.arrive - s.t;
  const call = s.setup.def.assign;
  const cands: { i: number; t: number }[] = [];
  let manOn = -1;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down || blockOf(s, i) || d.mem.outOfPlay) continue;
    const as = call[d.slot as keyof typeof call];
    if (as.kind === 'man' && manOf(s, d)?.i === s.ball.target) manOn = i;
    const t = reaction(s, d) + timeTo(d, aim);
    if (t <= left + RALLY_SLACK) cands.push({ i, t });
  }
  cands.sort((a, b) => a.t - b.t);
  const who = manOn >= 0 ? [manOn] : [];
  for (const c of cands) if (who.length < MAX_RALLY && !who.includes(c.i)) who.push(c.i);
  s.rally = { at: s.ball.releaseT, who };
  return who;
}

/**
 * The rest of the defense flows to the ball without converging on the catch
 * point: a defender near the throw (within FLOW_R of the catch point, and not
 * a deep defender with a man still behind him) runs to a leverage point
 * FLOW_AHEAD yards past the catch along the receiver's run, where the tackle
 * after the catch is made. His assignment is done once he's read the throw.
 */
const FLOW_R = 15;
const FLOW_AHEAD = 5;

/**
 * A throw caught behind the line (the bubble, a screen): it's the run game
 * now, and the defense plays it like a perimeter run ("screen!"). Every
 * zone defender who's read it comes downhill to the ball, not to his zone
 * or a spot along the receiver's run (which, for a bubble running across,
 * was out at the sideline behind the line): a man inside the ball to the
 * alley, a step inside it and a couple of yards past the catch (inside-out,
 * so the cut back is his), a man outside it to a step outside (the force:
 * outside-in, turning it back inside). Ours, from the coaching of the
 * perimeter fits (force, alley, pursuit).
 */
const SCREEN_LINE = 0.5;
/** Everyone rallies to a screen (yd from the catch point): the backside too, not just the men near it. */
const SCREEN_R = 28;
/** The alley point: this far past the catch toward the line, and this far inside (or for the force, outside) the ball (yd). */
const ALLEY_UP = 2.5;
const ALLEY_IN = 1.5;

/**
 * A perimeter screen: thrown behind the line to a receiver who was split
 * out (the bubble), the play a defense fits as a run to the edge. The back's
 * slow screen is a different fight, linebackers getting off the convoy of
 * linemen in front of it (ai.ts screenConvoy), and keeps its pursuit.
 */
function perimeterScreen(s: PlayState, target: number): boolean {
  if (target < 0 || s.ball.aim.x > s.setup.los + SCREEN_LINE) return false;
  const r = s.agents[target]!;
  return r.slot !== 'RB' && Math.abs(s.setup.play.formation.align[r.slot as OffSlot].dy) > 5;
}

function rallyScreen(s: PlayState, d: Agent): boolean {
  const aim = { x: s.ball.aim.x, y: s.ball.aim.y };
  const los = s.setup.los;
  if (!perimeterScreen(s, s.ball.target) || dist(d.pos, aim) > SCREEN_R) return false;
  const as = s.setup.def.assign[d.slot as keyof typeof s.setup.def.assign];
  if (as.kind !== 'zone') return false;
  const by = s.setup.ballY ?? 0;
  const bs = Math.sign(aim.y - by) || 1;
  // The corner on the ball's side is the force whichever side of it he's on (he works back outside it).
  const outside = d.slot === (bs > 0 ? 'LCB' : 'RCB') || (d.pos.y - aim.y) * bs > 0;
  const at = v2(Math.max(aim.x + ALLEY_UP, los + 0.5), aim.y + (outside ? bs : -bs) * ALLEY_IN);
  steer(d, arrive(d, at, 1, 1));
  return true;
}

/**
 * After the catch of a screen thrown behind the line, a zone defender in
 * front of the carrier fits him like a perimeter run until he's on him
 * (SCREEN_FIT_R) or the carrier's past him: downhill to a point just in
 * front of him, on his inside shoulder (the alley) or, for the corner on
 * that side, his outside one (the force). A pursuit angle from in front
 * (pursue's, taken for a back already at full speed up the field) had the
 * hook and the safeties running alongside the bubble five yards inside it
 * until it was ten yards up the field. Until he's this far past the line
 * (yd); the fit point this far in front of him and to his shoulder (yd). Ours.
 */
const SCREEN_FIT_TO = 4;
const SCREEN_FIT_R = 3.5;
const FIT_AHEAD = 2;
const FIT_SHOULDER = 1;

function screenFit(s: PlayState, d: Agent, c: Agent): boolean {
  const los = s.setup.los;
  if (!perimeterScreen(s, c.i) || c.pos.x > los + SCREEN_FIT_TO) return false;
  const as = s.setup.def.assign[d.slot as keyof typeof s.setup.def.assign];
  if (as.kind !== 'zone' || d.pos.x < c.pos.x + 1 || dist(d.pos, c.pos) < SCREEN_FIT_R) return false;
  const by = s.setup.ballY ?? 0;
  const bs = Math.sign(c.pos.y - by) || 1;
  const force = d.slot === (bs > 0 ? 'LCB' : 'RCB') && (d.pos.y - c.pos.y) * bs > -1;
  // Where we meet on his run as he's running it now (not the full-speed run up the field pursue() leads), a step in front of him, on my shoulder of him.
  const meet = intercept(d.pos, d.fx.vmax, c.pos, c.vel);
  if (!meet) return false;
  const v = len(c.vel);
  const ux = v > 1 ? c.vel.x / v : 1;
  const uy = v > 1 ? c.vel.y / v : 0;
  const at = v2(meet.x + ux * FIT_AHEAD, meet.y + uy * FIT_AHEAD + (force ? bs : -bs) * FIT_SHOULDER);
  const k = Math.max(0.1, dist(at, d.pos));
  steer(d, { x: ((at.x - d.pos.x) / k) * d.fx.vmax, y: ((at.y - d.pos.y) / k) * d.fx.vmax });
  return true;
}

function flowToBall(s: PlayState, d: Agent): boolean {
  const aim = { x: s.ball.aim.x, y: s.ball.aim.y };
  if (dist(d.pos, aim) > FLOW_R) return false;
  const r = s.agents[s.ball.target]!;
  const v = len(r.vel);
  const ux = v > 1 ? r.vel.x / v : 1;
  const uy = v > 1 ? r.vel.y / v : 0;
  const at = { x: aim.x + ux * FLOW_AHEAD, y: aim.y + uy * FLOW_AHEAD };
  // Keep off the catch point on the way (go around it, not through it).
  const toCatch = dist(d.pos, aim);
  if (toCatch < 3) {
    const away = norm(sub(d.pos, aim));
    at.x += away.x * 2;
    at.y += away.y * 2;
  }
  steer(d, arrive(d, at, 0.95, 1));
  return true;
}

/**
 * A zone defender reading the QB's shoulders (GDD §10.4): once he's seen
 * the wind-up (his read time; a Ballhawk sees it a third sooner), if he's
 * within JUMP_R of the receiver the QB is turning to, he breaks for where
 * that man will be when the ball gets there, before it's thrown. Man
 * defenders keep playing the man.
 */
const JUMP_R = 8;
function jumpThrow(s: PlayState, d: Agent): boolean {
  const w = s.windup!;
  // (A man who's read the bubble is playing it as a run: ai.ts bubbleRead.)
  if (w.away || d.mem.bubble !== undefined) return false;
  const as = s.setup.def.assign[d.slot as keyof typeof s.setup.def.assign];
  if (as.kind !== 'zone') return false;
  const hawk = has(d, 'ballhawk') ? 0.67 : 1;
  // A Zone Reader breaks on the QB's eyes: 0.08 s sooner (the trait catalog's line).
  // On rhythm the motion is compact and the eyes move: he reads it later (ai.ts RHYTHM_READ).
  if (s.t - w.from < reaction(s, d) * hawk - (has(d, 'zone-reader') ? 0.08 : 0) + (onRhythm(s) ? RHYTHM_READ : 0)) return false;
  const r = s.agents[s.icons[w.icon]!]!;
  // A Center Fielder in a deep zone covers 3 yd more (the trait catalog's line).
  const deepZone = as.zone === 'deepM' || as.zone === 'deepL' || as.zone === 'deepR';
  if (dist(d.pos, r.pos) > JUMP_R + (deepZone && has(d, 'center-fielder') ? 3 : 0)) return false;
  const ahead = Math.max(0, w.at - s.t) + 0.5;
  steer(d, arrive(d, { x: r.pos.x + r.vel.x * ahead, y: r.pos.y + r.vel.y * ahead }, 1, 0.8));
  d.mem.onBall = true;
  return true;
}

function defenseRoles(s: PlayState): void {
  const call = s.setup.def.assign;
  const carrier = s.carrier >= 0 ? s.agents[s.carrier]! : null;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down || i === s.carrier) continue;
    if (blockOf(s, i)) continue;
    if (d.mem.outOfPlay) {
      steer(d, { x: 0, y: 0 }, { pace: 0.3 });
      continue;
    }
    if (d.busy > 0) {
      steer(d, { x: 0, y: 0 }, { pace: 0.3 });
      continue;
    }
    if (s.phase === 'loose' || s.ball.mode === 'loose') {
      steer(d, { x: (s.ball.pos.x - d.pos.x) * 3, y: (s.ball.pos.y - d.pos.y) * 3 });
      continue;
    }
    if (carrier && carrier.side === 'off' && !s.setup.play.run) {
      // After a catch (or a scramble) everyone pursues; a screen caught behind the line, the men in front of it fit it first.
      if (d.busy === 0 && screenFit(s, d, carrier)) continue;
      pursueTackle(s, d, carrier);
      continue;
    }
    // The zone read's read end plays his read (crash or sit) until he's seen the mesh.
    if (readEndStep(s, d)) continue;
    // A run (or a run fake) he has read: his fit. Until he reads it he plays pass.
    if ((s.setup.play.run || (s.setup.play.pa && s.phase !== 'air')) && belief(s, d) === 'run') {
      runFit(s, d);
      continue;
    }
    if (carrier && carrier.side === 'off') {
      // A run he hasn't read yet but that's on him: tackle what's in front of him.
      if (dist(d.pos, carrier.pos) < 2.5) {
        pursueTackle(s, d, carrier);
        continue;
      }
    }
    if (carrier && carrier.side === 'def') {
      // Our turnover: block for the returner (just head upfield with him).
      steer(d, { x: -d.fx.vmax * 0.8, y: (carrier.pos.y - d.pos.y) * 0.5 });
      continue;
    }
    // Reading the QB's shoulders: a zone defender near the man he's winding
    // up to breaks on the throw before it's out (GDD §10.4).
    if (s.windup && s.phase !== 'air' && jumpThrow(s, d)) continue;
    if (s.phase === 'air') {
      const t0 = (d.mem.sawThrow as number | undefined) ?? -1;
      if (t0 < 0) d.mem.sawThrow = s.t;
      const since = s.t - ((d.mem.sawThrow as number | undefined) ?? s.t);
      // A man who read the windup and jumped it keeps going to the ball as
      // it leaves (M6.5 calibration: he used to stop and wait a whole
      // reaction time at the release, and drift back toward his zone just
      // as the ball came out).
      // A screen: zone defenders who've read the throw (or the bubble before it) play it as a perimeter run, force and alley, not as a ball to break on.
      const readBubble = d.mem.bubbleAt !== undefined && s.t - (d.mem.bubbleAt as number) >= reaction(s, d);
      if (s.ball.target >= 0 && (since >= reaction(s, d) || readBubble) && rallyScreen(s, d)) continue;
      const jumped = d.mem.onBall === true && s.ball.target >= 0;
      if (jumped && !rallies(s).includes(i)) {
        breakOnBall(s, d);
        continue;
      }
      if (s.ball.target >= 0 && since >= reaction(s, d)) {
        if (rallies(s).includes(i)) {
          breakOnBall(s, d);
          continue;
        }
        if (flowToBall(s, d)) continue;
      }
    }
    const as = call[d.slot as keyof typeof call];
    switch (as.kind) {
      case 'rush':
        // A rusher has his eyes on the QB: he turns to the ball once he's read the throw (his reaction), not as it leaves the hand
        // (a screen is built on that beat: the rush runs on past the back it's thrown to).
        if (s.phase === 'air' && (s.ball.target < 0 || s.t - s.ball.releaseT >= reaction(s, d))) pursueTackle(s, d, s.agents[Math.max(0, s.ball.target)]!);
        else rush(s, d);
        break;
      case 'man':
        manCover(s, d, manOf(s, d)!);
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
  else if (s.phase === 'air' && inp.auto && s.setup.user) s.catchType = autoCatch(s);
  // Nobody but the ball carrier runs out of bounds on his own (movement.ts
  // governs his speed toward a sideline): route runners keep ~1 yd, everyone
  // else half a yard. The QB with the ball is a runner too (his lines are lineCheck's).
  for (const a of s.agents) a.mem.room = a.i === s.carrier || (a.i === s.qb && s.ball.holder === s.qb) ? null : s.ball.mode === 'air' && s.ball.target === a.i ? 0.2 : a.route ? 1 : 0.5;
  if (s.phase !== 'air' && s.phase !== 'carrier') qbThrow(s, inp);
  offenseRoles(s, inp);
  defenseRoles(s);
  // Pressure (the harness's time to pressure): a free rusher within ~3 yd of him (pressureOn 0.45), NGS's "pressure" radius.
  if (s.pressureT < 0 && (s.phase === 'dropback' || s.phase === 'pocket') && pressureOn(s, s.agents[s.qb]!) >= 0.45) s.pressureT = s.t;
  if (s.phase === 'dropback' || s.phase === 'pocket') notePressures(s);
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
  // The QB with the ball in the pocket (a drop or a scramble behind the line) is a runner at the lines too.
  else if (s.carrier < 0 && s.snapT >= 0 && s.ball.mode === 'held' && s.ball.holder === s.qb && !s.result && s.t - s.snapT > 0.4) lineCheck(s, s.agents[s.qb]!);
  contactStep(s);
  tickDowned(s);
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
  const lim = FIELD_HALF_W - OOB_FOOT;
  for (const a of s.agents) {
    if (a.i === s.carrier) continue;
    // A foot on or over a line while the play is live: he's out of the play
    // until the whistle (he can't come back in and be the first to touch a
    // pass, or make a play on the ball or the carrier).
    // Nobody runs out on his own: a player who isn't carrying it (and isn't
    // being driven there by a block) pulls up at the sideline, the last of
    // his run toward it taken off (the steering's governor slows him first).
    const edge = FIELD_HALF_W - (typeof a.mem.room === 'number' ? Math.max(PULL_UP, a.mem.room * 0.8) : 0);
    if (typeof a.mem.room === 'number' && !a.mem.outOfPlay && !blockOf(s, a.i) && Math.abs(a.pos.y) > edge) {
      a.pos.y = Math.sign(a.pos.y) * edge;
      if (a.vel.y * a.pos.y > 0) a.vel.y = 0;
    }
    const out = Math.abs(a.pos.y) > lim || a.pos.x > END_X - OOB_FOOT || a.pos.x < BACK_X + OOB_FOOT;
    if (out && !a.mem.outOfPlay && s.snapT >= 0 && !s.result) {
      a.mem.outOfPlay = true;
    }
    if (a.mem.outOfPlay && Math.abs(a.pos.y) > FIELD_HALF_W - 1 && Math.abs(a.pos.y) < FIELD_HALF_W) {
      // Out is out: he stays on the sideline, not back in.
      a.pos.y = Math.sign(a.pos.y) * FIELD_HALF_W;
      if (a.vel.y * a.pos.y < 0) a.vel.y = 0;
    }
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
