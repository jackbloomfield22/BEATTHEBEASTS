// The Beasts' drive on screen (M7, Playtest 1 #4; cut down after M7 at the
// owner's request: "just show their scoring play if they had one, or their
// turnover/turnover on downs/punt"). The drive's deciding play (montage.ts),
// in the live stadium, on the broadcast camera, then the result graphic
// over its last beat; about 4–6 s:
//   play    a snap through the replay player (the live camera's own logic:
//           behind the offense, riding the throw, following the carrier),
//           cut in just before the snap, a touch of slow motion through a
//           score or a turnover; or a kick through the kick view (the
//           punt's camera rides the ball, the field goal's sits behind the
//           holder), from just before the punter catches it or the snap
//           of the hold;
//   result  the same camera on the dead ball (or the ball down), the score
//           bug updating and the "BEASTS DRIVE" lower third up.
// The clock is the scene's frame step (real seconds; a recorded video's
// game time), never the wall clock, so a capture plays it exactly as a
// player sees it. Skippable at any moment (MontageHud: confirm or back;
// Start). React reads a small store that changes on each shot only.

import { create } from 'zustand';
import { Input } from '@/input/InputManager';
import { Audio } from '@/audio/audio';
import { contactFor, kickView } from '@/render/game/kickView';
import { TICK } from '@/sim';
import type { BeastsDrive } from './match';
import { KICK_FROM, KICK_RESULT, LEAD, montageSpeed, RESULT_SECS, resultTick, staging, type MontageTeams, type Staged, type StagedKick, type StagedPlay } from './montage';
import { ReplayPlayer } from './replay';

/** 'search': the play is being staged (a bumper is up; a few frames). */
export type ShotId = 'search' | 'play' | 'result';

/** What the HUD says: the drive (the resolver's), the staged play, the score before and after, the game clock. */
export interface MontageInfo {
  drive: BeastsDrive;
  /** The staged play (null while it's being staged). */
  play: Pick<StagedPlay | StagedKick, 'kind' | 'label' | 'down' | 'toGo' | 'los' | 'yards'> | null;
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

class MontageSession {
  /** A snap on screen (its replay player), or a kick (the kick view's). */
  player: ReplayPlayer | null = null;
  staged: StagedPlay | null = null;
  kick: StagedKick | null = null;
  /** Set when the play comes up; the camera takes it (and cuts to the broadcast angle). */
  cut = false;
  /** Montages so far (the scene keys the kick's look on it). */
  cutCount = 0;
  /** Seconds into the current shot. */
  shotT = 0;
  private resultAt = 0;
  private slow = false;
  private thumped = false;
  private onDone: (() => void) | null = null;
  private onNone: (() => void) | null = null;
  private off: (() => void) | null = null;
  private search: Generator<void, Staged | null, void> | null = null;
  private pending: MontageInfo | null = null;
  private ready: { staged: Staged; info: MontageInfo } | null = null;

  /** The drive's play is on screen. */
  get active(): boolean {
    return this.player !== null || this.kick !== null;
  }

  /** The play is being staged, or is on: the game waits on it. */
  get busy(): boolean {
    return this.active || this.search !== null || this.ready !== null;
  }

  /** Most of a frame the search takes (ms): a try runs whole, so a frame can go over by one. */
  static readonly SLICE_MS = 6;

  /**
   * Stage a drive's deciding play over the next frames (montage.ts staging,
   * a try at a time), then play it. `onNone`: nothing fits (the Meanwhile card instead).
   */
  prepare(d: BeastsDrive, teams: MontageTeams, seed: number, round: number, ot: number, info: MontageInfo, onDone: () => void, onNone: () => void, wind?: { mph: number; dir: number }): void {
    this.abort();
    this.search = staging(d, teams, seed, round, ot, wind);
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
    this.build();
  }

  private build(): void {
    const r = this.ready;
    this.ready = null;
    if (r) this.start(r.staged, r.info);
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
        // Built on the next frame: the replay player runs the snap once more to check it (~10–30 ms), so not on top of the last try.
        if (n.value) this.ready = { staged: n.value, info };
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

  /** Changes whenever the scene must set its players again (a new snap). */
  get epoch(): number {
    return this.player?.epoch ?? -1;
  }

  private start(staged: Staged, info: MontageInfo): void {
    this.shotT = 0;
    this.cut = true;
    this.cutCount++;
    this.thumped = false;
    const { kind, label, down, toGo, los, yards } = staged;
    const play = { kind, label, down, toGo, los, yards };
    if (staged.type === 'kick') {
      this.kick = staged;
      // The kick view, as the kick panel sets it for yours, with the flight already struck.
      Object.assign(kickView, { active: true, kind: staged.kind === 'punt' ? 'PUNT' : 'FG', spotX: staged.spotX, distance: staged.distance, aim: 0, aiming: false, wind: { ...staged.wind }, path: staged.path, t: KICK_FROM[staged.kind], team: 'bst' });
      const contact = contactFor(kickView.kind);
      // The result as the punt comes down (it's fielded there) or as the field goal passes the posts.
      this.resultAt = contact + (staged.kind === 'punt' ? staged.hang + KICK_RESULT.puntAfterLand : staged.hang * KICK_RESULT.fgFlight);
    } else {
      const p = new ReplayPlayer(staged.src, LEAD);
      p.director = false;
      p.playing = true;
      this.player = p;
      this.staged = staged;
      this.slow = staged.kind === 'td' || staged.kind === 'turnover';
      // The result graphic: at the whistle, but not before the moment has landed.
      this.resultAt = resultTick(staged);
    }
    useMontage.setState({ open: true, shot: 'play', info: { ...info, play } });
  }

  /** Every frame of the play screens (GameScene, before it draws), by the frame's step (s). */
  frame(step: number): void {
    if (this.ready) this.build();
    else if (this.search) this.searchStep(MontageSession.SLICE_MS);
    if (!this.active) return;
    this.shotT += step;
    const shot = useMontage.getState().shot;
    const k = this.kick;
    if (k) {
      // The kick view's clock (KickBall steps it by the same frame step).
      const t = kickView.t;
      const contact = contactFor(kickView.kind);
      if (!this.thumped && t + step >= contact) {
        this.thumped = true;
        Audio.kickThump(Math.max(0, contact - t), true);
      }
      if (shot === 'play' && t >= this.resultAt) {
        this.to('result');
        // Their house: a make brings it up, a miss sits it down; a punt fielded gets a murmur, no more.
        if (k.kind === 'fg') Audio.kickCrowd(k.good);
      } else if (shot === 'result' && this.shotT >= RESULT_SECS) this.finish();
      return;
    }
    const p = this.player!;
    const st = this.staged!;
    p.speed = this.slow ? montageSpeed(p.tick - st.keyTick) : 1;
    p.frame(step);
    if (shot === 'play' && p.tick >= this.resultAt) this.to('result');
    else if (shot === 'result' && this.shotT >= RESULT_SECS) this.finish();
  }

  /** A shot change that isn't a cut: the camera stays on the play. */
  private to(shot: ShotId): void {
    this.shotT = 0;
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
    if (this.kick) Object.assign(kickView, { active: false, aiming: false, path: null, t: 0, team: 'con' });
    this.search = null;
    this.ready = null;
    this.pending = null;
    this.onNone = null;
    this.player = null;
    this.staged = null;
    this.kick = null;
    this.onDone = null;
    this.off?.();
    this.off = null;
    useMontage.setState({ open: false, shot: null, info: null });
    done?.();
  }
}

export const montage = new MontageSession();

if (import.meta.env.DEV) Object.assign(globalThis, { __btbMontage: montage, __btbMontageUi: useMontage, __btbKickView: kickView });
