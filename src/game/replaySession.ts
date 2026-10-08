// The instant replay session (M7, Playtest 1 #8; made quick and hands-off
// after M7 at the owner's request: "a quick replay that the player can't
// control beyond pressing space to skip or holding shift to speed up").
// Opens a replay of the snap on the field from its result card (Practice and
// a game), or of a game's play of the game from the results screen, and
// runs it in the live scene (GameScene draws `runner` while a replay is on;
// GameCamera flies the replay angle). A flagged play (a touchdown, a
// turnover, a big hit) opens a beat before its key moment, slows through it
// and hands back 1.5 s after; any other play runs from just before the snap
// to just after the whistle. It plays once and closes by itself. Space (A)
// skips it; holding Shift (RT) runs it at FAST×. Esc, B and the replay key
// skip it too. The Automatic replays setting rolls the flagged ones by
// themselves when the result comes up. React reads the small store, which
// changes only when the replay opens or closes, or the speed-up is pressed
// or let go.

import { create } from 'zustand';
import { Input } from '@/input/InputManager';
import { getSettings } from '@/app/settings';
import { urlFlags } from '@/app/platform';
import type { DefSlot, OffSlot, SimPlayer } from '@/sim';
import { practice, usePractice } from './practice';
import { celebration } from './celebration';
import type { GameRecord } from './record';
import { captureSource, FAST, keyMoment, quickWindow, ReplayPlayer, sourceOf, type FlagKind, type ReplayKey, type ReplaySource } from './replay';

export interface ReplayUi {
  open: boolean;
  /** A snap's replay (from its result card) or a record's play of the game (the results screen). */
  from: 'snap' | 'record' | null;
  /** The scene is still building its players (the results screen's replay mounts it). */
  loading: boolean;
  /** Running at FAST× (Shift or RT held, or the speed-up held down with the mouse). */
  fast: boolean;
  /** The flagged moment it's built around (the bug names it). */
  key: { kind: FlagKind; label: string } | null;
  /** Why a replay couldn't be shown. */
  error: string | null;
  /** The snap (practice.playId) whose replay was last opened: its card no longer leads with the offer. */
  watched: number;
}

export const useReplay = create<ReplayUi>(() => ({ open: false, from: null, loading: false, fast: false, key: null, error: null, watched: -1 }));
const set = (p: Partial<ReplayUi>) => useReplay.setState(p);

/** The camera cuts (rather than glides) to the replay angle on its next frame: a new replay. Read by GameCamera. */
export const replayCam = { cut: true };

/** What the seeks have cost (GameScene's catch-up): for the perf notes in docs/m7/REPLAY.md and the dev console. */
export const replayStats = { seeks: 0, ticks: 0, steps: 0, ms: 0, worstFrameMs: 0 };

/** Which flags play by themselves under the Automatic replays setting. */
export function autoFlags(setting: 'on' | 'big' | 'off'): FlagKind[] {
  return setting === 'on' ? ['touchdown', 'turnover', 'bigHit'] : setting === 'big' ? ['touchdown', 'turnover'] : [];
}

/** The snap on the field's key moment, if it's flagged (the result card's offer). Read-only, cheap: the events of one play. */
export function snapFlag(): ReplayKey | null {
  const s = practice.runner?.state;
  return s?.result ? keyMoment(s) : null;
}

type Rosters = { offense: Record<OffSlot, SimPlayer>; defense: Record<DefSlot, SimPlayer> };

/** The scene waits this long after a result card comes up before an automatic replay rolls (s of real time): the result lands first. */
const AUTO_DELAY = 1.1;
/** A skip this soon after opening is the press that opened it (ms). */
const DEBOUNCE_MS = 200;

class ReplaySession {
  player: ReplayPlayer | null = null;
  /** The two teams the results screen's replay builds its players from (null: the live session's). */
  rosters: Rosters | null = null;
  /** Closing a snap's replay: it runs on to where the live play stands first (the scene catches it up), then hands back. */
  closing = false;
  /**
   * After a snap's replay the scene carries on drawing the live play with the
   * bodies as the replay left them (it ended on the very state the live play
   * is in): this is that play's id, or -1.
   */
  handoff = -1;
  /** The tick it closes by itself at. */
  stopAt = -1;
  /** The speed-up held down with the mouse (the HUD's button). */
  private mouseFast = false;
  private origin = -1;
  private pop: (() => void) | null = null;
  private off: (() => void) | null = null;
  private openedAt = 0;
  /** The result card's arrival (performance.now() ms) and its play, for the automatic replay's beat. */
  private resultAt = 0;
  private resultPlay = -1;

  get active(): boolean {
    return this.player !== null;
  }

  get runner() {
    return this.player?.runner ?? null;
  }

  /** Changes whenever the scene must set its players again (a new replay). */
  get epoch(): number {
    return this.player?.epoch ?? -1;
  }

  /** The replay of the snap whose result card is up (opened from the card, or rolled by the Automatic replays setting: the same either way). */
  openSnap(): boolean {
    const r = practice.runner;
    if (this.player || !r || !r.state.result || usePractice.getState().stage !== 'result') return false;
    const p = this.start(captureSource(r.state, r.frames));
    if (!p) return false;
    this.origin = practice.playId;
    this.begin('snap', p);
    return true;
  }

  /** The play of the game from a record (the results screen). False (and the reason in the store) if it can't be shown. */
  openRecord(rec: GameRecord): boolean {
    if (this.player) return false;
    const cap = rec.playOfGame?.replay.capsule ?? null;
    const src = cap ? sourceOf(cap) : null;
    if (!src) {
      set({ error: "This game's play of the game was saved without its replay." });
      return false;
    }
    const p = this.start(src);
    if (!p) return false;
    this.rosters = { offense: src.setup.offense, defense: src.setup.defense };
    this.origin = -1;
    this.begin('record', p);
    set({ loading: true });
    return true;
  }

  private start(src: ReplaySource): ReplayPlayer | null {
    const p = new ReplayPlayer(src);
    if (!p.verified) {
      // A record from another build (the sim has changed since), or a determinism bug: never show a different play.
      console.warn('replay: the rebuilt play does not reach the recorded state; not shown');
      set({ error: 'This replay was recorded on an older version of the game and can no longer be shown.' });
      return null;
    }
    const w = quickWindow(p);
    p.seek(w.from);
    // The director's touch of slow motion through a flagged moment.
    p.director = !!p.key;
    this.stopAt = w.to;
    return p;
  }

  private begin(from: 'snap' | 'record', p: ReplayPlayer): void {
    this.player = p;
    this.closing = false;
    this.handoff = -1;
    this.mouseFast = false;
    this.openedAt = performance.now();
    replayCam.cut = true;
    this.pop?.();
    this.pop = Input.pushContext('replay');
    this.off?.();
    this.off = Input.onAction((id, info) => this.onAction(id, info.repeat));
    const k = p.key;
    set({
      open: true,
      from,
      loading: false,
      fast: false,
      key: k ? { kind: k.kind, label: k.label } : null,
      error: null,
      watched: from === 'snap' ? practice.playId : useReplay.getState().watched,
    });
  }

  /** The scene has its players (the results screen's replay). */
  sceneReady(): void {
    if (useReplay.getState().loading) set({ loading: false });
  }

  /** Over or skipped: back to the result card (or the results screen). */
  close(): void {
    const p = this.player;
    if (!p || this.closing) return;
    if (useReplay.getState().from === 'snap') {
      // Run on to where the live play stands (the scene animates the way), then hand back to it.
      this.closing = true;
      p.director = false;
      p.playing = false;
      p.boost = 1;
      p.seek(p.end);
      set({ fast: false });
      return;
    }
    this.finish();
  }

  /** Gone at once, with no hand-back (the screen it was on is going away). */
  abort(): void {
    if (!this.player) return;
    this.origin = -1;
    useReplay.setState({ from: null });
    this.finish();
  }

  /** The scene has caught a closing replay up: the live play takes over. */
  finish(): void {
    this.handoff = useReplay.getState().from === 'snap' ? this.origin : -1;
    this.player = null;
    this.rosters = null;
    this.closing = false;
    this.mouseFast = false;
    this.pop?.();
    this.pop = null;
    this.off?.();
    this.off = null;
    set({ open: false, from: null, loading: false, fast: false });
  }

  /**
   * Every frame of the play screens (GameScene, before it draws): plays the
   * replay on (FAST× while the speed-up is held), closes it at its end, and
   * rolls an automatic replay once a flagged play's result card has been up a beat.
   */
  frame(dt: number): void {
    const p = this.player;
    if (!p) {
      this.watchForAuto();
      return;
    }
    // Closing: the scene runs it on to the live play's state. The results screen's replay holds until the scene has its players.
    if (this.closing || useReplay.getState().loading) return;
    const fast = this.mouseFast || Input.isHeld('replay.fast');
    p.boost = fast ? FAST : 1;
    if (fast !== useReplay.getState().fast) set({ fast });
    p.frame(dt);
    if (!p.seeking && (p.tick >= this.stopAt || p.atEnd)) this.close();
  }

  /** The HUD's speed-up button held down with the mouse (or let go). */
  holdFast(on: boolean): void {
    this.mouseFast = on && !!this.player;
  }

  /** The Automatic replays setting: a flagged play's replay rolls by itself once its card has been up a beat. */
  private watchForAuto(): void {
    const ui = usePractice.getState();
    // The capture harness and the browser tests step their plays by hand (?shot, ?video): nothing rolls by itself.
    if (ui.stage !== 'result' || urlFlags.shot !== null || urlFlags.video) return;
    if (this.resultPlay !== practice.playId) {
      this.resultPlay = practice.playId;
      this.resultAt = performance.now();
      this.autoDone = false;
    }
    // A touchdown's celebration (M7) plays first: the card comes up after it, and the beat counts from then.
    if (celebration.busy) {
      this.resultAt = performance.now();
      return;
    }
    if (this.autoDone || performance.now() - this.resultAt < AUTO_DELAY * 1000) return;
    this.autoDone = true;
    const k = snapFlag();
    if (!k || useReplay.getState().watched === practice.playId || !autoFlags(getSettings().gameplay.autoReplay).includes(k.kind)) return;
    this.openSnap();
  }
  private autoDone = true;

  /** Don't roll an automatic replay for the snap on the field (the browser tests and the capture harness step plays themselves). */
  skipAuto(): void {
    this.autoDone = true;
    this.resultPlay = practice.playId;
  }

  private onAction(id: string, repeat: boolean): void {
    if (!this.player || repeat) return;
    // Space (A) skips it; so do Esc (pause), B and the replay key itself (not the press that opened it).
    if (id === 'replay.skip' || id === 'replay.close' || id === 'global.pause' || id === 'global.replay') {
      if (performance.now() - this.openedAt > DEBOUNCE_MS) this.close();
    }
  }
}

export const replay = new ReplaySession();

if (import.meta.env.DEV) Object.assign(globalThis, { __btbReplay: replay, __btbReplayUi: useReplay, __btbReplayStats: replayStats });
