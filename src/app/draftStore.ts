import { create } from 'zustand';
import ratingsUrl from '@data/ratings/ratings.v1.json?url';
import jerseysUrl from '@data/augment/jerseys.json?url';
import honorsUrl from '@data/augment/honors.json?url';
import { SLOT_ORDER } from '@data/legacy/constants';
import type { Slot } from '@data/legacy/types';
import { makeRng, seedFromDate } from '@/engine/rng';
import {
  autoDraft,
  candidates,
  createDraft,
  draftPick,
  isComplete,
  makeCatalog,
  roundOf,
  skipEra,
  skipTeam,
  spin,
  type Candidate,
  type Catalog,
  type DraftMode,
  type DraftPick,
  type DraftState,
  type Pair,
  type Roster,
} from '@/game/draft';
import { assembleRatedBeasts, type RatedBeasts } from '@/game/beasts';
import { newDaily, type NewDaily } from '@/game/daily';
import { loadJSON, saveJSON } from './storage';
import type { Screen } from './appStore';
import { getSettings } from './settings';
import { game } from '@/game/game';

// The draft session the locker room and its UI share (M6). The rules live in
// src/game/draft.ts (pure); this store holds the live draft, the Beasts it
// is drafted against, and the room's beats (a spin, a pick dressing a
// locker, the walk-out), and keeps the finished roster for the Locker Room
// entry and the game.

export type DraftPhase = 'loading' | 'intro' | 'spinning' | 'choosing' | 'dressing' | 'ready' | 'complete' | 'walkout' | 'viewing';

/** Reels: ~2.4 s (the team reel stops at 82% of it, the decade reel at the end). */
export const SPIN_S = 2.4;
/** From a pick to the locker dressed (camera move + dressing). */
export const DRESS_S = 3.6;
/**
 * Auto-Draft's reveal (GDD §2: Quick Play is an auto-draft with a short
 * reveal): the stalls it filled dress one after another down the row, not
 * all at once. REVEAL_LEAD before the first, REVEAL_STAGGER between them;
 * each dressing takes ~2.9 s (locker.ts DRESS_END).
 */
export const REVEAL_LEAD = 0.6;
export const REVEAL_STAGGER = 0.35;
/** Seconds from an Auto-Draft of `n` stalls until the last one is dressed, plus a beat to look at the row. */
export const revealSeconds = (n: number): number => (n ? REVEAL_LEAD + (n - 1) * REVEAL_STAGGER + 2.9 + 0.9 : 0);

export interface SavedDraft {
  mode: DraftMode;
  seed: number;
  dailyKey: string | null;
  roster: Roster;
  sequence: Pair[];
  finishedAt: number;
}

interface DraftStore {
  cat: Catalog | null;
  allPro: Record<string, number>;
  mode: DraftMode;
  draft: DraftState | null;
  /** Bumped on every change to `draft` (it's mutated in place by the pure helpers). */
  version: number;
  beasts: RatedBeasts | null;
  daily: NewDaily | null;
  phase: DraftPhase;
  /** The stall the camera is on (null: the whole row). */
  focus: Slot | null;
  /** The last pick, for the dressing beat (seq increments per pick). */
  lastPick: { pick: DraftPick; seq: number } | null;
  /** Instant dressings (a restored room): no per-locker animation. */
  instantSeq: number;
  /** Auto-Draft's reveal: the stalls it filled, dressed in turn (seq increments per Auto-Draft). */
  reveal: { seq: number; slots: Slot[] };
  /** The wall shows the Beasts (page 0 = all, 1..3 = front, backers, secondary) or the draft. */
  wallBeasts: number | null;
  saved: SavedDraft | null;
  /** A draft is being set up (the catalog is loading). */
  starting: boolean;
  load(): Promise<Catalog>;
  begin(mode: DraftMode, opts?: { seed?: number; dailyKey?: string }): Promise<void>;
  spin(): Pair | null;
  skipTeam(): boolean;
  skipEra(): boolean;
  pick(c: Candidate): DraftPick | null;
  auto(): DraftPick[];
  setPhase(p: DraftPhase): void;
  setFocus(s: Slot | null): void;
  setWallBeasts(p: number | null): void;
  /** Open the Locker Room on the saved roster (no draft running). */
  view(): Promise<boolean>;
  offers(): Partial<Record<string, Candidate[]>>;
  /** Where the walk-out leads (the game; Practice Field until the game screen exists). */
  next: Screen;
  finishWalkout(go: (s: Screen) => void): void;
}

let loading: Promise<Catalog> | null = null;
let beginToken = 0;

export const useDraft = create<DraftStore>((set, get) => ({
  cat: null,
  allPro: {},
  mode: 'classic',
  draft: null,
  version: 0,
  beasts: null,
  daily: null,
  phase: 'loading',
  focus: null,
  lastPick: null,
  instantSeq: 0,
  reveal: { seq: 0, slots: [] },
  wallBeasts: null,
  starting: false,
  saved: loadJSON<SavedDraft>('lastDraft') ?? null,

  load() {
    loading ??= Promise.all([fetch(ratingsUrl).then((r) => r.json()), fetch(jerseysUrl).then((r) => r.json()), fetch(honorsUrl).then((r) => r.json())]).then(([snap, jer, hon]) => {
      const cat = makeCatalog(snap, jer.numbers);
      set({ cat, allPro: hon.allPro });
      return cat;
    });
    return loading;
  },

  async begin(mode, opts = {}) {
    // The latest begin wins: an earlier one still loading the catalog gives up.
    const token = ++beginToken;
    set({ phase: 'loading', mode, draft: null, lastPick: null, focus: null, starting: true });
    const cat = await get().load();
    if (token !== beginToken) return;
    const dailyKey = mode === 'daily' ? (opts.dailyKey ?? todayIso()) : undefined;
    const seed = opts.seed ?? (dailyKey ? seedFromDate(dailyKey) : (Date.now() ^ 0x5bd1e995) >>> 0);
    const draft = createDraft(mode, seed, dailyKey);
    const ovrOf = (id: string) => cat.entry.get(id)?.ovr;
    let daily: NewDaily | null = null;
    let beasts: RatedBeasts;
    if (dailyKey) {
      daily = newDaily(dailyKey, cat);
      beasts = daily.beasts;
    } else beasts = assembleRatedBeasts(makeRng(seed ^ 0x9e3779b9), ovrOf);
    set((s) => ({ draft, daily, beasts, phase: 'intro', version: s.version + 1, instantSeq: s.instantSeq + 1, wallBeasts: 0, starting: false }));
    if (mode === 'quick') {
      get().auto();
    }
  },

  spin() {
    const { cat, draft } = get();
    if (!cat || !draft || isComplete(draft)) return null;
    const p = spin(cat, draft);
    set((s) => ({ version: s.version + 1, phase: 'spinning', focus: null, wallBeasts: null }));
    return p;
  },
  skipTeam() {
    const { cat, draft } = get();
    if (!cat || !draft) return false;
    const ok = skipTeam(cat, draft);
    if (ok) set((s) => ({ version: s.version + 1, phase: 'spinning' }));
    return ok;
  },
  skipEra() {
    const { cat, draft } = get();
    if (!cat || !draft) return false;
    const ok = skipEra(cat, draft);
    if (ok) set((s) => ({ version: s.version + 1, phase: 'spinning' }));
    return ok;
  },
  pick(c) {
    const { cat, draft } = get();
    if (!cat || !draft) return null;
    const p = draftPick(cat, draft, c);
    if (!p) return null;
    set((s) => ({ version: s.version + 1, phase: 'dressing', focus: p.slot, lastPick: { pick: p, seq: (s.lastPick?.seq ?? 0) + 1 } }));
    if (isComplete(draft)) save(draft);
    return p;
  },
  auto() {
    const { cat, draft } = get();
    if (!cat || !draft) return [];
    const picks = autoDraft(cat, draft);
    set((s) => ({ version: s.version + 1, reveal: { seq: s.reveal.seq + 1, slots: picks.map((p) => p.slot) }, phase: isComplete(draft) ? 'complete' : s.phase, focus: null }));
    if (isComplete(draft)) save(draft);
    return picks;
  },
  setPhase: (phase) => set({ phase }),
  setFocus: (focus) => set({ focus }),
  setWallBeasts: (wallBeasts) => set({ wallBeasts }),
  async view() {
    const saved = get().saved;
    if (!saved) return false;
    const cat = await get().load();
    const draft = createDraft(saved.mode, saved.seed, saved.dailyKey ?? undefined);
    draft.roster = saved.roster;
    draft.sequence = saved.sequence;
    const daily = saved.dailyKey ? newDaily(saved.dailyKey, cat) : null;
    const beasts = daily ? daily.beasts : assembleRatedBeasts(makeRng(saved.seed ^ 0x9e3779b9), (id) => cat.entry.get(id)?.ovr);
    set((s) => ({ draft, daily, beasts, mode: saved.mode, phase: 'viewing', focus: null, version: s.version + 1, instantSeq: s.instantSeq + 1, wallBeasts: 0 }));
    return true;
  },
  next: 'game',
  finishWalkout(go) {
    set({ phase: 'complete' });
    if (get().next === 'game') startGame();
    go(get().next);
  },
  offers() {
    const { cat, draft } = get();
    if (!cat || !draft || !draft.pair) return {};
    return candidates(cat, draft);
  },
}));

if (import.meta.env.DEV) Object.assign(globalThis, { __btbDraft: useDraft });

function save(d: DraftState): void {
  const saved: SavedDraft = { mode: d.mode, seed: d.seed, dailyKey: d.daily?.dateKey ?? null, roster: d.roster, sequence: d.sequence, finishedAt: Date.now() };
  saveJSON('lastDraft', saved);
  useDraft.setState({ saved });
}

/** Kick off a game with the drafted roster (the walk-out's end). */
export function startGame(): void {
  const st = useDraft.getState();
  if (!st.cat || !st.draft || !st.beasts || !isComplete(st.draft)) return;
  const g = getSettings().gameplay;
  const lighting = g.lighting;
  void game.start({
    cat: st.cat,
    roster: st.draft.roster,
    beasts: st.beasts,
    mode: st.mode,
    drives: g.gameLength,
    seed: (st.draft.seed ^ 0x6a09e667) >>> 0,
    diffAdj: st.daily?.diffAdj ?? 0,
    difficulty: g.difficulty,
    daily: st.daily,
    // Rain and snow blow harder (the legacy WindChip's weather bump).
    windScale: lighting === 'rain' || lighting === 'snow' ? 1.4 : 1,
  });
}

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** Picks in draft order (for the room: which stalls are dressed). */
export function dressedSlots(r: Roster): Slot[] {
  return SLOT_ORDER.filter((k) => r[k]);
}

export { roundOf, isComplete };
