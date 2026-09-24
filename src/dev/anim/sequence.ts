import type { PlayerAnimator } from '@/anim/animator';

// The Lab's sequence mode: one play's worth of movement chained through the
// runtime animator, so the transitions are judged in context (M4.5):
// huddle → break → jog to the line → stop → set → stance → snap get-off →
// run → stop → stand. A tiny director steps through it; it only sets the
// animator's speed and asks for clips, the way the game will.

export const SEQUENCE_STANCES = ['ol_3pt', 'dl_3pt', 'dl_4pt', 'wr_2pt', 'lb_ready', 'db_ready', 'rb_2pt', 'qb_center', 'qb_gun'] as const;
export type SequenceStance = (typeof SEQUENCE_STANCES)[number];

const JOG = 3.5; // m/s: loco_jog's authored speed
const RUN = 5.8; // m/s: loco_run's (the get-offs hand over to it at phase 0)

type Step =
  | { kind: 'hold'; stance: string; dur: number; label: string }
  | { kind: 'play'; clip: string; after: number; label: string }
  | { kind: 'move'; speed: number; dur: number; label: string }
  | { kind: 'stop'; speed: number; label: string };

export function sequenceSteps(stance: SequenceStance, has: (clip: string) => boolean): Step[] {
  const steps: Step[] = [
    { kind: 'hold', stance: 'stance_huddle', dur: 1.2, label: 'huddle' },
    { kind: 'play', clip: 'huddle_break', after: 0, label: 'break' },
    { kind: 'move', speed: JOG, dur: 2.2, label: 'jog to the line' },
    { kind: 'stop', speed: JOG, label: 'stop' },
    { kind: 'play', clip: `set_${stance}`, after: 0, label: 'set' },
    { kind: 'hold', stance: `stance_${stance}`, dur: 1.2, label: 'stance' },
  ];
  // Quarterbacks take the snap rather than firing off; they just run.
  if (has(`getoff_${stance}`)) steps.push({ kind: 'play', clip: `getoff_${stance}`, after: RUN, label: 'snap' });
  steps.push({ kind: 'move', speed: RUN, dur: 1.6, label: 'run' }, { kind: 'stop', speed: RUN, label: 'stop' }, { kind: 'hold', stance: 'stance_idle', dur: 1.2, label: 'stand' });
  return steps;
}

export class SequenceDirector {
  private i = 0;
  private elapsed = 0;
  private started = false;
  /** The speed fed to the animator last step. */
  speed = 0;

  constructor(private steps: Step[]) {}

  get label(): string {
    return this.steps[this.i]?.label ?? '';
  }

  reset(): void {
    this.i = 0;
    this.elapsed = 0;
    this.started = false;
    this.speed = 0;
  }

  /** Advance the chain by dt, before the animator's update; returns the speed to feed it. */
  step(an: PlayerAnimator, dt: number): number {
    let st = this.steps[this.i]!;
    const next = () => {
      this.i = (this.i + 1) % this.steps.length;
      this.elapsed = 0;
      this.started = false;
      st = this.steps[this.i]!;
      if (this.i === 0) an.reset();
    };
    // A step that finished last update gives way to the next one now.
    if ((st.kind === 'play' || st.kind === 'stop') && this.started && !an.busy) next();
    if ((st.kind === 'hold' || st.kind === 'move') && this.elapsed >= st.dur) next();
    this.elapsed += dt;
    switch (st.kind) {
      case 'hold':
        an.setStance(st.stance);
        this.speed = 0;
        break;
      case 'move':
        this.speed = st.speed;
        break;
      case 'play':
        if (!this.started) {
          an.play(st.clip);
          this.started = true;
        }
        this.speed = st.after;
        break;
      case 'stop':
        if (!this.started) {
          an.play(an.stopFor(st.speed));
          this.started = true;
        }
        // Keep running until the stop takes over at the next left touch-down.
        this.speed = an.waiting ? st.speed : 0;
        break;
    }
    return this.speed;
  }
}
