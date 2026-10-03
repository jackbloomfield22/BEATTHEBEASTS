import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Input } from '@/input/InputManager';
import { promptCode } from '@/input/prompts';
import { CAM_LABEL, replay, replayDom, useReplay } from '@/game/replaySession';
import { InputGlyph, useActionGlyph, useBindings, usePromptDevice } from '../components/Glyph';
import '../styles/replay.css';

// The instant replay's HUD (M7): a "REPLAY" wipe as it opens, the bug in
// the corner (what was flagged, the speed), and the deck along the bottom:
// the scrub bar with the snap and the key moment marked, the transport, the
// cameras and the way back. Kept clean: the play's own HUD (icons, prompts,
// the score bug) is off while it runs. The scrub bar's head and the clock
// are written each frame by the session (replayDom), never through React.

const SPEED_LABEL: Record<number, string> = { 1: '1×', 0.5: '½×', 0.25: '¼×' };
/** While it plays untouched this long (ms), the deck tucks down to the scrub bar: the picture is the point. */
const TUCK_MS = 2600;

/** True once nothing has been pressed or moved for TUCK_MS (any key, button, stick or mouse wakes it). */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = 0;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), TUCK_MS);
    };
    wake();
    const offA = Input.onAction(wake);
    const offD = Input.onDevice(wake);
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('wheel', wake, { passive: true });
    return () => {
      clearTimeout(t);
      offA();
      offD();
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('wheel', wake);
    };
  }, []);
  return idle;
}

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

function Btn({ action, word, onClick, lit, wide }: { action: string | ReactNode; word: string; onClick: () => void; lit?: boolean; wide?: boolean }) {
  const glyph = useActionGlyph();
  return (
    <button className={`cue rc${lit ? ' lit' : ''}${wide ? ' wide' : ''}`} onClick={onClick} tabIndex={-1}>
      {typeof action === 'string' ? glyph(action) : action}
      <span className="cue-w">{word}</span>
    </button>
  );
}

export function ReplayHud() {
  const ui = useReplay();
  const device = usePromptDevice();
  const pad = device === 'pad';
  const { kb, pad: padB } = useBindings();
  const bar = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const fracAt = (x: number) => {
    const r = bar.current!.getBoundingClientRect();
    return (x - r.left) / Math.max(1, r.width);
  };
  // Back: Esc (the pause key) on a keyboard, B on a pad.
  const backCode = promptCode(pad ? 'replay.close' : 'global.pause', device, kb, padB);
  const speed = ui.director ? 'Slow-mo' : (SPEED_LABEL[ui.speed] ?? `${ui.speed}×`);
  const tucked = useIdle() && ui.playing;
  return (
    <div className="replay-hud" data-cam={ui.cam}>
      <div className="replay-wipe" aria-hidden="true">
        <span>Replay</span>
      </div>
      <div className="replay-bug">
        <span className="rb-mark">
          <i className="rb-dot" />
          Replay
        </span>
        {ui.key ? <span className={`rb-key kind-${ui.key.kind}`}>{ui.key.label}</span> : null}
        <span className="rb-speed">{speed}</span>
        <span className="rb-cam">{CAM_LABEL[ui.cam]}</span>
      </div>
      {ui.loading ? <div className="replay-loading">Setting up the replay…</div> : null}
      <div className={`replay-deck${tucked ? ' tucked' : ''}`}>
        <div className="replay-scrub">
          <span className="replay-time" ref={(el) => void (replayDom.time = el)} />
          <div
            className="replay-bar"
            ref={bar}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              replay.scrubTo(fracAt(e.clientX), true);
            }}
            onPointerMove={(e) => {
              if (dragging.current) replay.scrubTo(fracAt(e.clientX), false);
            }}
            onPointerUp={(e) => {
              if (!dragging.current) return;
              dragging.current = false;
              replay.scrubTo(fracAt(e.clientX), true);
            }}
          >
            <div className="rbar-track">
              <div className="rbar-fill" ref={(el) => void (replayDom.fill = el)} />
            </div>
            <i className="rbar-mark snap" style={{ left: `${(ui.snapAt * 100).toFixed(2)}%` }} title="The snap" />
            {ui.key ? (
              <i className={`rbar-mark key kind-${ui.key.kind}`} style={{ left: `${(ui.key.at * 100).toFixed(2)}%` }}>
                <span>{ui.key.label}</span>
              </i>
            ) : null}
            <i className="rbar-head" ref={(el) => void (replayDom.head = el)} />
          </div>
        </div>
        <div className="replay-controls">
          <Btn action="replay.start" word="Start" onClick={() => replay.act('replay.start')} />
          <Btn action="replay.scrubBack" word="−1s" onClick={() => replay.act('replay.scrubBack')} />
          <Btn action="replay.frameBack" word="Frame" onClick={() => replay.act('replay.frameBack')} />
          <Btn action="replay.playPause" word={ui.playing ? 'Pause' : 'Play'} onClick={() => replay.act('replay.playPause')} lit={!ui.playing} wide />
          <Btn action="replay.frameForward" word="Frame" onClick={() => replay.act('replay.frameForward')} />
          <Btn action="replay.scrubForward" word="+1s" onClick={() => replay.act('replay.scrubForward')} />
          <Btn action="replay.slowmo" word={speed} onClick={() => replay.act('replay.slowmo')} lit={ui.speed !== 1 || ui.director} />
          {ui.key ? <Btn action="replay.key" word={ui.key.label} onClick={() => replay.act('replay.key')} /> : <Btn action="replay.key" word="The snap" onClick={() => replay.act('replay.key')} />}
        </div>
        <div className="replay-cams">
          <Btn action="replay.camera" word={CAM_LABEL[ui.cam]} onClick={() => replay.act('replay.camera')} />
          <Btn action="replay.focus" word={ui.focus === 'ball' ? 'On the ball' : 'On the player'} onClick={() => replay.act('replay.focus')} />
          <span className="cue rc hint">
            {pad ? <InputGlyph code="Pad:RStick" /> : <kbd>Drag</kbd>}
            <span className="cue-w">Orbit</span>
          </span>
          <span className="cue rc hint">
            {pad ? <InputGlyph code="Pad:LStick" /> : <kbd>Wheel</kbd>}
            <span className="cue-w">Zoom</span>
          </span>
          <Btn action={backCode ? <InputGlyph code={backCode} /> : <kbd>Esc</kbd>} word={ui.from === 'record' ? 'Results' : 'Back'} onClick={() => replay.close()} />
        </div>
      </div>
    </div>
  );
}
