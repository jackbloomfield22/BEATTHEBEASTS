import { useEffect } from 'react';
import { urlFlags } from '@/app/platform';
import { montage, useMontage, type MontageInfo } from '@/game/montageSession';
import { spotLabel } from '@/game/situation';
import { useMenuNav } from '../nav';
import { ActionGlyph } from '../components/Glyph';
import '../styles/montage.css';

// The Beasts' drive montage's graphics (M7, src/game/montageSession.ts): a
// broadcast package's, drawn once per cut (the store changes on cuts only).
//   the bumper while the key play is staged ("MEANWHILE · BEASTS BALL");
//   the bug, top left, through the establishing and play shots: the key
//     play's down, distance and spot;
//   the call, big, on the reaction shot ("TOUCHDOWN", "INTERCEPTED");
//   the "BEASTS DRIVE" lower third on the board shot: the result, the
//     drive's plays, yards and time (the resolver's), and where your drive starts.
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

const DOWN = ['1st', '2nd', '3rd', '4th'];

/** The key play's spot as a broadcast says it: the Beasts' own side, or the Contenders'. */
function spotOf(los: number): string {
  const y = Math.round(los);
  return y === 50 ? 'Midfield' : y < 50 ? `BEA ${y}` : `CON ${100 - y}`;
}

/** Where your drive starts, or what the clock did. */
function nextLine(info: MontageInfo): string {
  const d = info.drive;
  if (info.ot) return 'Your answer from their 25.';
  if (d.result === 'EndOfHalf') return 'Halftime: you receive the second half.';
  if (d.result === 'EndOfGame') return info.after.beasts > info.after.user ? 'They kneel it out.' : 'The end of regulation.';
  return `Your ball on the ${spotLabel(d.nextStart)}.`;
}

/** Good for the Contenders (the call goes up in lime, not crimson). */
const forUs = (k: string | undefined) => k === 'turnover' || k === 'stop' || k === 'safety';

export function MontageHud() {
  const shot = useMontage((s) => s.shot);
  const info = useMontage((s) => s.info);
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
  const scored = d.points > 0;
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
          <span className="mt-bug-tag">Beasts ball</span>
          <span className="mt-bug-sit">
            {DOWN[p.down - 1]} &amp; {p.los + p.toGo >= 100 ? 'Goal' : p.toGo}
          </span>
          <span className="mt-bug-spot">{spotOf(p.los)}</span>
        </div>
      ) : null}
      {shot === 'reaction' && p ? (
        <div className={`mt-call ${forUs(p.kind) ? 'us' : 'them'}`} key="call">
          {p.label}
        </div>
      ) : null}
      {shot === 'board' ? (
        <div className={`mt-lower ${scored ? 'scored' : 'stopped'}`} key="lower">
          <div className="mt-lower-k">Beasts drive{info.ot ? ` · Overtime ${info.ot}` : ''}</div>
          <div className="mt-lower-line">
            <span className="mt-lower-r">{RESULT[d.result]}</span>
            {d.points ? <span className="mt-lower-pts">+{d.points}</span> : null}
          </div>
          <div className="mt-lower-meta">
            {d.plays} {d.plays === 1 ? 'play' : 'plays'} · {Math.max(0, Math.round(d.yards))} yd · {d.top}
            {d.twoPoint ? ` · two-point try ${d.twoPoint.good ? 'good' : 'failed'}` : ''}
            {d.result === 'Safety' ? ' · +2 Contenders' : ''}
          </div>
          <div className="mt-lower-next">{nextLine(info)}</div>
        </div>
      ) : null}
      <button className="mt-skip" tabIndex={-1} onClick={skip}>
        <ActionGlyph action="menu.confirm" />
        <span>Skip</span>
      </button>
    </div>
  );
}
