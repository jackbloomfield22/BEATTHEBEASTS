import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/app/appStore';
import { useDraft } from '@/app/draftStore';
import { useHistory } from '@/app/history';
import { urlFlags } from '@/app/platform';
import { Audio } from '@/audio/audio';
import { game } from '@/game/game';
import { useMenuNav } from '../nav';
import { Hints, MenuItem } from '../components/controls';
import { dateLabel, GameReport, modeLabel, ReportTabs, resultWord } from '../results/GameReport';
import { useReportNav } from '../results/useReportNav';
import '../styles/results.css';

// The results screen (GDD §14). Straight from a game it plays out as a
// broadcast would: the final score counts up, the result and the dominance
// grade land, then the box score opens (Q/E through its tabs: the summary
// with the play of the game and the drive chart, passing and rushing,
// receiving, the line, the Beasts). From History it opens on the box score.
// It draws a saved game record (src/app/history.ts), never the live match,
// so any game can be opened again.

/** When each beat lands (s): the count-up, the result and grade, the box score. */
const BEATS = { grade: 1.5, box: 2.7 };

export function ResultsScreen() {
  const go = useApp((s) => s.go);
  const viewing = useHistory((s) => s.viewing);
  const from = useHistory((s) => s.from);
  const rec = useHistory((s) => (viewing ? s.records.find((r) => r.id === viewing) : s.records[0]) ?? null);
  const fresh = from === 'game' && !urlFlags.shot;
  const [beat, setBeat] = useState(fresh ? 0 : 2);
  const [shown, setShown] = useState(fresh ? { u: 0, b: 0 } : { u: rec?.score.user ?? 0, b: rec?.score.beasts ?? 0 });
  const [tab, setTab] = useState(0);
  const [focus, setFocus] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  // The count-up, then the grade, then the box score.
  useEffect(() => {
    if (!rec || beat >= 2) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const s = (t - t0) / 1000;
      const k = Math.min(1, s / 1.4);
      const e = 1 - Math.pow(1 - k, 3);
      setShown({ u: Math.round(rec.score.user * e), b: Math.round(rec.score.beasts * e) });
      if (s >= BEATS.box) return setBeat(2);
      if (s >= BEATS.grade) setBeat((b) => Math.max(b, 1));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id]);
  useEffect(() => {
    if (beat === 1) Audio.uiSelect();
  }, [beat]);

  const skipReveal = () => {
    if (!rec) return;
    setShown({ u: rec.score.user, b: rec.score.beasts });
    setBeat(2);
  };
  const leaveGame = () => {
    if (from === 'game') game.leave();
  };
  const toHistory = () => {
    useHistory.setState({ viewing: null });
    go('history');
  };
  const items =
    from === 'game'
      ? [
          { label: 'Locker Room', run: () => void useDraft.getState().view().then((ok) => go(ok ? 'draft' : 'main')) },
          { label: 'Draft again', run: () => void useDraft.getState().begin(useDraft.getState().mode === 'daily' ? 'classic' : useDraft.getState().mode).then(() => go('draft')) },
          { label: 'Main menu', run: () => go('main') },
        ]
      : [
          { label: 'Back to History', run: toHistory },
          { label: 'Main menu', run: () => go('main') },
        ];
  const pick = (i: number) => {
    if (beat < 2) return skipReveal();
    Audio.uiSelect();
    leaveGame();
    items[i]!.run();
  };
  // A press while the result is still landing only skips ahead: it never picks an action unseen.
  useMenuNav({ count: items.length, focus, setFocus, columns: items.length, onConfirm: pick, onBack: from === 'game' ? (beat < 2 ? skipReveal : undefined) : toHistory });
  useReportNav({ enabled: beat >= 2, tab, setTab, scroll: body });

  if (!rec)
    return (
      <div className="menu-screen results">
        <div className="menu-scrim strong" />
        <div className="practice-loading">No game to show.</div>
      </div>
    );
  const res = resultWord(rec);
  return (
    <div className={`menu-screen results beat-${beat}`} onClick={beat < 2 ? skipReveal : undefined}>
      <div className="menu-scrim strong" />
      <header className="res-head">
        <div className={`res-banner ${res.tone}`}>{res.word}</div>
        <div className="res-score">
          <span className="us">Contenders {shown.u}</span>
          <span className="dash">–</span>
          <span className="them">{shown.b} Beasts</span>
        </div>
        <div className="res-meta">
          <span>{rec.clock}</span>
          <span>
            {modeLabel(rec.mode)} · {rec.drives} rounds
          </span>
          {from !== 'game' ? <span>{dateLabel(rec.finishedAt)}</span> : null}
        </div>
        <div className="res-grade">
          {rec.grade ? (
            <>
              <span className="grade">{rec.grade.grade}</span>
              <span className="label">{rec.grade.label}</span>
            </>
          ) : (
            <span className="label">No grade: the game wasn't finished</span>
          )}
          {rec.ot ? <span className="ot">{rec.ot > 1 ? `${rec.ot} overtimes` : 'Overtime'}</span> : null}
        </div>
      </header>
      {beat >= 2 ? (
        <>
          <ReportTabs tab={tab} onTab={setTab} />
          <GameReport rec={rec} tab={tab} ref={body} />
          <nav className="res-actions">
            {items.map((it, i) => (
              <MenuItem key={it.label} size="md" label={it.label} focused={focus === i} onHover={() => setFocus(i)} onClick={() => pick(i)} />
            ))}
          </nav>
          <Hints
            items={[
              { kb: 'Q / E', pad: 'LB / RB', label: 'Tabs' },
              { kb: '↑↓', pad: 'D-Pad', label: 'Scroll' },
              { kb: '← →', pad: 'D-Pad', label: 'Choose' },
              { kb: 'Enter', pad: 'A', label: 'Select' },
              ...(from !== 'game' ? [{ kb: 'Esc', pad: 'B', label: 'Back' }] : []),
            ]}
          />
        </>
      ) : (
        <Hints items={[{ kb: 'Enter', pad: 'A', label: 'Skip' }]} />
      )}
    </div>
  );
}
