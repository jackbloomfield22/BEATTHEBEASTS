import { useEffect, useState } from 'react';
import { useApp } from '@/app/appStore';
import { useDraft } from '@/app/draftStore';
import { useHistory } from '@/app/history';
import { urlFlags } from '@/app/platform';
import { Audio } from '@/audio/audio';
import { game } from '@/game/game';
import { useMenuNav } from '../nav';
import { Hints, MenuItem } from '../components/controls';
import { BoxScore, dateLabel, PlayOfGameLine, ResultHeader } from '../results/GameReport';
import '../styles/results.css';

// The results screen (GDD §14, Playtest 2). Straight from a game it plays
// out as a broadcast would: the final score counts up and the result and
// the dominance grade land, then at two seconds the box score loads under
// them on its own, whatever was pressed (a press in those two seconds does
// nothing: the owner's playtest skipped past his results by accident).
// Then Enter goes to the main menu (not the locker room; no rematch with the
// same roster), or a new draft. From the main menu's Last Game and from
// History it opens on the box score. It draws a saved game record
// (src/app/history.ts), never the live match, so any game can be opened
// again.

/** When each beat lands (s): the result and grade, then the box score. */
export const BEATS = { grade: 1.2, box: 2.0 };

export function ResultsScreen() {
  const go = useApp((s) => s.go);
  const viewing = useHistory((s) => s.viewing);
  const from = useHistory((s) => s.from);
  const rec = useHistory((s) => (viewing ? s.records.find((r) => r.id === viewing) : s.records[0]) ?? null);
  const fresh = from === 'game' && !urlFlags.shot;
  const [beat, setBeat] = useState(fresh ? 0 : 2);
  const [shown, setShown] = useState(fresh ? { u: 0, b: 0 } : { u: rec?.score.user ?? 0, b: rec?.score.beasts ?? 0 });
  const [focus, setFocus] = useState(0);

  // The count-up and the grade, then the box score, on the clock alone.
  useEffect(() => {
    if (!rec || beat >= 2) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const s = (t - t0) / 1000;
      const k = Math.min(1, s / 1.0);
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

  const leaveGame = () => {
    if (from === 'game') game.leave();
  };
  const toHistory = () => {
    useHistory.setState({ viewing: null });
    go('history');
  };
  const toMenu = () => go('main');
  const newDraft = () => {
    const mode = useDraft.getState().mode;
    void useDraft.getState().begin(mode === 'daily' || mode === 'quick' ? 'classic' : mode);
    go('draft');
  };
  const items =
    from === 'history'
      ? [
          { label: 'Back to History', run: toHistory },
          { label: 'Main menu', run: toMenu },
        ]
      : from === 'game'
        ? [
            { label: 'Main menu', run: toMenu },
            { label: 'New draft', run: newDraft },
          ]
        : [
            { label: 'Main menu', run: toMenu },
            { label: 'History', run: toHistory },
          ];
  const ready = beat >= 2;
  const pick = (i: number) => {
    if (!ready) return;
    Audio.uiSelect();
    leaveGame();
    items[i]!.run();
  };
  useMenuNav({
    count: items.length,
    focus,
    setFocus,
    columns: items.length,
    enabled: ready,
    onConfirm: pick,
    onBack: () => {
      leaveGame();
      if (from === 'history') toHistory();
      else toMenu();
    },
  });

  if (!rec)
    return (
      <div className="menu-screen results">
        <div className="menu-scrim strong" />
        <div className="practice-loading">No game to show.</div>
      </div>
    );
  return (
    <div className={`menu-screen results beat-${beat} ${fresh ? 'fresh' : ''}`}>
      <div className="menu-scrim strong" />
      <ResultHeader rec={rec} shown={shown} meta={from !== 'game' ? <span>{dateLabel(rec.finishedAt)}</span> : null} />
      {ready ? (
        <>
          <PlayOfGameLine rec={rec} />
          <BoxScore rec={rec} />
          <nav className="res-actions">
            {items.map((it, i) => (
              <MenuItem key={it.label} size="md" label={it.label} focused={focus === i} onHover={() => setFocus(i)} onClick={() => pick(i)} />
            ))}
          </nav>
          <Hints
            items={[
              { kb: '← →', pad: 'D-Pad', label: 'Choose' },
              { kb: 'Enter', pad: 'A', label: 'Select' },
              { kb: 'Esc', pad: 'B', label: from === 'history' ? 'History' : 'Main menu' },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}
