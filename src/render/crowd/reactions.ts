// Crowd reactions: game events push the crowd's energy up, and it settles
// back toward the ambient level. The crowd shader reads the energy (how many
// stand, how many cheer with arms up or clap), so a touchdown reads as the
// bowl rising. Pure and time-driven (callers pass the clock), so the envelope
// is unit-tested and replays identically.

import { urlFlags } from '@/app/platform';

export type CrowdEvent = 'bigPlay' | 'touchdown' | 'turnover' | 'defensiveStop' | 'kickoff' | 'groan';

/** Peak energy each event lifts the crowd to, and how long it holds before decaying (s). */
export const REACTIONS: Record<CrowdEvent, { peak: number; hold: number; decay: number }> = {
  touchdown: { peak: 1, hold: 4, decay: 6 },
  turnover: { peak: 0.9, hold: 3, decay: 5 },
  bigPlay: { peak: 0.75, hold: 1.5, decay: 4 },
  defensiveStop: { peak: 0.65, hold: 1.2, decay: 3.5 },
  kickoff: { peak: 0.6, hold: 2, decay: 3 },
  // A groan sits the crowd down: energy below ambient.
  groan: { peak: 0.08, hold: 1.5, decay: 3 },
};

export class CrowdEnergy {
  private start = -Infinity;
  private ev: CrowdEvent | null = null;

  constructor(public ambient = 0.3) {}

  trigger(ev: CrowdEvent, now: number): void {
    this.ev = ev;
    this.start = now;
  }

  /** Energy in [0, 1] at time `now` (s). */
  value(now: number): number {
    if (!this.ev) return this.ambient;
    const r = REACTIONS[this.ev];
    const t = now - this.start;
    if (t < 0) return this.ambient;
    // Rise over 0.4 s (a crowd reacts within a beat), hold, then ease back.
    const rise = Math.min(1, t / 0.4);
    const fall = t <= r.hold ? 1 : Math.max(0, 1 - (t - r.hold) / r.decay);
    const k = rise * fall * fall * (3 - 2 * fall);
    return this.ambient + (r.peak - this.ambient) * k;
  }
}

/** The one crowd the World renders; game code and dev tools trigger it. */
export const crowdEnergy = new CrowdEnergy(urlFlags.crowd ?? 0.3);
