import { useEffect, useRef } from 'react';
import { Input } from '@/input/InputManager';
import { FAST } from '@/game/replay';
import { replay, useReplay } from '@/game/replaySession';
import { useActionGlyph } from '../components/Glyph';
import '../styles/replay.css';

// The instant replay's HUD (M7; quick and hands-off since the owner's call
// after M7): a "REPLAY" wipe as it opens, the bug in the corner (REPLAY and
// what was flagged; the speed while it's sped up), and two prompts, bottom
// right: Skip (Space / A) and Hold for FAST× (Shift / RT). Both are buttons
// too: click Skip, hold the other down with the mouse. Nothing else: the
// replay plays itself once and hands back. The play's own HUD (icons,
// prompts, the score bug) is off while it runs.

/** The replay key (P / Backspace / View) opens `open` while `enabled` (a result card, the results screen). */
export function useReplayKey(open: () => void, enabled = true): void {
  const ref = useRef(open);
  ref.current = open;
  useEffect(() => {
    if (!enabled) return;
    return Input.onAction((id, info) => {
      if (id === 'global.replay' && !info.repeat && !replay.active) ref.current();
    });
  }, [enabled]);
}

/** A prompt for the replay: the replay key's glyph and a few words, clickable. */
export function ReplayCue({ label, onClick, className = '' }: { label: string; onClick: () => void; className?: string }) {
  const glyph = useActionGlyph();
  return (
    <button className={`cue replay-cue ${className}`.trim()} onClick={onClick} tabIndex={-1}>
      {glyph('global.replay')}
      <span className="cue-w">{label}</span>
    </button>
  );
}

export function ReplayHud() {
  const ui = useReplay();
  const glyph = useActionGlyph();
  // Let go of the mouse's speed-up wherever the button is released (or if the HUD goes).
  useEffect(() => {
    const up = () => replay.holdFast(false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      replay.holdFast(false);
    };
  }, []);
  return (
    <div className="replay-hud">
      <div className="replay-wipe" aria-hidden="true">
        <span>Replay</span>
      </div>
      <div className="replay-bug">
        <span className="rb-mark">
          <i className="rb-dot" />
          Replay
        </span>
        {ui.key ? <span className={`rb-key kind-${ui.key.kind}`}>{ui.key.label}</span> : null}
        {ui.fast ? <span className="rb-speed">{FAST}×</span> : null}
      </div>
      {ui.loading ? <div className="replay-loading">Setting up the replay…</div> : null}
      <div className="replay-keys">
        <button className={`cue rc${ui.fast ? ' lit' : ''}`} tabIndex={-1} onPointerDown={() => replay.holdFast(true)} onPointerLeave={() => replay.holdFast(false)}>
          {glyph('replay.fast')}
          <span className="cue-w">Hold: {FAST}× speed</span>
        </button>
        <button className="cue rc" tabIndex={-1} onClick={() => replay.close()}>
          {glyph('replay.skip')}
          <span className="cue-w">Skip</span>
        </button>
      </div>
    </div>
  );
}
