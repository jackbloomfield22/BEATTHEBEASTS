// Touchdown celebrations (M7, Playtest 1 #7): on a user touchdown, a
// three-choice prompt (1/2/3 or A/B/X) of authored celebrations drawn from
// a pool of twelve (tools/blender/lib/actions_m7_cel.py; none copies a
// named dance). Nothing pressed in about two seconds and the first (the one
// that fits the scorer best) plays by itself. The scorer plays it in the end
// zone, team-mates run over and react (render/game/celebrate.ts), the camera
// goes low and tight and the crowd comes up; then the result card, and the
// automatic replay after it.
//
// Render-only: it starts after the whistle and never touches the sim (the
// determinism golden is unchanged). The choices are seeded by the play, so
// the same play offers the same three. React reads a small store that
// changes only when the phase does.

import { create } from 'zustand';
import { Input } from '@/input/InputManager';
import type { PlayState, SimPlayer } from '@/sim';

export type CelebId = 'spike' | 'spinSpike' | 'flip' | 'point' | 'leap' | 'flex' | 'salute' | 'kneel' | 'ballHigh' | 'chestBump' | 'jumpFist' | 'shrug';

/** Who scored, for what fits him: a receiver, a back, a quarterback, a big man (a lineman, or anyone 280 lb and up). */
export type ScorerRole = 'receiver' | 'back' | 'qb' | 'big';

export interface Celebration {
  id: CelebId;
  /** The clip (anims.json). */
  clip: string;
  /** The word on the prompt. */
  label: string;
  /** What happens to the ball: kept in the right hand, let go at the clip's `release` event, or moved to the left hand at `left`. */
  ball: 'keep' | 'release' | 'left';
  /** Where he turns before it plays: the nearest official, the stands behind the end line, a team-mate, or as he is. */
  face: 'official' | 'stands' | 'mate' | 'self';
  /** Needs a team-mate close enough to come over (the chest bump). */
  mate?: boolean;
  /** How well it fits each kind of scorer (relative weights; 0 never offered to him). */
  fits: Record<ScorerRole, number>;
}

/**
 * The pool. The fits are a coach's eye, not data: a receiver plays to the
 * crowd (the point, the leap, the walk with it held high), a back spikes it
 * and pumps a fist, a lineman who rumbled in flexes, bumps chests or shrugs
 * it off; everyone can kneel, salute or flip it to the official.
 */
export const CELEBRATIONS: Celebration[] = [
  { id: 'spike', clip: 'cel_spike', label: 'Spike', ball: 'release', face: 'self', fits: { receiver: 2, back: 4, qb: 2, big: 3 } },
  { id: 'spinSpike', clip: 'cel_spin_spike', label: 'Spin and spike', ball: 'release', face: 'self', fits: { receiver: 3, back: 3, qb: 1, big: 1 } },
  { id: 'flip', clip: 'cel_flip_official', label: 'Hand it to the official', ball: 'release', face: 'official', fits: { receiver: 2, back: 3, qb: 3, big: 2 } },
  { id: 'point', clip: 'cel_point_crowd', label: 'Point to the crowd', ball: 'keep', face: 'stands', fits: { receiver: 4, back: 2, qb: 3, big: 1 } },
  { id: 'leap', clip: 'cel_leap_wall', label: 'Leap at the wall', ball: 'keep', face: 'stands', fits: { receiver: 4, back: 3, qb: 1, big: 1 } },
  { id: 'flex', clip: 'cel_flex', label: 'Flex', ball: 'release', face: 'self', fits: { receiver: 1, back: 3, qb: 1, big: 5 } },
  { id: 'salute', clip: 'cel_salute', label: 'Salute', ball: 'left', face: 'stands', fits: { receiver: 2, back: 2, qb: 2, big: 2 } },
  { id: 'kneel', clip: 'cel_kneel', label: 'Take a knee', ball: 'keep', face: 'self', fits: { receiver: 2, back: 2, qb: 3, big: 2 } },
  { id: 'ballHigh', clip: 'cel_ball_high', label: 'Ball held high', ball: 'keep', face: 'stands', fits: { receiver: 3, back: 2, qb: 3, big: 2 } },
  { id: 'chestBump', clip: 'cel_chest_bump', label: 'Chest bump', ball: 'keep', face: 'mate', mate: true, fits: { receiver: 2, back: 2, qb: 1, big: 4 } },
  { id: 'jumpFist', clip: 'cel_jump_fist', label: 'Jump and fist pump', ball: 'keep', face: 'self', fits: { receiver: 3, back: 4, qb: 3, big: 1 } },
  { id: 'shrug', clip: 'cel_shrug', label: 'Drop it and shrug', ball: 'release', face: 'self', fits: { receiver: 2, back: 1, qb: 1, big: 4 } },
];
export const CELEB_BY_ID = new Map(CELEBRATIONS.map((c) => [c.id, c]));

/** Who he is on the field (sim positions); anyone heavy enough is a big man whatever he lines up at. */
export function roleOf(p: Pick<SimPlayer, 'pos' | 'weightLb'>): ScorerRole {
  if (p.pos === 'OL' || p.pos === 'DT' || p.pos === 'DE' || p.weightLb >= 280) return 'big';
  if (p.pos === 'QB') return 'qb';
  if (p.pos === 'RB') return 'back';
  return 'receiver';
}

/** A small seeded stream (mulberry32): the pick is the play's, the same every time it's seen. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Three from the pool for this scorer, weighted by fit and drawn without
 * replacement from the play's seed, the best fit of the three first (it's
 * the one that plays if nothing is pressed). `recent` (what played on the
 * last scores) is down-weighted so a session doesn't see the same three
 * twice running; `mate`: a team-mate is close enough for a two-man one.
 */
export function pickChoices(seed: number, role: ScorerRole, mate: boolean, recent: CelebId[] = []): CelebId[] {
  const next = rng(seed ^ 0x5eed7d);
  const pool = CELEBRATIONS.filter((c) => c.fits[role] > 0 && (!c.mate || mate)).map((c) => ({ c, w: c.fits[role] * (recent.includes(c.id) ? 0.25 : 1) }));
  const out: Celebration[] = [];
  while (out.length < 3 && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = next() * total;
    let k = 0;
    while (k < pool.length - 1 && r >= pool[k]!.w) r -= pool[k++]!.w;
    out.push(pool.splice(k, 1)[0]!.c);
  }
  return out.sort((a, b) => b.fits[role] - a.fits[role]).map((c) => c.id);
}

/** The prompt comes up this long after the whistle (s): the ball has crossed, the official's arms are going up. */
export const PROMPT_AT = 0.5;
/** Nothing pressed for this long (s) and the first choice plays. */
export const CHOOSE_SECS = 2.0;
/** A team-mate this close (yd) at the whistle comes over. */
export const MATE_RANGE = 28;
/** At most this many come over. */
export const MATES = 2;

export type CelebPhase = 'off' | 'choose' | 'play' | 'done';

export interface CelebUi {
  phase: CelebPhase;
  /** The three on offer (ids into CELEBRATIONS). */
  choices: CelebId[];
  picked: CelebId | null;
  /** It played by itself (nothing pressed). */
  auto: boolean;
  /** The scorer's name, for the prompt. */
  scorer: string;
}

export const useCelebration = create<CelebUi>(() => ({ phase: 'off', choices: [], picked: null, auto: false, scorer: '' }));
const set = (p: Partial<CelebUi>) => useCelebration.setState(p);

/** The scorer's agent index and the team-mates coming over, for the scene (set when the prompt comes up). */
export interface CelebCast {
  play: number;
  scorer: number;
  mates: number[];
}

class CelebrationSession {
  cast: CelebCast | null = null;
  /** Seconds since the whistle (frame time; it holds while the game is paused). */
  t = 0;
  /** Seconds left to choose. */
  left = 0;
  private play = -1;
  private pop: (() => void) | null = null;
  private off: (() => void) | null = null;
  private recent: CelebId[] = [];

  /** The prompt or the celebration is on: the result card waits, and so does the automatic replay. */
  get busy(): boolean {
    const p = useCelebration.getState().phase;
    return p === 'choose' || p === 'play';
  }

  /**
   * Every frame of the play screens (GameScene, not during a replay): sees a
   * user touchdown's whistle, brings the prompt up, counts the choice down.
   * `paused`: the game's pause menu is up (the clock holds).
   */
  frame(s: PlayState | null, playId: number, dt: number, paused: boolean): void {
    if (playId !== this.play) this.reset(playId);
    if (!s) return;
    const r = s.result;
    if (!r || !r.touchdown || !r.offenseBall || !s.setup.user) return;
    if (paused) return;
    this.t += dt;
    const ui = useCelebration.getState();
    if (ui.phase === 'off' && this.t >= PROMPT_AT && !this.cast) this.open(s, playId);
    else if (ui.phase === 'choose') {
      this.left -= dt;
      if (this.left <= 0) this.choose(0, true);
    }
  }

  private open(s: PlayState, playId: number): void {
    const scorer = s.carrier >= 0 ? s.carrier : s.ball.holder;
    if (scorer < 0 || s.agents[scorer]!.side !== 'off') return;
    const a = s.agents[scorer]!;
    const mates = s.off
      .filter((i) => i !== scorer && !s.agents[i]!.down)
      .map((i) => ({ i, d: Math.hypot(s.agents[i]!.pos.x - a.pos.x, s.agents[i]!.pos.y - a.pos.y) }))
      .filter((m) => m.d < MATE_RANGE)
      .sort((x, y) => x.d - y.d || x.i - y.i)
      .slice(0, MATES)
      .map((m) => m.i);
    this.cast = { play: playId, scorer, mates };
    const choices = pickChoices((s.setup.seed >>> 0) ^ Math.imul(scorer + 1, 0x9e3779b1), roleOf(a.p), mates.length > 0, this.recent);
    this.left = CHOOSE_SECS;
    this.pop?.();
    this.pop = Input.pushContext('celebrate');
    this.off?.();
    this.off = Input.onAction((id, info) => {
      if (info.repeat) return;
      const n = id === 'celebrate.pick1' ? 0 : id === 'celebrate.pick2' ? 1 : id === 'celebrate.pick3' ? 2 : -1;
      if (n >= 0 && useCelebration.getState().phase === 'choose') this.choose(n, false);
      else if (id === 'celebrate.skip') this.skip();
    });
    set({ phase: 'choose', choices, picked: null, auto: false, scorer: a.p.name });
  }

  /** Pick the n-th choice (a key, a click, or the clock running out). */
  choose(n: number, auto: boolean): void {
    const ui = useCelebration.getState();
    const id = ui.choices[n];
    if (ui.phase !== 'choose' || !id) return;
    this.recent = [id, ...this.recent.filter((r) => r !== id)].slice(0, 3);
    set({ phase: 'play', picked: id, auto });
  }

  /** Skip it (the prompt, or the celebration under way): straight to the result card. */
  skip(): void {
    if (!this.busy) return;
    this.finish();
  }

  /** The scene has played it out. */
  finish(): void {
    this.release();
    if (useCelebration.getState().phase !== 'off') set({ phase: 'done' });
  }

  private release(): void {
    this.pop?.();
    this.pop = null;
    this.off?.();
    this.off = null;
  }

  /** A new play (or leaving the screen): nothing on. */
  reset(playId = -1): void {
    this.release();
    this.play = playId;
    this.cast = null;
    this.t = 0;
    this.left = 0;
    if (useCelebration.getState().phase !== 'off') set({ phase: 'off', choices: [], picked: null, auto: false, scorer: '' });
  }
}

export const celebration = new CelebrationSession();

if (import.meta.env.DEV) Object.assign(globalThis, { __btbCeleb: celebration, __btbCelebUi: useCelebration });
