import * as THREE from 'three';
import { Audio } from '@/audio/audio';
import { CELEB_BY_ID, celebration, useCelebration, type Celebration } from '@/game/celebration';
import { fieldX, fieldY } from '@/game/coords';
import type { PlayState } from '@/sim';
import { crowdEnergy } from '../crowd/reactions';
import type { Body } from './choreo';
import type { Officials } from './officials';

// The touchdown celebration on the field (M7, Playtest 1 #7), render-only:
// after the whistle the scene stops drawing the scorer and the team-mates
// coming over from the sim and drives them itself (the sim's dead ball
// carries on underneath, untouched). The scorer pulls up, turns to whatever
// the celebration plays to (the stands, the official, his team-mate) and
// plays the clip, the root moved by its travel; the team-mates run over,
// set behind him and react; when he's done the first of them comes in for
// a high five. The ball is his until the clip lets it go (a spike bounces,
// a flip carries to the official, a drop rolls). GameCamera reads
// `celebView` for its low, tight shot; the crowd comes up as the clip starts.

/** Where the camera looks (field frame): the scorer, his facing, how long the shot has run, and a cut when it comes on. */
export const celebView = { on: false, x: 0, y: 0, face: 0, t: 0, cut: false, clip: '', done: false };

type Mode = 'run' | 'face' | 'react' | 'settle' | 'wait' | 'clip' | 'five' | 'idle';

interface Actor {
  i: number;
  b: Body;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  mode: Mode;
  /** The spot he's going to and the way he'll face there (world). */
  tx: number;
  tz: number;
  tyaw: number;
  /** The clip playing and its time last frame (for its events). */
  clip: string;
  lastT: number;
  /** Seconds in this mode. */
  since: number;
}

type BallMode = 'none' | 'hand_r' | 'hand_l' | 'free' | 'held' | 'rest';

const G = 9.81;
/** The ball's centre rests this high when it lies on the turf (m: half its 0.17 m width plus a touch). */
const BALL_REST_Y = 0.09;
/** Team-mates set this far from the scorer (m), behind him on either side (deg off his facing), so a camera in front has them in the shot. */
const MATE_DIST = 2.5;
const MATE_ANGLE = [140, -140];
/** The chest bump's partner stands this far in front of him (m); the five's (both ~0.58 m forward to the slap). */
const BUMP_DIST = 1.4;
const FIVE_DIST = 1.15;
const RUN_TOP = 6.5;
const RUN_ACCEL = 6;
/** The scorer pulls up at this rate (m/s²) and turns at most this fast (rad/s) before his clip. */
const SETTLE_DECEL = 9;
const TURN = 5;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);

export class CelebrateScene {
  private play = -1;
  private actors = new Map<number, Actor>();
  private scorer: Actor | null = null;
  private mates: Actor[] = [];
  private def: Celebration | null = null;
  /** The bump's partner (a mate), the five's. */
  private partner: Actor | null = null;
  private fiver: Actor | null = null;
  private doneAt = -1;
  /** The five has been played. */
  private fived = false;
  /** Seconds since the celebration started playing. */
  private t = 0;
  /** Given back for the rest of this play (a replay took the scene). */
  private released = false;
  private ball = { mode: 'none' as BallMode, p: new THREE.Vector3(), v: new THREE.Vector3(), w: new THREE.Vector3(), q: new THREE.Quaternion(), target: new THREE.Vector3(), flight: 0, bounces: 0 };

  owns(i: number): boolean {
    return this.actors.has(i);
  }

  /** A new play, or a replay taking the scene: everyone back to the sim. */
  reset(play = -1): void {
    this.play = play;
    this.actors.clear();
    this.scorer = null;
    this.mates = [];
    this.def = null;
    this.partner = null;
    this.fiver = null;
    this.doneAt = -1;
    this.fived = false;
    this.t = 0;
    this.released = false;
    this.ball.mode = 'none';
    celebView.on = false;
  }

  /** A replay opened over it: let go of the bodies for good (the replay hands back the play's own end). */
  release(): void {
    if (this.actors.size === 0 && !celebView.on) return;
    const p = this.play;
    this.reset(p);
    this.released = true;
  }

  /** Each frame (not during a replay), after the sim-driven bodies are drawn. */
  update(bodies: Body[], s: PlayState, playId: number, dt: number, officials: Officials | null): void {
    if (playId !== this.play) this.reset(playId);
    const ui = useCelebration.getState();
    const cast = celebration.cast;
    if (this.released || ui.phase === 'off' || !cast || cast.play !== playId) {
      celebView.on = false;
      return;
    }
    const sb = bodies[cast.scorer]!;
    // The team-mates set off as soon as the prompt is up.
    if (this.mates.length === 0 && this.actors.size === 0) {
      for (const i of cast.mates) {
        const b = bodies[i]!;
        if (b.lie || b.ragdoll.active || b.fallen) continue;
        const a = this.take(i, b, 'run');
        this.mates.push(a);
      }
    }
    // The scorer is his own (and the ball) once the choice is made.
    if ((ui.phase === 'play' || ui.phase === 'done') && !this.scorer) this.startScorer(cast.scorer, sb, ui.picked, s, bodies, officials);
    if (ui.phase === 'play' || ui.phase === 'done') this.t += dt;
    // The mates' spots ride with the scorer until he has set.
    const sx = this.scorer ? this.scorer.x : sb.player.root.position.x;
    const sz = this.scorer ? this.scorer.z : sb.player.root.position.z;
    const syaw = this.scorer ? this.scorer.yaw : sb.player.root.rotation.y;
    this.mates.forEach((m, k) => {
      if (m.mode !== 'run') return;
      if (m === this.partner) {
        const toward = yawTo(sx, sz, m.x, m.z);
        const ang = this.scorer && this.scorer.mode !== 'settle' ? this.scorer.yaw : toward;
        m.tx = sx + Math.sin(ang) * BUMP_DIST;
        m.tz = sz + Math.cos(ang) * BUMP_DIST;
      } else if (m === this.fiver) {
        // (set when the five starts)
      } else {
        const ang = syaw + (MATE_ANGLE[k % 2]! * Math.PI) / 180;
        m.tx = sx + Math.sin(ang) * MATE_DIST;
        m.tz = sz + Math.cos(ang) * MATE_DIST;
      }
      m.tyaw = yawTo(m.tx, m.tz, sx, sz);
    });
    if (ui.phase === 'done' && this.doneAt < 0) this.cut();
    for (const a of this.actors.values()) this.step(a, dt);
    if (this.scorer) this.direct(dt);
    // The camera's subject.
    const r = this.scorer ? { x: this.scorer.x, z: this.scorer.z, yaw: this.scorer.yaw } : { x: sb.player.root.position.x, z: sb.player.root.position.z, yaw: sb.player.root.rotation.y };
    if (!celebView.on) {
      celebView.on = true;
      celebView.cut = true;
      celebView.t = 0;
    }
    celebView.x = fieldX(r.z);
    celebView.y = fieldY(r.x);
    celebView.face = wrap(r.yaw - Math.PI);
    celebView.t += dt;
    celebView.clip = this.scorer?.clip ?? '';
    celebView.done = ui.phase === 'done';
    this.stepBall(dt);
  }

  private take(i: number, b: Body, mode: Mode): Actor {
    const r = b.player.root;
    b.animator.setHold(null);
    b.animator.stopOverlay();
    const a: Actor = { i, b, x: r.position.x, z: r.position.z, yaw: r.rotation.y, speed: Math.max(0, b.gaitSpeed), mode, tx: r.position.x, tz: r.position.z, tyaw: r.rotation.y, clip: '', lastT: 0, since: 0 };
    this.actors.set(i, a);
    return a;
  }

  private startScorer(i: number, b: Body, picked: string | null, s: PlayState, bodies: Body[], officials: Officials | null): void {
    const def = picked ? CELEB_BY_ID.get(picked as never) ?? null : null;
    const a = this.take(i, b, 'settle');
    this.scorer = a;
    this.def = def;
    if (s.ball.mode === 'held' && s.ball.holder === i) this.ball.mode = 'hand_r';
    // Which way he turns before it plays.
    a.tyaw = a.yaw;
    if (def?.face === 'stands') a.tyaw = Math.PI; // the offense attacks world −Z: the stands behind the end line
    else if (def?.face === 'official' && officials) {
      officials.nearestAt(a.x, a.z, _v);
      a.tyaw = yawTo(a.x, a.z, _v.x, _v.z);
      this.ball.target.set(_v.x, 1.25, _v.z).addScaledVector(_d.set(a.x - _v.x, 0, a.z - _v.z).normalize(), 0.35);
    } else if (def?.face === 'mate') {
      this.partner = this.mates[0] ?? null;
      if (this.partner) {
        a.tyaw = yawTo(a.x, a.z, this.partner.x, this.partner.z);
        // Set (or on his way) behind him: round to the front for it.
        if (this.partner.mode !== 'run') this.setMode(this.partner, 'run');
      }
    }
    void bodies;
  }

  /** Move and animate one body for its mode. */
  private step(a: Actor, dt: number): void {
    const anim = a.b.animator;
    a.since += dt;
    let speed = 0;
    let yawRate = 0;
    if (a.mode === 'run' || (a.mode === 'settle' && a !== this.scorer)) {
      const dx = a.tx - a.x;
      const dz = a.tz - a.z;
      const d = Math.hypot(dx, dz);
      const want = Math.min(RUN_TOP, Math.sqrt(2 * RUN_ACCEL * Math.max(0, d - 0.1)));
      a.speed = want > a.speed ? Math.min(want, a.speed + RUN_ACCEL * dt) : Math.max(want, a.speed - RUN_ACCEL * 1.5 * dt);
      if (d > 0.3) {
        const head = Math.atan2(dx, dz);
        const dy = wrap(head - a.yaw);
        const turn = Math.max(-8 * dt, Math.min(8 * dt, dy));
        a.yaw += turn;
        yawRate = dt > 0 ? turn / dt : 0;
        const mv = Math.min(d, a.speed * dt);
        a.x += (dx / d) * mv;
        a.z += (dz / d) * mv;
      }
      speed = a.speed;
      if (d < 0.3 && a.speed < 0.8) {
        a.speed = 0;
        this.setMode(a, 'face');
      }
    } else if (a.mode === 'settle') {
      // The scorer pulls up along his line and turns to what he plays to.
      a.speed = Math.max(0, a.speed - SETTLE_DECEL * dt);
      a.x += Math.sin(a.yaw) * a.speed * dt;
      a.z += Math.cos(a.yaw) * a.speed * dt;
      speed = a.speed;
      yawRate = this.turnToward(a, a.tyaw, dt);
    } else if (a.mode === 'face' || a.mode === 'wait' || a.mode === 'idle') {
      yawRate = this.turnToward(a, a.mode === 'idle' && a !== this.scorer && this.scorer ? yawTo(a.x, a.z, this.scorer.x, this.scorer.z) : a.tyaw, dt);
      // (They wait for the pick to react: one of them may be wanted for the chest bump.)
      if (a.mode === 'face' && this.scorer && Math.abs(wrap(a.tyaw - a.yaw)) < 0.15 && a !== this.partner && a !== this.fiver) {
        if (anim.lib.meta.cel_mate_point && a.since > 0.1) this.playClip(a, 'cel_mate_point');
      } else if (a.mode === 'face' && (a === this.partner || a === this.fiver)) this.setMode(a, 'wait');
    } else if (a.mode === 'clip' || a.mode === 'react' || a.mode === 'five') {
      const tr = anim.transition;
      if (!tr || tr.done || tr.name !== a.clip) {
        a.clip = '';
        this.setMode(a, 'idle');
        if (a === this.scorer && this.ball.mode === 'hand_r') anim.setHold('ovl_carry_r');
      }
    }
    // A clip's root motion moves him along his facing.
    anim.update(dt, { speed, yawRate: Math.max(-4, Math.min(4, yawRate)) });
    const rm = anim.rootMotion;
    if (rm) {
      a.x += Math.sin(a.yaw) * rm;
      a.z += Math.cos(a.yaw) * rm;
    }
    this.events(a);
    const root = a.b.player.root;
    root.position.set(a.x, 0, a.z);
    root.rotation.y = a.yaw;
    a.b.yaw = a.yaw;
    a.b.lastYaw = a.yaw;
    a.b.gaitSpeed = speed;
    a.b.ragdoll.update(dt);
  }

  private turnToward(a: Actor, yaw: number, dt: number): number {
    const dy = wrap(yaw - a.yaw);
    const turn = Math.max(-TURN * dt, Math.min(TURN * dt, dy * (1 - Math.exp(-dt * 10))));
    a.yaw += turn;
    return dt > 0 ? turn / dt : 0;
  }

  private setMode(a: Actor, m: Mode): void {
    a.mode = m;
    a.since = 0;
  }

  private playClip(a: Actor, clip: string, mode: Mode = 'react'): void {
    if (!a.b.animator.lib.meta[clip]) {
      this.setMode(a, 'idle');
      return;
    }
    a.b.animator.setHold(null);
    a.b.animator.play(clip, { now: true });
    a.clip = clip;
    a.lastT = 0;
    this.setMode(a, mode);
  }

  /** The scorer's beats: set, the clip, the five, done. */
  private direct(dt: number): void {
    const sc = this.scorer!;
    const def = this.def;
    void dt;
    if (sc.mode === 'settle' && sc.speed < 0.4 && Math.abs(wrap(sc.tyaw - sc.yaw)) < 0.12) {
      const p = this.partner;
      if (def?.mate && p) {
        // The bump waits (a beat at most) for the partner to be set in front of him.
        if (p.mode !== 'wait' && sc.since < 3) return;
        if (p.mode === 'wait') this.playClip(p, def.clip, 'clip');
      }
      if (def) {
        this.playClip(sc, def.clip, 'clip');
        // The camera cuts to the front of the way he plays it, and the push starts again.
        celebView.cut = true;
        celebView.t = 0;
        crowdEnergy.trigger('celebration', performance.now() / 1000);
        Audio.celebrationRoar();
      } else this.setMode(sc, 'idle');
      return;
    }
    if (sc.mode !== 'idle' || this.doneAt >= 0) return;
    // The five: the first team-mate who has set comes in for it.
    if (this.fived) {
      // The five is over: done (the bodies stand where they are under the card).
      this.end();
      return;
    }
    if (!this.fiver) {
      // A team-mate who has set and reacted (one who isn't the bump's partner first).
      const m = this.mates.find((x) => x !== this.partner && x.mode === 'idle') ?? (this.partner?.mode === 'idle' ? this.partner : undefined);
      if (m && sc.since < 2.5) {
        this.fiver = m;
        const ang = yawTo(sc.x, sc.z, m.x, m.z);
        m.tx = sc.x + Math.sin(ang) * FIVE_DIST;
        m.tz = sc.z + Math.cos(ang) * FIVE_DIST;
        m.tyaw = ang + Math.PI;
        sc.tyaw = ang;
        this.setMode(m, 'run');
      } else if (sc.since >= 2.5 || this.mates.length === 0) this.end();
      return;
    }
    const f = this.fiver;
    if (f.mode === 'wait' && Math.abs(wrap(sc.tyaw - sc.yaw)) < 0.1 && Math.abs(wrap(f.tyaw - f.yaw)) < 0.1) {
      // Both play the five: the scorer with his free hand if the ball's in his right.
      this.playClip(sc, this.ball.mode === 'hand_r' ? 'cel_five_l' : 'cel_five_r', 'five');
      this.playClip(f, 'cel_five_r', 'five');
      this.fived = true;
      return;
    }
    if (sc.since > 3) this.end();
  }

  /** Skipped: everyone stands where he is (the card comes straight up over them). */
  private cut(): void {
    this.doneAt = this.t;
    for (const a of this.actors.values()) {
      const anim = a.b.animator;
      anim.reset();
      anim.setStance('stance_idle');
      if (a === this.scorer && this.ball.mode === 'hand_r') anim.setHold('ovl_carry_r');
      anim.update(10, { speed: 0 });
      a.speed = 0;
      a.clip = '';
      this.setMode(a, 'idle');
    }
  }

  private end(): void {
    if (this.doneAt >= 0) return;
    this.doneAt = this.t;
    celebration.finish();
  }

  /** The clip's moments as they pass. */
  private events(a: Actor): void {
    const tr = a.b.animator.transition;
    if (!a.clip || !tr || tr.name !== a.clip) return;
    const meta = a.b.animator.lib.meta[a.clip];
    const evs = meta?.events;
    if (!evs) return;
    const fps = a.b.animator.lib.fps;
    for (const [k, f] of Object.entries(evs)) {
      const at = f / fps;
      if (a.lastT < at && tr.t >= at) this.onEvent(a, k);
    }
    a.lastT = tr.t;
  }

  private onEvent(a: Actor, ev: string): void {
    if (ev === 'contact') {
      // Pads meeting in the bump (once, from the scorer's clip); hands meeting in the five.
      if (a === this.scorer) Audio.hit(a.clip === 'cel_chest_bump' ? 5 : 1.5, false);
      return;
    }
    if (a !== this.scorer || this.ball.mode !== 'hand_r') return;
    if (ev === 'left') {
      this.ball.mode = 'hand_l';
      return;
    }
    if (ev !== 'release') return;
    const B = this.ball;
    this.handPoint(a.b, 'r', B.p, _d);
    const fx = Math.sin(a.yaw);
    const fz = Math.cos(a.yaw);
    B.bounces = 0;
    B.flight = 0;
    const id = this.def?.id;
    if (id === 'flip') {
      // Underhand to the official's chest: the throw that lands there in 0.8 s.
      const T = 0.8;
      B.v.set((B.target.x - B.p.x) / T, (B.target.y - B.p.y) / T + 0.5 * G * T, (B.target.z - B.p.z) / T);
      B.w.set(0, 0, 0);
      B.mode = 'free';
      B.flight = T;
    } else if (id === 'spike' || id === 'spinSpike') {
      // Thrown into the turf: it comes back up end over end.
      B.v.set(fx * 2.2, -10, fz * 2.2);
      B.w.set(fz * 14, 3, -fx * 14);
      B.mode = 'free';
    } else {
      // Let go: it drops off the hand and rolls.
      B.v.set(fx * 0.5, -0.3, fz * 0.5);
      B.w.set(fz * 3, 1, -fx * 3);
      B.mode = 'free';
    }
  }

  /** The palm of a hand (world) and the forearm's direction. */
  private handPoint(b: Body, side: 'l' | 'r', out: THREE.Vector3, dir: THREE.Vector3): boolean {
    const h = b.player.bones.get(`hand_${side}`);
    const e = b.player.bones.get(`forearm_${side}`);
    if (!h || !e) return false;
    h.getWorldPosition(out);
    e.getWorldPosition(_w);
    dir.subVectors(out, _w).normalize();
    out.addScaledVector(dir, 0.06);
    return true;
  }

  private stepBall(dt: number): void {
    const B = this.ball;
    if (B.mode !== 'free') return;
    if (B.flight > 0) {
      // To the official: caught at the end of the flight.
      B.flight -= dt;
      if (B.flight <= 0) {
        B.mode = 'held';
        B.p.copy(B.target);
        return;
      }
    }
    B.v.y -= G * dt;
    B.p.addScaledVector(B.v, dt);
    const wl = B.w.length();
    if (wl > 1e-4) B.q.premultiply(_q.setFromAxisAngle(_v.copy(B.w).divideScalar(wl), wl * dt));
    if (B.p.y < BALL_REST_Y && B.v.y < 0) {
      B.p.y = BALL_REST_Y;
      if (B.bounces++ === 0) Audio.ballThud(Math.min(1, -B.v.y / 10));
      // A football bounces off its points at odd angles; damped, and the tumble keeps some of its spin.
      B.v.y = -B.v.y * 0.42;
      const k = B.bounces % 2 ? 0.35 : -0.25;
      B.v.set(B.v.x * 0.62 + B.v.z * k, B.v.y, B.v.z * 0.62 - B.v.x * k);
      B.w.multiplyScalar(0.6);
      if (Math.abs(B.v.y) < 0.6 && Math.hypot(B.v.x, B.v.z) < 0.35) {
        B.mode = 'rest';
        // Lying on its side: the long axis level.
        _v.set(1, 0, 0).applyQuaternion(B.q).setY(0);
        if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0);
        B.q.setFromUnitVectors(_X, _v.normalize());
      }
    }
  }

  /** The ball while the celebration has it. False: the scene places it as usual. */
  placeBall(ball: THREE.Object3D): boolean {
    const B = this.ball;
    const sc = this.scorer;
    if (B.mode === 'none' || !sc) return false;
    if (B.mode === 'hand_r' || B.mode === 'hand_l') {
      const side = B.mode === 'hand_r' ? 'r' : 'l';
      if (!this.handPoint(sc.b, side, ball.position, _d)) return false;
      // Tucked again once the clip is over (the carry overlay): its back along the forearm.
      if (sc.b.animator.overlayAction === null && sc.mode === 'idle' && side === 'r') ball.position.addScaledVector(_d, -0.15);
      ball.quaternion.setFromUnitVectors(_X, _d);
      B.p.copy(ball.position);
      B.q.copy(ball.quaternion);
      return true;
    }
    ball.position.copy(B.p);
    if (B.mode === 'held') ball.quaternion.setFromAxisAngle(_Y, Math.atan2(sc.x - B.p.x, sc.z - B.p.z) + Math.PI / 2);
    else ball.quaternion.copy(B.q);
    return true;
  }
}

export const celebrate = new CelebrateScene();

if (import.meta.env.DEV) Object.assign(globalThis, { __btbCelebScene: celebrate });
