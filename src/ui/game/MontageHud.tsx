import { useEffect } from 'react';
import { urlFlags } from '@/app/platform';
import { montage, useMontage, type MontageInfo } from '@/game/montageSession';
import { broadcastSpot } from '@/game/broadcast';
import { useOnAir } from '@/game/onAir';
import { useMenuNav } from '../nav';
import { ActionGlyph } from '../components/Glyph';
import { LowerPlate, useHudScale } from './Broadcast';
import '../styles/montage.css';

// The Beasts' drive montage's graphics (M7, src/game/montageSession.ts): a
// broadcast package's, drawn once per cut (the store changes on cuts only).
//   the bumper while the key play is staged ("MEANWHILE · BEASTS BALL");
//   a tag, top left, through the establishing and play shots ("Meanwhile ·
//     Key play"); the key play's down, distance and spot are on the score
//     bug's down cell (./Broadcast.tsx), so the screen says it once;
//   the call, big, on the reaction shot ("TOUCHDOWN", "INTERCEPTED");
//   the "BEASTS DRIVE" lower third on the board shot (the broadcast
//     package's plate, ./Broadcast.tsx): the result, the drive's plays, yards
//     and time (the resolver's), the booth's line, and where your drive starts.
// Confirm or back (Enter / Esc, A / B; Start too) skips it at any moment.

const RESULT: Record<string, string> = {
  TD: 'Touchdown',
  FG: 'Field goal',
  Punt: 'Punt',
  Turnover: 'Turnover',
  Downs: 'Stopped on downs',
  Safety: 'Safety',
  MissedFG: 'Missed field goal',
  EndOfHalf: 'The half runs out',
  EndOfGame: 'Time runs out',
};


/** Where your drive starts, or what the clock did. */
function nextLine(info: MontageInfo): string {
  const d = info.drive;
  if (info.ot) return 'Your answer from their 25';
  if (d.result === 'EndOfHalf') return 'Halftime: you receive the second half';
  if (d.result === 'EndOfGame') return info.after.beasts > info.after.user ? 'They kneel it out' : 'The end of regulation';
  return `Your ball on the ${broadcastSpot(d.nextStart)}`;
}

/** Good for the Contenders (the call goes up in lime, not crimson). */
const forUs = (k: string | undefined) => k === 'turnover' || k === 'stop' || k === 'safety';

export function MontageHud() {
  const shot = useMontage((s) => s.shot);
  const info = useMontage((s) => s.info);
  const line = useOnAir((s) => s.drive);
  const hud = useHudScale();
  const skip = () => montage.skip();
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, onConfirm: skip, onBack: skip });
  // The capture harness's stills and the browser tests step frames by hand: the montage gets out of their way as the card did.
  useEffect(() => {
    if (urlFlags.shot === null || urlFlags.video) return;
    const t = setTimeout(() => montage.skip(), 400);
    return () => clearTimeout(t);
  }, []);
  if (!info || !shot) return null;
  const d = info.drive;
  const p = info.play;
  return (
    <div className={`montage shot-${shot}`}>
      {shot === 'search' ? (
        <div className="mt-bumper">
          <span className="mt-bumper-k">{info.ot ? `Overtime ${info.ot}` : 'Meanwhile'}</span>
          <span className="mt-bumper-t">Beasts ball</span>
        </div>
      ) : null}
      {(shot === 'establish' || shot === 'play') && p ? (
        <div className="mt-bug" key="bug">
          <span className="mt-bug-tag">{info.ot ? `Overtime ${info.ot}` : 'Meanwhile'}</span>
          <span className="mt-bug-sit">Key play</span>
        </div>
      ) : null}
      {shot === 'reaction' && p ? (
        <div className={`mt-call ${forUs(p.kind) ? 'us' : 'them'}`} key="call">
          {p.label}
        </div>
      ) : null}
      {shot === 'board' ? (
        <div className="onair mt-lower" style={hud} key="lower">
          <LowerPlate
            team="bst"
            tag={`Beasts drive${info.ot ? ` · Overtime ${info.ot}` : ''}`}
            block="BST"
            blockSmall
            title={
              <>
                {RESULT[d.result]}
                {d.points ? <span className="lt-pts">+{d.points}</span> : null}
              </>
            }
            meta={
              <>
                <span>
                  {d.plays} {d.plays === 1 ? 'play' : 'plays'}
                </span>
                <span>{Math.max(0, Math.round(d.yards))} yd</span>
                <span>{d.top}</span>
                {d.twoPoint ? <span>Two-point try {d.twoPoint.good ? 'good' : 'failed'}</span> : null}
                {d.result === 'Safety' ? <span>+2 Contenders</span> : null}
              </>
            }
            line={line}
            foot={nextLine(info)}
          />
        </div>
      ) : null}
      <button className="mt-skip" tabIndex={-1} onClick={skip}>
        <ActionGlyph action="menu.confirm" />
        <span>Skip</span>
      </button>
    </div>
  );
}
