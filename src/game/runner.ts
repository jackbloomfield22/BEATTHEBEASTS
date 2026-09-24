// The fixed-step driver (TECH_PLAN §4.3): an accumulator advances the sim in
// 1/60 s ticks, at most five per frame, and keeps the previous and current
// render snapshots for interpolation. Every tick's InputFrame is recorded, so
// a play replays exactly from its seed and the recording.

import { stepPlay, TICK, type InputFrame, type PlayState, type SimEvent } from '@/sim';
import { hashPlay } from '@/sim/hash';
import { capture, copySnapshot, emptySnapshot, type Snapshot } from './snapshot';

const MAX_STEPS = 5;

export class SimRunner {
  readonly prev: Snapshot;
  readonly cur: Snapshot;
  readonly frames: InputFrame[] = [];
  private acc = 0;
  private eventCursor = 0;
  /** Sim seconds per real second (slow motion scales this, never the tick). */
  timeScale = 1;
  /** Frozen (paused): the render keeps drawing the last snapshot. */
  paused = false;

  constructor(readonly state: PlayState) {
    this.prev = capture(state, emptySnapshot(state.agents.length));
    this.cur = capture(state, emptySnapshot(state.agents.length));
  }

  /** Advance by a frame's real time. Returns the number of ticks stepped. */
  advance(dt: number, sample: (s: PlayState) => InputFrame): number {
    if (this.paused) return 0;
    this.acc += Math.min(dt, 0.25) * this.timeScale;
    let n = 0;
    while (this.acc >= TICK && n < MAX_STEPS) {
      this.acc -= TICK;
      this.step(sample(this.state));
      n++;
    }
    // Too far behind (a hitch, a background tab): drop the backlog rather than spiral.
    if (n === MAX_STEPS) this.acc = Math.min(this.acc, TICK);
    return n;
  }

  step(inp: InputFrame): void {
    copySnapshot(this.cur, this.prev);
    stepPlay(this.state, inp);
    this.frames.push(inp);
    capture(this.state, this.cur);
  }

  /** Interpolation factor between prev and cur. */
  get alpha(): number {
    return Math.min(1, this.acc / TICK);
  }

  /** Events since the last call (camera shake, audio, HUD). */
  drainEvents(): SimEvent[] {
    const ev = this.state.events;
    const out = ev.slice(this.eventCursor);
    this.eventCursor = ev.length;
    return out;
  }

  hash(): number {
    return hashPlay(this.state);
  }
}
