// The Beasts' drive montage on screen (M7, Playtest 1 #4): the staged key
// play (montage.ts) played in the live stadium through the replay player,
// cut as a broadcast cuts a highlight package, about ten seconds:
//   1. establish  wide and high from the sideline: the Beasts set at the line;
//   2. play       the snap at the broadcast angle (the live camera's own
//                 logic), slowed through the moment on a score or a turnover;
//   3. reaction   tight and low on the man the play was about;
//   4. board      the video board over the north stands with the new score,
//                 the score bug updating and the drive's lower third.
// Cuts, never swoops (GameCamera snaps to each shot's first frame). The
// clock is the scene's frame step (real seconds; a recorded video's game
// time), never the wall clock, so a capture plays it exactly as a player
// sees it. Skippable at any moment (MontageHud: confirm or back; Start).
//
// React reads a small store that changes on each cut only.

import { create } from 'zustand';
import { Input } from '@/input/InputManager';
import { TICK } from '@/sim';
import type { BeastsDrive } from './match';
import { PRE_SNAP, staging, type MontageTeams, type StagedPlay } from './montage';
import { ReplayPlayer } from './replay';

/** 'search': the key play is being staged (a bumper is up; a few frames). */
export type ShotId = 'search' | 'establish' | 'play' | 'reaction' | 'board';

/** What the HUD says: the drive (the resolver's), the staged play, the score before and after, the game clock. */
export interface MontageInfo {
  drive: BeastsDrive;
  /** The staged play (null while it's being staged). */
  play: Pick<StagedPlay, 'kind' | 'label' | 'down' | 'toGo' | 'los' | 'yards'> | null;
  before: { user: number; beasts: number };
  after: { user: number; beasts: number };
  /** "Q2 7:41", "OT". */
  clock: string;
  /** Overtime period (0 in regulation). */
  ot: number;
}

export interface MontageUi {
  open: boolean;
  shot: ShotId | null;
  info: MontageInfo | null;
}

export const useMontage = create<MontageUi>(() => ({ open: false, shot: null, info: null }));

/** Real seconds each timed shot holds (the establishing and play shots run on the play's own beats). */
export const SHOT_SECS = { reaction: 1.8, board: 2.6 };
/** The establishing shot hands to the play this long before the snap (ticks: 0.6 s). */
const EST_LEAD = 36;
/** The window opens this long before the snap (ticks): the establishing shot's look at the offense set. */
const WINDOW = PRE_SNAP - 6;
/** Slow motion through a score or a turnover: down to SLOW over EASE ticks before the moment, held to HOLD after it, back up over EASE. */
const SLOWMO = { slow: 0.4, ease: 18, from: -10, hold: 22 };

const smooth = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};

/** The play's speed at `d` ticks from the moment (1 outside the slow motion). */
export function montageSpeed(d: number): number {
  const S = SLOWMO;
  if (d < S.from - S.ease || d > S.hold + S.ease) return 1;
  if (d < S.from) return 1 + (S.slow - 1) * smooth((d - (S.from - S.ease)) / S.ease);
  if (d <= S.hold) return S.slow;
  return S.slow + (1 - S.slow) * smooth((d - S.hold) / S.ease);
}

class MontageSession {
  player: ReplayPlayer | null = null;
  staged: StagedPlay | null = null;
  /** Set on every cut; the camera takes it (and snaps to the new shot). */
  cut = false;
  /** Cuts so far (a shot's camera keys its once-per-shot choices on it). */
  cutCount = 0;
  /** Seconds into the current shot. */
  shotT = 0;
  private playEnd = 0;
  private slow = false;
  private onDone: (() => void) | null = null;
  private onNone: (() => void) | null = null;
  private off: (() => void) | null = null;
  private search: Generator<void, StagedPlay | null, void> | null = null;
  private pending: MontageInfo | null = null;

  /** A montage is on screen (its play drawn). */
  get active(): boolean {
    return this.player !== null;
  }

  /** The key play is being staged, or the montage is on: the game waits on it. */
  get busy(): boolean {
    return this.player !== null || this.search !== null;
  }

  /** Most of a frame the search takes (ms): a try runs whole, so a frame can go over by one. */
  static readonly SLICE_MS = 6;

  /**
   * Stage a drive's key play over the next frames (montage.ts staging, a try
   * at a time), then play it. `onNone`: nothing fits (the Meanwhile card instead).
   */
  prepare(d: BeastsDrive, teams: MontageTeams, seed: number, round: number, ot: number, info: MontageInfo, onDone: () => void, onNone: () => void): void {
    this.abort();
    this.search = staging(d, teams, seed, round, ot);
    this.pending = info;
    this.onDone = onDone;
    this.onNone = onNone;
    this.off = Input.onAction((id, i) => {
      if (id === 'global.pause' && !i.repeat) this.skip();
    });
    useMontage.setState({ open: true, shot: 'search', info });
  }

  /** Run the search to its end now (the browser tests and the capture harness, whose frames are slow). */
  settle(): void {
    while (this.search) this.searchStep(Infinity);
  }

  private searchStep(budgetMs: number): void {
    const it = this.search!;
    const t0 = performance.now();
    for (;;) {
      const n = it.next();
      if (n.done) {
        this.search = null;
        const info = this.pending!;
        this.pending = null;
        if (n.value) this.start(n.value, info);
        else {
          const none = this.onNone;
          this.onDone = this.onNone = null;
          this.off?.();
          this.off = null;
          useMontage.setState({ open: false, shot: null, info: null });
          none?.();
        }
        return;
      }
      if (performance.now() - t0 >= budgetMs) return;
    }
  }

  get shot(): ShotId | null {
    return useMontage.getState().shot;
  }

  /** Changes whenever the scene must set its players again (a new montage). */
  get epoch(): number {
    return this.player?.epoch ?? -1;
  }

  private start(staged: StagedPlay, info: MontageInfo): void {
    const p = new ReplayPlayer(staged.src, WINDOW);
    p.director = false;
    p.playing = true;
    this.player = p;
    this.staged = staged;
    this.slow = staged.kind === 'td' || staged.kind === 'turnover';
    // The play shot runs to just past the whistle (a beat longer after a score or a pick, in slow motion).
    this.playEnd = Math.min(p.end, Math.max(staged.keyTick + (this.slow ? 40 : 20), staged.whistleTick + 12));
    this.shotT = 0;
    this.cut = true;
    this.cutCount++;
    const { kind, label, down, toGo, los, yards } = staged;
    useMontage.setState({ open: true, shot: 'establish', info: { ...info, play: { kind, label, down, toGo, los, yards } } });
  }

  /** Every frame of the play screens (GameScene, before it draws), by the frame's step (s). */
  frame(step: number): void {
    if (this.search) this.searchStep(MontageSession.SLICE_MS);
    const p = this.player;
    const st = this.staged;
    if (!p || !st) return;
    this.shotT += step;
    const shot = useMontage.getState().shot;
    p.speed = shot === 'play' && this.slow ? montageSpeed(p.tick - st.keyTick) : 1;
    p.frame(step);
    if (shot === 'establish' && p.tick >= st.snapTick - EST_LEAD) this.to('play');
    else if (shot === 'play' && p.tick >= this.playEnd) this.to('reaction');
    else if (shot === 'reaction' && this.shotT >= SHOT_SECS.reaction) this.to('board');
    else if (shot === 'board' && this.shotT >= SHOT_SECS.board) this.finish();
  }

  private to(shot: ShotId): void {
    this.shotT = 0;
    this.cut = true;
    this.cutCount++;
    useMontage.setState({ shot });
  }

  /** The moment's time from the snap (s), for the notes. */
  get keySecs(): number {
    return this.staged ? (this.staged.keyTick - this.staged.snapTick) * TICK : 0;
  }

  /** Skipped (or over): the game scores the drive and moves on. */
  skip(): void {
    if (this.busy) this.finish();
  }

  /** Gone with no hand-back (the game is being left). */
  abort(): void {
    this.onDone = null;
    if (this.busy) this.finish();
  }

  private finish(): void {
    const done = this.onDone;
    this.search = null;
    this.pending = null;
    this.onNone = null;
    this.player = null;
    this.staged = null;
    this.onDone = null;
    this.off?.();
    this.off = null;
    useMontage.setState({ open: false, shot: null, info: null });
    done?.();
  }
}

export const montage = new MontageSession();

if (import.meta.env.DEV) Object.assign(globalThis, { __btbMontage: montage, __btbMontageUi: useMontage });
