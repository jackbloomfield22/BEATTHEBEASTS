import { useRef, useState } from 'react';
import type { GameRecord } from '@/game/record';
import { useMenuNav } from '../nav';
import { Hints, KeyCap } from '../components/controls';
import { dateLabel, DriveChart, GameReport, modeLabel, ReportTabs, resultWord, TeamLine } from './GameReport';
import { useReportNav } from './useReportNav';

// The Locker Room's "Last Game" board (the main menu's Locker Room entry):
// the score, the grade, the team line and the drive chart at a glance, and
// the full box score a key away, over the room.

export function LastGamePanel({ rec, onOpen }: { rec: GameRecord; onOpen: () => void }) {
  const res = resultWord(rec);
  return (
    <aside className="last-game" onClick={onOpen}>
      <div className="lg-kicker">
        Last game <span>{dateLabel(rec.finishedAt)}</span>
      </div>
      <div className="lg-top">
        <span className={`res-banner ${res.tone}`}>{res.word}</span>
        <span className={`lg-grade ${res.tone}`}>
          {rec.grade ? (
            <>
              <b>{rec.grade.grade}</b> {rec.grade.label}
            </>
          ) : (
            'Not graded'
          )}
        </span>
      </div>
      <div className="lg-score">
        <span className="us">Contenders {rec.score.user}</span>
        <span className="dash">–</span>
        <span className="them">{rec.score.beasts} Beasts</span>
      </div>
      <div className="lg-meta">
        {rec.clock} · {modeLabel(rec.mode)} · {rec.drives} rounds
      </div>
      <TeamLine box={rec.box} />
      <DriveChart rec={rec} compact />
      <div className="lg-open">
        <KeyCap kb="F" pad="X" /> Full box score
      </div>
    </aside>
  );
}

/** The full box score over the room (Esc closes). */
export function ReportOverlay({ rec, onClose }: { rec: GameRecord; onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, onBack: onClose, onAlt2: onClose });
  useReportNav({ enabled: true, tab, setTab, scroll: body });
  const res = resultWord(rec);
  return (
    <div className="menu-screen results report-overlay">
      <div className="menu-scrim strong" />
      <header className="res-head">
        <div className={`res-banner ${res.tone}`}>{res.word}</div>
        <div className="res-score">
          <span className="us">Contenders {rec.score.user}</span>
          <span className="dash">–</span>
          <span className="them">{rec.score.beasts} Beasts</span>
        </div>
        <div className="res-meta">
          <span>{rec.clock}</span>
          <span>
            {modeLabel(rec.mode)} · {rec.drives} rounds
          </span>
          <span>{dateLabel(rec.finishedAt)}</span>
        </div>
        <div className={`res-grade ${res.tone}`}>
          {rec.grade ? (
            <>
              <span className="grade">{rec.grade.grade}</span>
              <span className="label">{rec.grade.label}</span>
            </>
          ) : (
            <span className="label">Not graded</span>
          )}
        </div>
      </header>
      <ReportTabs tab={tab} onTab={setTab} />
      <GameReport rec={rec} tab={tab} ref={body} />
      <Hints
        items={[
          { kb: 'Q / E', pad: 'LB / RB', label: 'Tabs' },
          { kb: '↑↓', pad: 'D-Pad', label: 'Scroll' },
          { kb: 'Esc', pad: 'B', label: 'Back to the room' },
        ]}
      />
    </div>
  );
}
