// The instant replay session (M7, Playtest 1 #8): opens a replay of the snap
// on the field from its result card (Practice and a game), or of a game's
// play of the game from the results screen, and runs it in the live scene
// (GameScene draws `runner` while a replay is on; GameCamera flies the
// replay cameras). Flagged plays (touchdowns, turnovers, big hits) open a
// beat before their key moment and play through it in slow motion; the
// Automatic replays setting plays them by themselves when the result comes
// up. React reads the small store, which changes only when the transport
// does; the scrub bar's head and the clock are written straight to the DOM
// from the frame (replayDom), never through React.

import { create } from 'zustand';
import { Input } from '@/input/InputManager';
import { getSettings } from '@/app/settings';
import { urlFlags } from '@/app/platform';
import { TICK, type DefSlot, type OffSlot, type SimPlayer } from '@/sim';
import { practice, usePractice } from './practice';
import type { GameRecord } from './record';
import { AUTO_TAIL, captureSource, KEY_LEAD, keyMoment, ReplayPlayer, SCRUB_TICKS, sourceOf, type FlagKind, type ReplayKey, type ReplaySource } from './replay';

/** The replay's cameras: the free orbit, the broadcast angle (the live camera's), and the end zone looking back up the field. */
export type ReplayCam = 'orbit' | 'broadcast' | 'endzone';
export const REPLAY_CAMS: ReplayCam[] = ['orbit', 'broadcast', 'endzone'];
export const CAM_LABEL: Record<ReplayCam, string> = { orbit: 'Orbit', broadcast: 'Broadcast', endzone: 'End zone' };

export interface ReplayUi {
  open: boolean;
  /** A snap's replay (from its result card) or a record's play of the game (the results screen). */
  from: 'snap' | 'record' | null;
  /** The scene is still building its players (the results screen's replay mounts it). */
  loading: boolean;
  playing: boolean;
  speed: number;
  director: boolean;
  cam: ReplayCam;
  /** What the orbit circles: the ball, or the man the play is about. */
  focus: 'ball' | 'player';
  /** Playing by itself (the Automatic replays setting): it hands back to the card at its end unless a control is touched. */
  auto: boolean;
  /** The flagged moment and where it sits on the scrub bar (0–1); the snap's spot on it. */
  key: { kind: FlagKind; label: string; at: number } | null;
  snapAt: number;
  /** Why a replay couldn't be shown. */
  error: string | null;
  /** The snap (practice.playId) whose replay was last opened: its card no longer leads with the offer. */
  watched: number;
}

export const useReplay = create<ReplayUi>(() => ({ open: false, from: null, loading: false, playing: false, speed: 1, director: false, cam: 'orbit', focus: 'ball', auto: false, key: null, snapAt: 0, error: null, watched: -1 }));
const set = (p: Partial<ReplayUi>) => useReplay.setState(p);

/**
 * The replay HUD's live elements, written each frame (React renders them
 * once): the scrub bar's fill and head, and the clock.
 */
export const replayDom: { fill: HTMLElement | null; head: HTMLElement | null; time: HTMLElement | null } = { fill: null, head: null, time: null };

/**
 * The orbit camera's state, read by GameCamera each frame: the angles and
 * distance the user has set (yaw 0 = behind the offense, looking downfield;
 * pitch up from the turf), and a flag to cut rather than glide (a new
 * replay, a camera change).
 */
export const replayCam = { yaw: -0.7, pitch: 0.42, dist: 15, cut: true };
export const ORBIT_LIMITS = { pitchMin: 0.06, pitchMax: 1.35, distMin: 4, distMax: 48 };

/** What the scrubs have cost (GameScene's catch-up): for the perf notes in docs/m7/REPLAY.md and the dev console. */
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
/** A toggle of the replay key this soon after opening is the same press (ms). */
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
  private origin = -1;
  private pop: (() => void) | null = null;
  private off: (() => void) | null = null;
  private openedAt = 0;
  private autoEnd = -1;
  private touched = false;
  /** The result card's arrival (performance.now() ms) and its play, for the automatic replay's beat. */
  private resultAt = 0;
  private resultPlay = -1;

  get active(): boolean {
    return this.player !== null;
  }

  get runner() {
    return this.player?.runner ?? null;
  }

  /** Changes whenever the scene must set its players again (a new replay, a rebuild for a scrub back). */
  get epoch(): number {
    return this.player?.epoch ?? -1;
  }

  /** The replay of the snap whose result card is up. `auto`: rolled by the Automatic replays setting. */
  openSnap(auto = false): boolean {
    const r = practice.runner;
    if (this.player || !r || !r.state.result || usePractice.getState().stage !== 'result') return false;
    const p = this.start(captureSource(r.state, r.frames));
    if (!p) return false;
    this.origin = practice.playId;
    this.autoEnd = auto && p.key ? Math.min(p.end, p.key.tick + AUTO_TAIL) : -1;
    this.begin('snap', p, auto);
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
    this.autoEnd = -1;
    this.begin('record', p, false);
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
    // A flagged play opens a beat before its moment and plays through it slowed.
    if (p.key) {
      p.seek(p.key.tick - KEY_LEAD);
      p.director = true;
    }
    return p;
  }

  private begin(from: 'snap' | 'record', p: ReplayPlayer, auto: boolean): void {
    this.player = p;
    this.closing = false;
    this.handoff = -1;
    this.touched = false;
    this.openedAt = performance.now();
    replayCam.cut = true;
    // The orbit opens on a high three-quarter view from the offense's side, the play running away from it.
    replayCam.yaw = -0.7;
    replayCam.pitch = 0.42;
    replayCam.dist = 15;
    this.pop?.();
    this.pop = Input.pushContext('replay');
    this.off?.();
    this.off = Input.onAction((id, info) => this.onAction(id, info.repeat));
    const k = p.key;
    set({
      open: true,
      from,
      loading: false,
      playing: p.playing,
      speed: p.speed,
      director: p.director,
      cam: 'orbit',
      focus: 'ball',
      auto,
      key: k ? { kind: k.kind, label: k.label, at: p.fracOf(k.tick) } : null,
      snapAt: p.fracOf(p.snapTick),
      error: null,
      watched: from === 'snap' ? practice.playId : useReplay.getState().watched,
    });
  }

  /** The scene has its players (the results screen's replay). */
  sceneReady(): void {
    if (useReplay.getState().loading) set({ loading: false });
  }

  /** Back to the result card (or the results screen). */
  close(): void {
    const p = this.player;
    if (!p || this.closing) return;
    if (useReplay.getState().from === 'snap') {
      // Run on to where the live play stands (the scene animates the way), then hand back to it.
      this.closing = true;
      p.director = false;
      p.playing = false;
      p.seek(p.end);
      set({ playing: false });
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
    this.pop?.();
    this.pop = null;
    this.off?.();
    this.off = null;
    set({ open: false, from: null, loading: false, auto: false, playing: false });
  }

  /**
   * Every frame of the play screens (GameScene, before it draws): plays the
   * replay on, writes the scrub bar, and rolls an automatic replay once a
   * flagged play's result card has been up a beat.
   */
  frame(dt: number): void {
    const p = this.player;
    if (!p) {
      this.watchForAuto();
      return;
    }
    // The results screen's replay holds until the scene has its players.
    if (!this.closing && !useReplay.getState().loading) p.frame(dt);
    if (this.autoEnd >= 0 && !this.touched && !this.closing && (p.tick >= this.autoEnd || p.atEnd)) this.close();
    const st = useReplay.getState();
    if (!this.closing && (st.playing !== p.playing || st.speed !== p.speed || st.director !== p.director)) set({ playing: p.playing, speed: p.speed, director: p.director });
    this.paint(p);
  }

  /** The scrub bar and the clock (DOM, no React). */
  private paint(p: ReplayPlayer): void {
    const at = Math.min(p.tick, p.end);
    const f = p.fracOf(p.seeking ? p.target : at);
    const pct = `${(f * 100).toFixed(2)}%`;
    if (replayDom.fill) replayDom.fill.style.width = pct;
    if (replayDom.head) replayDom.head.style.left = pct;
    if (replayDom.time) {
      // The play clock from the snap: −0:00.8 before it, 0:03.2 after.
      const s = (at - Math.max(0, p.snapTick)) * TICK;
      const a = Math.abs(s);
      const txt = `${s < 0 ? '−' : ''}${Math.floor(a / 60)}:${(a % 60).toFixed(1).padStart(4, '0')}`;
      if (replayDom.time.textContent !== txt) replayDom.time.textContent = txt;
    }
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
    if (this.autoDone || performance.now() - this.resultAt < AUTO_DELAY * 1000) return;
    this.autoDone = true;
    const k = snapFlag();
    if (!k || useReplay.getState().watched === practice.playId || !autoFlags(getSettings().gameplay.autoReplay).includes(k.kind)) return;
    this.openSnap(true);
  }
  private autoDone = true;

  /** Don't roll an automatic replay for the snap on the field (the browser tests and the capture harness step plays themselves). */
  skipAuto(): void {
    this.autoDone = true;
    this.resultPlay = practice.playId;
  }

  /** A scrub bar press or drag (0–1 along the window). Drags only seek once the last seek has landed (a seek back replays the window). */
  scrubTo(frac: number, final: boolean): void {
    const p = this.player;
    if (!p || this.closing || (!final && p.seeking)) return;
    this.touched = true;
    p.director = false;
    p.seek(p.tickAt(frac));
  }

  /** The transport, for the HUD's buttons and the keys. */
  act(id: string): void {
    const p = this.player;
    if (!p || this.closing) return;
    this.touched = true;
    switch (id) {
      case 'replay.playPause':
        p.togglePlay();
        break;
      case 'replay.slowmo':
        p.cycleSpeed();
        break;
      case 'replay.scrubBack':
        p.scrub(-SCRUB_TICKS);
        break;
      case 'replay.scrubForward':
        p.scrub(SCRUB_TICKS);
        break;
      case 'replay.frameBack':
        p.stepFrame(-1);
        break;
      case 'replay.frameForward':
        p.stepFrame(1);
        break;
      case 'replay.start':
        p.toStart();
        break;
      case 'replay.key':
        p.toKey();
        break;
      case 'replay.camera': {
        const c = useReplay.getState().cam;
        replayCam.cut = true;
        set({ cam: REPLAY_CAMS[(REPLAY_CAMS.indexOf(c) + 1) % REPLAY_CAMS.length]! });
        break;
      }
      case 'replay.focus':
        set({ focus: useReplay.getState().focus === 'ball' ? 'player' : 'ball' });
        break;
    }
    set({ playing: p.playing, speed: p.speed, director: p.director });
  }

  /** The user took the camera (a drag, the stick): the orbit, from wherever the camera is. */
  takeCamera(): void {
    this.touched = true;
    if (useReplay.getState().cam !== 'orbit') set({ cam: 'orbit' });
  }

  private onAction(id: string, repeat: boolean): void {
    if (!this.player) return;
    // Esc (pause) and B leave the replay; so does the replay key itself (not the press that opened it).
    if (id === 'global.pause' || id === 'replay.close' || id === 'global.replay') {
      if (!repeat && performance.now() - this.openedAt > DEBOUNCE_MS) this.close();
      return;
    }
    if (!id.startsWith('replay.')) return;
    // Held, only the scrub and frame keys repeat; back only once the last seek has landed (each one replays the window).
    if (repeat) {
      const fwd = id === 'replay.scrubForward' || id === 'replay.frameForward';
      const back = id === 'replay.scrubBack' || id === 'replay.frameBack';
      if (!fwd && !(back && !this.player.seeking)) return;
    }
    this.act(id);
  }
}

export const replay = new ReplaySession();

if (import.meta.env.DEV) Object.assign(globalThis, { __btbReplay: replay, __btbReplayUi: useReplay, __btbReplayStats: replayStats, __btbReplayCam: replayCam });
