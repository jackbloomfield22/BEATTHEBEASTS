// Input latency (M5.5): the time from a key press (the browser's event
// timestamp) to the first rendered frame that shows the response, per kind
// of input. Frames are counted too, so a run on a fixed 60 Hz frame clock
// (the test harness) reads directly as latency on hardware that holds 60 fps.
// The perf screen (`?perf`, backquote) shows the running figures.
//
// A response is "visible" when the frame shows it:
//   snap          the get-offs and the QB's drop start
//   move          the controlled player's velocity has changed by 0.3 yd/s
//                 since the press, and not away from the pressed direction:
//                 speeding up toward it, or a carrier at full speed planting
//                 into a hard cut toward it (the brake is the first thing you
//                 see; the turn itself builds over a few more frames)
//   throwHold     the power ring is up on the held icon
//   throwRelease  the QB's throw motion starts (key up to motion)
//   catch         the called catch lights up in the panel
//   juke, spin, stiffArm, truck, dive   the move's clip starts
//   protect       the ball goes to the two-hand hold
// Moves pressed while the last one still commits the carrier are buffered
// on purpose; their samples are marked so they can be read apart.

import type { V2 } from '@/sim/vec';

export type LatKind = 'snap' | 'move' | 'throwHold' | 'throwRelease' | 'catch' | 'juke' | 'spin' | 'stiffArm' | 'truck' | 'dive' | 'protect';

export interface LatSample {
  kind: LatKind;
  ms: number;
  frames: number;
  /** Pressed while the carrier was still committed to his last move (a buffered press). */
  buffered?: boolean;
}

interface Pending {
  t: number;
  frame: number;
  dir?: V2;
  base: number;
  /** The velocity at the press (move). */
  v0?: V2;
  buffered?: boolean;
}

/** Frames a motion response may take before the press is dropped (it never showed: already at top speed, a wall). */
const MOTION_WINDOW = 45;
/** Change of velocity (not away from the pressed direction) that counts as a visible response (yd/s). */
const MOVE_DELTA = 0.3;
const KEEP = 400;

class LatencyLog {
  /** Rendered frames so far (the game scene counts them). */
  frame = 0;
  readonly samples: LatSample[] = [];
  private pending = new Map<LatKind, Pending>();
  /** The controlled player's rendered velocity last frame (field yd/s), for motion baselines. */
  private vel: V2 = { x: 0, y: 0 };

  press(kind: LatKind, t: number, opts: { dir?: V2; buffered?: boolean } = {}): void {
    if (this.pending.has(kind)) return;
    const base = opts.dir ? this.vel.x * opts.dir.x + this.vel.y * opts.dir.y : 0;
    this.pending.set(kind, { t, frame: this.frame, base, v0: { ...this.vel }, ...opts });
  }

  respond(kind: LatKind, now = performance.now()): void {
    const p = this.pending.get(kind);
    if (!p) return;
    this.pending.delete(kind);
    this.samples.push({ kind, ms: Math.max(0, now - p.t), frames: Math.max(1, this.frame - p.frame), buffered: p.buffered });
    if (this.samples.length > KEEP) this.samples.shift();
  }

  cancel(kind: LatKind): void {
    this.pending.delete(kind);
  }

  /** Once per rendered frame: the controlled player's velocity, which answers move presses. */
  motion(v: V2 | null, now = performance.now()): void {
    if (v) {
      const p = this.pending.get('move');
      if (p) {
        const dx = v.x - (p.v0?.x ?? 0);
        const dy = v.y - (p.v0?.y ?? 0);
        const toward = p.dir ? dx * p.dir.x + dy * p.dir.y : 0;
        if (toward >= -1e-6 && Math.sqrt(dx * dx + dy * dy) >= MOVE_DELTA) this.respond('move', now);
        else if (this.frame - p.frame > MOTION_WINDOW) this.cancel('move');
      }
      this.vel = { x: v.x, y: v.y };
    }
  }

  clear(): void {
    this.samples.length = 0;
    this.pending.clear();
  }

  /** Per kind: count, median and 95th percentile (ms and frames), buffered presses left out. */
  summary(): { kind: LatKind; n: number; p50: number; p95: number; f50: number; f95: number }[] {
    const kinds = [...new Set(this.samples.map((s) => s.kind))];
    const q = (a: number[], p: number) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0;
    return kinds.map((kind) => {
      const ss = this.samples.filter((s) => s.kind === kind && !s.buffered);
      return { kind, n: ss.length, p50: q(ss.map((s) => s.ms), 0.5), p95: q(ss.map((s) => s.ms), 0.95), f50: q(ss.map((s) => s.frames), 0.5), f95: q(ss.map((s) => s.frames), 0.95) };
    });
  }
}

export const latency = new LatencyLog();
if (typeof window !== 'undefined') (window as unknown as { __btbLatency: LatencyLog }).__btbLatency = latency;
