// The kick (M6.6, Playtest 2): aim first, then hold to charge power and
// release inside a moving accuracy window. The same scheme for PATs, field
// goals and punts. Pure: every number here comes from the input events'
// own timestamps (the press's keydown / pad poll, the release's keyup /
// mouseup / pad poll), never from when a frame happened to be drawn, so a
// quick tap or a release between two frames counts exactly as it was
// pressed (the M6 and Playtest 2 fix for taps missed on a controller).
//
// The meter: power fills from 0 as you hold (linearly: a meter you can
// learn), to 1 (the leg) and on to METER_MAX (overcooked: a slice). A green
// window slides up and down the same meter. Release with the fill inside it
// and the strike is clean; outside, the kick is hooked (let go early, under
// the window) or pushed (late, over it), more the farther out. So a short
// kick is easy (the window passes low power often), and a long one asks you
// to time the press so the fill meets the window near the top.

import type { Difficulty } from '@/sim';

export type KickKind = 'PAT' | 'FG' | 'PUNT';

export interface MeterTuning {
  /** Hold to full power (1.0), ms. */
  fillMs: number;
  /** Half the window's height, in meter units. */
  half: number;
  /** The window's travel: cycles a second. */
  hz: number;
}

/** Top of the meter: past 1 the strike is overcooked (more carry, a slice). */
export const METER_MAX = 1.12;
/** The window's center travels between these (it never sits at the bottom: nobody kicks with no leg). */
export const WINDOW_LO = 0.42;
export const WINDOW_HI = 1.04;
/** The holder can't hold it forever: a hold this long kicks it anyway (the release is taken here). */
export const MAX_HOLD_MS = 2600;
/** Aim range, rad: the uprights are ±0.08 rad from 40 yd; a punt can go for the corner (a coffin-corner punt leaves at ~30°). */
export const AIM_MAX: Record<KickKind, number> = { PAT: 0.2, FG: 0.2, PUNT: 0.6 };
/** Aim speed from the keys or the D-pad, rad/s (a tap of ~0.1 s moves it ~0.01 rad, a third of a yard at 33 yd). */
export const AIM_RATE = 0.1;

/**
 * Per difficulty: a faster fill, a quicker and narrower window. Rookie's
 * window is 18% of the meter and turns every ~2.2 s; Beast's is 9% and
 * turns every ~1.3 s. (The kicker's leg is fixed per difficulty too: KICKER_RANGE.)
 */
export const METER: Record<Difficulty, MeterTuning> = {
  rookie: { fillMs: 1400, half: 0.09, hz: 0.45 },
  pro: { fillMs: 1300, half: 0.07, hz: 0.55 },
  legend: { fillMs: 1200, half: 0.055, hz: 0.65 },
  beast: { fillMs: 1100, half: 0.045, hz: 0.75 },
};

/** Power after a hold of `heldMs`. */
export function powerAt(heldMs: number, t: MeterTuning): number {
  return Math.min(METER_MAX, Math.max(0, heldMs / t.fillMs));
}

/** The window's center `sinceMs` after the kick came up (it starts at the bottom and rises). */
export function windowAt(sinceMs: number, t: MeterTuning): number {
  const mid = (WINDOW_LO + WINDOW_HI) / 2;
  const amp = (WINDOW_HI - WINDOW_LO) / 2;
  return mid - amp * Math.cos(2 * Math.PI * t.hz * (sinceMs / 1000));
}

export interface Strike {
  power: number;
  /** Aim error from the release, rad (+ = left: a hook; − = right: a push). */
  error: number;
  /** Where the fill was against the window, in meter units: 0 inside, − under it (early), + over it (late). */
  off: number;
  /** Inside the window. */
  clean: boolean;
  /** The hold that counted, ms (capped at MAX_HOLD_MS). */
  heldMs: number;
}

/**
 * The strike from the press and release (ms, one timebase: the events'),
 * and when the window started moving. Inside the window the error is tiny
 * (a hair off-center pulls a hair); outside it grows with the miss: 0.1 of
 * the meter out is ~0.07 rad, a kick that drifts ~3 yd by the posts from
 * 40 yd, where the uprights are 3.1 yd either side.
 */
export function strikeFrom(o: { pressAt: number; releaseAt: number; windowFrom: number; tuning: MeterTuning }): Strike {
  const heldMs = Math.min(MAX_HOLD_MS, Math.max(0, o.releaseAt - o.pressAt));
  const releaseAt = o.pressAt + heldMs;
  const power = powerAt(heldMs, o.tuning);
  const c = windowAt(releaseAt - o.windowFrom, o.tuning);
  const d = power - c;
  const half = o.tuning.half;
  if (Math.abs(d) <= half) return { power, error: (-d / half) * 0.008, off: 0, clean: true, heldMs };
  const off = d - Math.sign(d) * half;
  const error = -Math.sign(off) * Math.min(0.22, 0.025 + 0.45 * Math.abs(off));
  return { power, error, off, clean: false, heldMs };
}

/**
 * One kick's input, as a small state machine the kick screen feeds with the
 * input events (and each frame, for the display and the aim keys): aim,
 * press to charge, release to strike. The press and release are the
 * events' timestamps; frames only draw it and move the aim.
 */
export class KickControl {
  phase: 'aim' | 'charge' | 'struck' = 'aim';
  aim = 0;
  pressAt = 0;
  strike: Strike | null = null;

  constructor(
    readonly kind: KickKind,
    readonly tuning: MeterTuning,
    /** When the kick came up (the window starts moving), ms. */
    readonly windowFrom: number,
  ) {}

  /** Aim while it's still aiming: `dir` −1..1 (+ = left) for `dt` seconds; `rad` a direct nudge (the mouse). */
  steer(dir: number, dt: number, rad = 0): void {
    if (this.phase !== 'aim') return;
    const max = AIM_MAX[this.kind];
    this.aim = Math.max(-max, Math.min(max, this.aim + dir * AIM_RATE * dt + rad));
  }

  /** The charge button went down (its event's time). A press from before the kick came up doesn't count. */
  press(at: number): boolean {
    if (this.phase !== 'aim' || at < this.windowFrom) return false;
    this.phase = 'charge';
    this.pressAt = at;
    return true;
  }

  /** The charge button came up (its event's time): the strike. */
  release(at: number): Strike | null {
    if (this.phase !== 'charge') return null;
    this.phase = 'struck';
    this.strike = strikeFrom({ pressAt: this.pressAt, releaseAt: at, windowFrom: this.windowFrom, tuning: this.tuning });
    return this.strike;
  }

  /** A frame at `now`: a hold past MAX_HOLD_MS kicks it (at the cap, not at this frame). */
  frame(now: number): Strike | null {
    if (this.phase === 'charge' && now - this.pressAt >= MAX_HOLD_MS) return this.release(this.pressAt + MAX_HOLD_MS);
    return null;
  }

  /** What the meter shows at `now`: the fill and the window's center. */
  meter(now: number): { fill: number; window: number } {
    const struck = this.phase === 'struck' && this.strike;
    const fill = this.phase === 'charge' ? powerAt(now - this.pressAt, this.tuning) : struck ? struck.power : 0;
    const at = struck ? this.pressAt + struck.heldMs : now;
    return { fill, window: windowAt(at - this.windowFrom, this.tuning) };
  }
}

/** The word for a strike ("Pure", "Hooked", "Pushed"). */
export function strikeWord(s: Strike): string {
  if (s.clean) return s.power > 1 ? 'Overcooked' : 'Pure';
  return s.off < 0 ? 'Hooked' : 'Pushed';
}
