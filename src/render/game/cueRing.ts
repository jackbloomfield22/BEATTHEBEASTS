// The throw-timing cue on a receiver icon (passing round 4,
// docs/passing/PASSING4.md). The sim says when the ball should be out of
// the QB's hand for this man (src/sim/cue.ts: his break, or the plant) and
// how long his QB's arm takes; this draws it, as one thin ring just outside
// the icon that stands for the last CUE_WIN seconds before the ball should
// be out:
//   - the gold segment at its end is this QB's release (Marino's is short,
//     a long-armed passer's half as long again), drawn from the snap on;
//   - the white fill sweeps round toward it; when it reaches the gold the
//     ring lights gold ("now"): a key pressed then puts the ball out as the
//     man comes out of his break;
//   - past the break it drains away over LATE_FADE: a ball thrown now is late.
// It reads the same with a keyboard, a pad or a mouse (it's a time, not a
// key), and it doesn't touch the football.

import { TICK, type PlayState } from '@/sim';
import { throwCue } from '@/sim/cue';
import { CUE_LEN, hudDom } from '@/ui/game/hudDom';

/** What the ring stands for (s before the ball should be out): long enough to see it coming from the top of the drop, short enough that the fill moves. Ours. */
const CUE_WIN = 1.2;
/** After the ball should have been out, how long the ring takes to drain away (s). Ours. */
const LATE_FADE = 0.5;
/** A press this soon after the mark still reads as on time (s): two frames of a player's thumb. Ours. */
const GRACE = 0.08;
/** Refresh the sim's cue every this many frames (it runs his route forward; between, the ring sweeps on the clock). */
const EVERY = 3;

type Cached = { play: number; ballOut: number; release: number } | null;
const cache: Cached[] = [null, null, null, null, null];

export type CueState = 'none' | 'fill' | 'now' | 'late';

/** The cue's state and the ring's fill (0..1) at sim time `now`, for a cue (pure; the unit tests read it). */
export function cueAt(ballOut: number, release: number, now: number): { state: CueState; fill: number } {
  const left = ballOut - now;
  if (left > release) return { state: 'fill', fill: Math.max(0, Math.min(1, 1 - left / CUE_WIN)) };
  if (left > -GRACE) return { state: 'now', fill: Math.max(0, Math.min(1, 1 - left / CUE_WIN)) };
  const late = -left - GRACE;
  if (late < LATE_FADE) return { state: 'late', fill: 1 - late / LATE_FADE };
  return { state: 'none', fill: 0 };
}

/**
 * Draw icon `k`'s cue for receiver `idx` (agent index) at sim time `now`.
 * `show` is false before the snap, after the throw and on a run.
 */
export function placeCue(k: number, el: HTMLElement, s: PlayState, idx: number, now: number, playId: number, frame: number, show: boolean): void {
  const fillEl = hudDom.cueFill[k];
  const relEl = hudDom.cueRel[k];
  let c = cache[k] ?? null;
  if (c && c.play !== playId) c = cache[k] = null;
  if (show && (!c || frame % EVERY === k % EVERY)) {
    const q = throwCue(s, s.agents[idx]!);
    // Past his break the sim has no cue to give: the ring keeps the last one through the break and after it.
    if (q) c = cache[k] = { play: playId, ballOut: q.ballOut, release: q.release };
  }
  const st = show && c ? cueAt(c.ballOut, c.release, now) : { state: 'none' as CueState, fill: 0 };
  if (el.dataset.cue !== st.state) el.dataset.cue = st.state;
  if (st.state === 'none' || !c || !fillEl || !relEl) return;
  fillEl.style.strokeDashoffset = (CUE_LEN * (1 - st.fill)).toFixed(1);
  const r = Math.min(1, c.release / CUE_WIN);
  relEl.style.strokeDasharray = `0 ${(CUE_LEN * (1 - r)).toFixed(1)} ${(CUE_LEN * r).toFixed(1)} ${CUE_LEN.toFixed(1)}`;
}

/** The sim time the HUD draws at (the frame's interpolated tick). */
export const hudTime = (t: number, alpha: number): number => t + alpha * TICK;
