// Stamina through a drive (Playtest 1 #2 with hold-to-sprint: "sprint drains
// stamina"; the traits that wait on it: Workhorse, Change of Pace, Volume
// Passer). Two parts per player, keyed by player (the depth chart rotates
// men through a slot):
// - fresh: what a play took out of his legs (the stamina he spent, a big
//   hit's toll). Most of it comes back in the huddle: he starts the next
//   snap with KEEP_FAST of it still in him, less for a high Stamina rating.
// - load: the drive's work, a toll per carry (and per drop-back for a QB),
//   that only fades slowly (LOAD_KEEP a play) until the series ends.
// The next snap starts him at 1 − (fresh + load) stamina (createPlay's
// fatigue), which lowers his top speed (movement.ts: 0.86 + 0.14·stamina)
// and how much sprint and burst he has. A new drive resets both: the
// sideline is the rest. Pure: the game layer holds it between snaps.
//
// The Beasts' front (their linemen and linebackers) wears the same way on
// your drives: what a play took out of them, and a toll on every designed
// run (they take on the blocks). A Ground and Pound line's runs drain them
// 10% more (the trait catalog's line), so a long drive on the ground leaves
// their front a step slower than the same drive behind another line.

import { holds, type PlayState } from '@/sim';

export interface DriveFatigue {
  fresh: Record<string, number>;
  load: Record<string, number>;
  /** Touches (carries and catches) this drive, for Change of Pace's fresh legs. */
  touches: Record<string, number>;
}

/** One offensive player's snap, as the fatigue needs it. */
export interface Snap {
  id: string;
  /** Stamina at the snap and at the whistle (0–1). */
  start: number;
  end: number;
  /** His Stamina rating, 0–1. */
  staminaAttr: number;
  /** He had the ball as a runner (a carry, a catch, a scramble). */
  touched: boolean;
  /** He was the quarterback on a drop-back. */
  dropback: boolean;
  traits: readonly string[];
  /** A big hit's toll on him (0 if none). */
  hit: number;
  /** A Beasts front defender (a lineman or linebacker) on a designed run: he took on its blocks. */
  front?: boolean;
  /** The run came behind a Ground and Pound line: everything the snap took from him is 10% more. */
  groundPound?: boolean;
}

export const emptyFatigue = (): DriveFatigue => ({ fresh: {}, load: {}, touches: {} });

/**
 * Of a play's exertion, the share still in his legs at the next snap: a
 * 30–40 s huddle is about one phosphocreatine recovery half-time (~30 s), so
 * roughly half for an average player, a third for a 99 Stamina, 0.55 for a 0.
 */
const keepFast = (staminaAttr: number) => 0.55 - 0.22 * staminaAttr;
/** The drive's load fades this much a play (the work of a long drive stays in him). */
const LOAD_KEEP = 0.92;
/** A carry's toll on the drive (contact, the cuts): ten carries in a drive put ~0.2 on him (top speed −3%, less sprint). */
const CARRY_TOLL = 0.03;
/** A drop-back's toll on the QB (setting, the hits he takes). */
const DROPBACK_TOLL = 0.008;
/** The most a player starts a snap without. */
const MAX = 0.6;
/** A designed run's toll on a front defender (taking on a block or a double team): half a carry's. Ours. */
const FRONT_TOLL = 0.015;
/** Ground and Pound: the Beasts' front's stamina drain against the run +10% (the trait catalog's line). */
const GROUND_AND_POUND = 1.1;

const has = (s: Snap, id: string) => s.traits.includes(id);

/** The fatigue after a snap (`newDrive`: the series ended, so everyone starts fresh). */
export function afterSnap(f: DriveFatigue, snaps: readonly Snap[], newDrive: boolean): DriveFatigue {
  if (newDrive) return emptyFatigue();
  const out: DriveFatigue = { fresh: {}, load: {}, touches: { ...f.touches } };
  for (const [id, v] of Object.entries(f.load)) if (v * LOAD_KEEP > 0.005) out.load[id] = v * LOAD_KEEP;
  for (const s of snaps) {
    const gp = s.groundPound ? GROUND_AND_POUND : 1;
    const used = Math.max(0, s.start - s.end) * gp;
    const fresh = ((f.fresh[s.id] ?? 0) + used) * keepFast(s.staminaAttr) + s.hit;
    if (fresh > 0.005) out.fresh[s.id] = fresh;
    let toll = 0;
    if (s.touched) {
      const n = (out.touches[s.id] = (out.touches[s.id] ?? 0) + 1);
      // Workhorse: a carry's drain halved. Change of Pace: fresh legs his first two touches, then it costs him half again.
      toll += CARRY_TOLL * (has(s, 'workhorse') ? 0.5 : 1) * (has(s, 'committee-back') && n > 2 ? 1.5 : 1);
    }
    // Volume Passer: no stamina drop late in drives.
    if (s.dropback && !has(s, 'volume-passer')) toll += DROPBACK_TOLL;
    if (s.front) toll += FRONT_TOLL * gp;
    if (toll > 0) out.load[s.id] = (out.load[s.id] ?? 0) + toll;
  }
  return out;
}

/** What he starts the next snap without (createPlay's fatigue for his slot). */
export const fatigueOf = (f: DriveFatigue, id: string): number => Math.min(MAX, (f.fresh[id] ?? 0) + (f.load[id] ?? 0));

/** Change of Pace: a back on one of his first two touches of the drive has fresh legs (+3% top speed). */
export const freshLegs = (f: DriveFatigue, id: string, traits: readonly string[]): boolean => traits.includes('committee-back') && (f.touches[id] ?? 0) < 2;

/** The Beasts' front on a snap (their linemen and linebackers on a designed run), for afterSnap: the drain a Ground and Pound line adds. */
export function defenseSnaps(st: PlayState): Snap[] {
  const run = !!st.setup.play.run;
  const gp = run && st.off.some((i) => holds(st.agents[i]!.p, 'ground-and-pound'));
  return st.def.map((i) => {
    const a = st.agents[i]!;
    return {
      id: a.p.id,
      start: Math.max(0.2, 1 - (st.setup.fatigue?.[a.slot] ?? 0)),
      end: a.stamina,
      staminaAttr: a.fx.a('stamina'),
      touched: false,
      dropback: false,
      traits: a.p.traits ?? [],
      hit: 0,
      front: run && FRONT.includes(a.p.pos),
      groundPound: gp,
    };
  });
}
const FRONT = ['DE', 'DT', 'LB'];
