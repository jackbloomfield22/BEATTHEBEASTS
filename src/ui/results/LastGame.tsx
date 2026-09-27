import type { GameRecord } from '@/game/record';
import { useMenuNav } from '../nav';
import { Hints, KeyCap } from '../components/controls';
import { BoxScore, dateLabel, DriveChart, modeLabel, PlayOfGameLine, ResultHeader, resultWord, TeamLine } from './GameReport';

// My Team's "Last Game" board (the main menu's My Team entry): the score,
// the grade, the team line and the drive chart at a glance, and the full
// box score (the same one screen as the results) a key away, over the room.

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
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, onBack: onClose, onAlt2: onClose });
  return (
    <div className="menu-screen results report-overlay">
      <div className="menu-scrim strong" />
      <ResultHeader rec={rec} meta={<span>{dateLabel(rec.finishedAt)}</span>} />
      <PlayOfGameLine rec={rec} />
      <BoxScore rec={rec} />
      <Hints items={[{ kb: 'Esc', pad: 'B', label: 'Back to the room' }]} />
    </div>
  );
}
