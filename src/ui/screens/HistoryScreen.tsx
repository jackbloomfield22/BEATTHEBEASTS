import { useEffect, useState } from 'react';
import { useApp } from '@/app/appStore';
import { useHistory, viewRecord } from '@/app/history';
import { Audio } from '@/audio/audio';
import type { GameRecord } from '@/game/record';
import { passerRating } from '@/game/stats';
import { useMenuNav } from '../nav';
import { Hints } from '../components/controls';
import { dateLabel, DriveChart, modeLabel, plural, resultWord } from '../results/GameReport';
import '../styles/results.css';

// History: every game you've finished (and the ones you left), newest first.
// The focused game's summary sits on the right; Enter opens its full results
// and box score, exactly as they were at the final whistle.

export function HistoryScreen() {
  const back = useApp((s) => s.back);
  const go = useApp((s) => s.go);
  const setShot = useApp((s) => s.setShot);
  const records = useHistory((s) => s.records);
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    setShot('history');
  }, [setShot]);
  const open = (i: number) => {
    const r = records[i];
    if (!r) return;
    Audio.uiSelect();
    viewRecord(r.id, 'history');
    go('results');
  };
  useMenuNav({ count: records.length, focus, setFocus, onConfirm: open, onBack: back, wrap: false });
  const cur = records[Math.min(focus, records.length - 1)];
  const wins = records.filter((r) => r.end === 'final' && r.score.user > r.score.beasts).length;
  const finished = records.filter((r) => r.end === 'final').length;
  return (
    <div className="menu-screen history-screen">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">History</h1>
        <div className="call-sit">
          <span className="call-down">{plural(records.length, 'game')}</span>
          <span className="call-spot">{finished ? `${wins}–${finished - wins} against the Beasts` : 'Play a game and it lands here'}</span>
        </div>
      </header>
      {records.length ? (
        <div className="hist-body">
          <ol className="hist-list">
            {records.map((r, i) => (
              <HistoryRow key={r.id} r={r} focused={i === focus} onHover={() => setFocus(i)} onClick={() => open(i)} />
            ))}
          </ol>
          {cur ? <HistoryDetail r={cur} /> : null}
        </div>
      ) : (
        <div className="hist-empty">
          <h2>No games yet</h2>
          <p>Every game you finish is kept here: the final score, the grade, the full box score and the drive chart, so you can come back to any of them.</p>
        </div>
      )}
      <Hints
        items={[
          ...(records.length
            ? [
                { kb: '↑↓', pad: 'D-Pad', label: 'Choose' },
                { kb: 'Enter', pad: 'A', label: 'Box score' },
              ]
            : []),
          { kb: 'Esc', pad: 'B', label: 'Back' },
        ]}
      />
    </div>
  );
}

function HistoryRow({ r, focused, onHover, onClick }: { r: GameRecord; focused: boolean; onHover: () => void; onClick: () => void }) {
  const res = resultWord(r);
  return (
    <li className={`hist-row ${focused ? 'is-focused' : ''}`} onMouseEnter={onHover} onClick={onClick} ref={(el) => void (focused && el?.scrollIntoView({ block: 'nearest' }))}>
      <span className={`hist-res ${res.tone} ${r.end}`}>{r.end === 'left' ? 'Left' : res.tone === 'win' ? 'W' : res.tone === 'loss' ? 'L' : 'T'}</span>
      <span className="hist-score">
        {r.score.user}–{r.score.beasts}
        {r.ot ? <em>{r.ot > 1 ? `${r.ot}OT` : 'OT'}</em> : null}
      </span>
      <span className={`hist-grade ${res.tone}`}>{r.grade?.grade ?? '—'}</span>
      <span className="hist-mode">{modeLabel(r.mode)}</span>
      <span className="hist-date">{dateLabel(r.finishedAt)}</span>
    </li>
  );
}

/** The focused game at a glance: the result, the leaders, the drives. */
export function HistoryDetail({ r }: { r: GameRecord }) {
  const res = resultWord(r);
  const b = r.box;
  const rush = Object.values(b.rush).sort((x, y) => y.yds - x.yds)[0];
  const rec = Object.values(b.rec).sort((x, y) => y.yds - x.yds)[0];
  const beast = Object.values(b.def).sort((x, y) => y.sacks * 3 + y.ints * 3 + y.tackles - (x.sacks * 3 + x.ints * 3 + x.tackles))[0];
  return (
    <aside className="hist-detail" key={r.id}>
      <div className="hd-top">
        <span className={`res-banner ${res.tone}`}>{res.word}</span>
        <span className="hd-clock">{r.clock}</span>
      </div>
      <div className="hd-score">
        <span className="us">Contenders {r.score.user}</span>
        <span className="them">Beasts {r.score.beasts}</span>
      </div>
      <div className={`hd-grade ${res.tone}`}>
        {r.grade ? (
          <>
            <b>{r.grade.grade}</b> {r.grade.label}
          </>
        ) : (
          'Not graded (left early)'
        )}
      </div>
      <ul className="hd-leaders">
        <li>
          <span>Passing</span>
          {b.pass.name}: {b.pass.cmp}/{b.pass.att}, {Math.round(b.pass.yds)} yd, {plural(b.pass.td, 'TD')}, {plural(b.pass.int, 'INT')} · {passerRating(b.pass).toFixed(1)} rating
        </li>
        {rush ? (
          <li>
            <span>Rushing</span>
            {rush.name}: {plural(rush.car, 'carry', 'carries')}, {Math.round(rush.yds)} yd
          </li>
        ) : null}
        {rec ? (
          <li>
            <span>Receiving</span>
            {rec.name}: {plural(rec.rec, 'catch', 'catches')}, {Math.round(rec.yds)} yd
          </li>
        ) : null}
        {beast ? (
          <li>
            <span>Top Beast</span>
            {beast.name}: {plural(beast.tackles, 'tackle')}, {plural(beast.sacks, 'sack')}
            {beast.ints ? `, ${plural(beast.ints, 'INT')}` : ''}
          </li>
        ) : null}
      </ul>
      {r.playOfGame ? (
        <div className="hd-pog">
          <span>Play of the game</span>
          <b>{r.playOfGame.headline}</b> {r.playOfGame.detail}
        </div>
      ) : null}
      <DriveChart rec={r} compact />
    </aside>
  );
}
