// The tunnel reveal (M7; GDD §6.2 "after the ninth stall the camera ... walks
// out the tunnel into the stadium", §11.2, BRIEF "fog, pyro, crowd roar").
// It grows from the locker room's walk-out: the room's camera walks down the
// corridor into the white of daylight and hands over here, inside the
// stadium's tunnel mouth (render/stadium/tunnel.ts). Then three shots:
//   1. tunnel   a Steadicam behind the Contenders as they run out of the
//               dark into the light, the pyro going up at the mouth, then a
//               rise over them on the skycam wire as they spread onto the
//               field: the bowl, the sea past the open end, and the Beasts
//               waiting in a line in front of it;
//   2. beasts   cut: low and long down the Beasts' line, tracking to the
//               best of them, the home crowd at its loudest, his lower third;
//   3. faceoff  cut: high from the north-west corner, both teams facing
//               each other across midfield, the sea behind the Beasts.
// Then the pre-game card (GameScreen PreGame) over the teams set at the
// spot: the press to kick off. The fast version (Quick Play, or Settings ›
// Fast reveal) is the run-out and the face-off only.
//
// Skippable at any moment, here and in the room's walk (confirm, back or
// Start; the on-screen Skip). The clock is the scene's frame step (real
// seconds; a recorded video's game time), never the wall clock. It only
// shows: nothing in the match reads it, and a game started straight from
// finishWalkout (the browser tests, the harnesses) has no reveal at all.
//
// React reads a small store that changes on the cuts only.

import { create } from 'zustand';
import { threatTier } from '@/engine';
import { traitInfo } from '@/engine/ratings/traits';
import { Input } from '@/input/InputManager';
import type { RatedBeasts } from './beasts';
import type { Catalog } from './draft';

export type RevealShot = 'hold' | 'tunnel' | 'beasts' | 'faceoff';

/** The Beast the Beasts shot ends on, as his lower third says him. */
export interface RevealStar {
  id: string;
  name: string;
  pos: string;
  team: string;
  decade: string;
  /** OVR (null in Film Room: no numbers). */
  ovr: number | null;
  /** His headline trait's name, if he has one. */
  trait: string | null;
}

export interface RevealInfo {
  star: RevealStar;
  /** Your quarterback (he leads them out). */
  qb: string | null;
  /** The Beasts' defense rating (null in Film Room) and threat word (NIGHTMARE, BRUTAL, ...). */
  rating: number | null;
  threat: string;
  /** Quick Play or the Fast reveal setting: the run-out and the face-off only. */
  fast: boolean;
}

/** Seconds each shot holds. */
export const REVEAL_SECS = {
  normal: { tunnel: 7.4, beasts: 4.8, faceoff: 3.4 },
  fast: { tunnel: 5.6, beasts: 0, faceoff: 2.6 },
};

/** Longest the hand-over holds in the tunnel's light waiting for the game scene to be built (it shows the walk-out's white). */
export const HOLD_MAX = 20;

/**
 * The graphics' beats inside each shot (s): the HUD changes on them, so a
 * lower third comes up on the reveal's own clock (a recorded video's too),
 * not on a CSS timer. tunnel: the Contenders' lower third; beasts: the
 * Beasts' card, then the best man's; faceoff: the matchup.
 */
export const REVEAL_BEATS: Record<'normal' | 'fast', Record<'tunnel' | 'beasts' | 'faceoff', number[]>> = {
  normal: { tunnel: [3.7], beasts: [0.5, 2.2], faceoff: [0.3] },
  fast: { tunnel: [2.9], beasts: [], faceoff: [0.2] },
};

export interface RevealUi {
  open: boolean;
  shot: RevealShot | null;
  /** How many of the shot's beats have passed. */
  beat: number;
  info: RevealInfo | null;
}

export const useReveal = create<RevealUi>(() => ({ open: false, shot: null, beat: 0, info: null }));

/** The info from the draft: the Beasts' best man (OVR, the base eleven), the rating and the threat word. */
export function revealInfo(b: RatedBeasts, cat: Catalog | null, film: boolean, fast: boolean, qb: string | null = null): RevealInfo {
  const star = [...b.beasts].sort((x, y) => y.imp - x.imp)[0]!;
  const e = cat?.entry.get(star.id);
  const t = e?.traits.map((x) => traitInfo(x.id)).find((x) => x && x.polarity !== 'negative');
  // Tiers are on legacy's scale; the OVR-fed rating maps onto it as legacy ≈ 1.518·new − 53.01 (src/game/daily.ts).
  const tier = threatTier(Math.round(1.518 * b.rating.rating - 53.01));
  return {
    star: { id: star.id, name: star.n, pos: star.p, team: star.t, decade: star.d, ovr: film ? null : Math.round(star.imp), trait: t?.label ?? null },
    qb,
    rating: film ? null : Math.round(b.rating.rating),
    threat: tier.l,
    fast,
  };
}

class TunnelReveal {
  /** The reveal owns the camera, the bodies and the exposure (from the hand-over until it ends). */
  active = false;
  /** Seconds into the current shot. */
  shotT = 0;
  /** Seconds since the run-out started (the team's clock; 0 through the hold). */
  t = 0;
  shot: RevealShot = 'hold';
  /** Set on every cut; the camera takes it. */
  cut = false;
  /** Set when it ends: the game camera cuts to the pre-game picture (it takes it). */
  handback = false;
  info: RevealInfo | null = null;
  /** Bumped on every arm: the scene re-sets the bodies for a new reveal. */
  epoch = 0;
  private held = 0;
  private off: (() => void) | null = null;

  /** The walk-out's hand-over: the reveal takes the camera in the tunnel's light. */
  arm(info: RevealInfo): void {
    this.active = true;
    this.info = info;
    this.t = 0;
    this.shotT = 0;
    this.held = 0;
    this.shot = 'hold';
    this.cut = true;
    this.handback = false;
    this.epoch++;
    useReveal.setState({ open: true, shot: 'hold', beat: 0, info });
    // Start (Esc on the keyboard) skips it too; confirm and back are the HUD's (TunnelHud).
    this.off?.();
    this.off = Input.onAction((id, i) => {
      if (id === 'global.pause' && !i.repeat) this.skip();
    });
  }

  private secs() {
    return this.info?.fast ? REVEAL_SECS.fast : REVEAL_SECS.normal;
  }

  /** The shots in order (the fast version has no Beasts shot). */
  private order(): RevealShot[] {
    return this.secs().beasts > 0 ? ['tunnel', 'beasts', 'faceoff'] : ['tunnel', 'faceoff'];
  }

  /**
   * Each frame, by the scene's step. `ready`: the game scene's bodies are
   * built and the pre-game lineup is up (until then it holds in the light).
   */
  frame(dt: number, ready: boolean): void {
    if (!this.active) return;
    if (this.shot === 'hold') {
      this.held += dt;
      if (ready) this.go('tunnel');
      else if (this.held > HOLD_MAX) this.skip();
      return;
    }
    this.t += dt;
    this.shotT += dt;
    const beats = REVEAL_BEATS[this.info?.fast ? 'fast' : 'normal'][this.shot as 'tunnel' | 'beasts' | 'faceoff'];
    const beat = beats.filter((b) => this.shotT >= b).length;
    if (beat !== useReveal.getState().beat) useReveal.setState({ beat });
    const secs = this.secs();
    if (this.shotT >= secs[this.shot as 'tunnel' | 'beasts' | 'faceoff']) {
      const o = this.order();
      const next = o[o.indexOf(this.shot) + 1];
      if (next) this.go(next);
      else this.end();
    }
  }

  private go(shot: RevealShot): void {
    this.shot = shot;
    this.shotT = 0;
    this.cut = true;
    useReveal.setState({ shot, beat: 0 });
  }

  /** Straight to the pre-game card. */
  skip(): void {
    if (this.active) this.end();
  }

  private end(): void {
    this.active = false;
    this.handback = true;
    this.shot = 'hold';
    this.off?.();
    this.off = null;
    useReveal.setState({ open: false, shot: null });
  }

  /** Leaving the game screen mid-reveal: let it go without a hand-back. */
  abort(): void {
    if (!this.active) return;
    this.end();
    this.handback = false;
  }
}

export const reveal = new TunnelReveal();

if (import.meta.env.DEV) Object.assign(globalThis, { __btbReveal: reveal, __btbRevealUi: useReveal });
