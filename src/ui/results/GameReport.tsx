import type { ReactNode } from 'react';
import { gradeColor } from '@/engine/legacy/grades';
import { gradePlayers, type PlayerGrade } from '@/game/grades';
import type { UserDrive } from '@/game/match';
import type { GameRecord } from '@/game/record';
import { spotLabel } from '@/game/situation';
import { passerRating, type BigHit, type GameBox } from '@/game/stats';
import '../styles/results.css';

// The box score for one game record (GDD §14, Playtest 1): one screen, the
// way a broadcast shows it, no tabs and no scrolling. Left: the passing
// line, the rushing lines, the receiving lines and the report card (every
// skill player's grade, snaps and the reason in one line). Right: the
// Beasts' defense, the drive chart and the big hits. Every column is
// labelled in words a fan knows. Shared by the results screen (straight from
// a game, from the main menu's Last Game and from History) and the My Team
// board's F key. Numbers show in every mode (Film Room included): the game
// is over.

/** "1 turnover", "2 turnovers", "1 big hit taken". */
export function plural(n: number, one: string, many = `${one}s`, tail = ''): string {
  return `${n} ${n === 1 ? one : many}${tail ? ` ${tail}` : ''}`;
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');
const avg = (y: number, n: number) => (n ? r1(y / n) : '—');

export const DRIVE_RESULT: Record<UserDrive['result'], string> = {
  TD: 'Touchdown',
  FG: 'Field goal',
  MissedFG: 'Missed FG',
  Punt: 'Punt',
  Turnover: 'Turnover',
  Downs: 'Downs',
  Safety: 'Safety',
  EndOfHalf: 'End of half',
  EndOfGame: 'End of game',
  TwoPoint: 'Two-point try',
};
const BEASTS_RESULT: Record<string, string> = { TD: 'Touchdown', FG: 'Field goal', Punt: 'Punt', Turnover: 'Turnover', Downs: 'Downs', Safety: 'Safety', MissedFG: 'Missed FG' };

export const roundLabel = (rec: GameRecord, i: number): string => (i < rec.drives ? `${i + 1}` : `OT${i - rec.drives + 1 > 1 ? i - rec.drives + 1 : ''}`);

export function whenLabel(rec: GameRecord, round: number, ot: number): string {
  if (ot) return ot > 1 ? `${ot}OT` : 'Overtime';
  return `Round ${round} of ${rec.drives}`;
}

export function modeLabel(mode: string): string {
  return { classic: 'Classic', film: 'Film Room', daily: 'Daily Challenge', quick: 'Quick Play' }[mode] ?? mode;
}

export function resultWord(rec: GameRecord): { word: string; tone: 'win' | 'loss' | 'even' } {
  const m = rec.score.user - rec.score.beasts;
  if (rec.end === 'left') return { word: 'Left early', tone: m > 0 ? 'win' : m < 0 ? 'loss' : 'even' };
  return m > 0 ? { word: 'Victory', tone: 'win' } : m < 0 ? { word: 'Defeat', tone: 'loss' } : { word: 'Tie', tone: 'even' };
}

function Table({ title, head, children, empty, cols, className = '' }: { title: string; head: ReactNode; children: ReactNode; empty?: string | false; cols: number; className?: string }) {
  return (
    <section className={`bx-sec ${className}`}>
      <h3>{title}</h3>
      <table className="rep-table">
        <thead>{head}</thead>
        <tbody>
          {children}
          {empty ? (
            <tr className="rep-empty">
              <td colSpan={cols}>{empty}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

export function TeamLine({ box }: { box: GameBox }) {
  return (
    <div className="rep-team">
      <span>{plural(box.plays, 'play')}</span>
      <span>{r0(box.yards)} yards</span>
      <span>{plural(box.firstDowns, 'first down')}</span>
      <span>{plural(box.sacks, 'sack', 'sacks', 'taken')}</span>
      <span>{plural(box.turnovers, 'turnover')}</span>
      <span className="hits">{plural(box.bigHits, 'big hit', 'big hits', 'taken')}</span>
    </div>
  );
}

// ---- The drive chart -----------------------------------------------------------------------

/**
 * The drive chart. Full: one row a round, both sides of it (the Beasts'
 * result, then your drive: start, plays, yards, result). Compact (History,
 * the My Team board): the same, without the start.
 */
export function DriveChart({ rec, compact = false }: { rec: GameRecord; compact?: boolean }) {
  const n = Math.max(rec.userDrives.length, rec.beastsDrives.length);
  const rows: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const b = rec.beastsDrives[i];
    const u = rec.userDrives[i];
    rows.push(
      <tr key={i} className={`r-${u?.result ?? 'none'}`}>
        <td className="dc-rd">{roundLabel(rec, i)}</td>
        <td className={`dc-beasts ${b?.points ? 'scored' : ''}`}>{b ? `${BEASTS_RESULT[b.result] ?? b.result}${b.points ? ` +${b.points}` : ''}` : ''}</td>
        {compact ? null : <td className="dc-start">{u ? spotLabel(u.start) : ''}</td>}
        <td>{u ? u.plays : ''}</td>
        <td>{u ? r0(u.yards) : ''}</td>
        <td className="dc-res">
          {u ? (
            <>
              {DRIVE_RESULT[u.result] ?? u.result}
              {u.result === 'TD' && u.points > 6 ? ` +${u.points}` : u.result === 'FG' ? ' +3' : ''}
              {u.against ? ` (−${u.against})` : ''}
            </>
          ) : (
            ''
          )}
        </td>
      </tr>,
    );
  }
  return (
    <table className={`rep-table drive-chart ${compact ? 'compact' : ''}`}>
      <thead>
        <tr>
          <th>Rd</th>
          <th>Beasts</th>
          {compact ? null : <th>Your start</th>}
          <th>Plays</th>
          <th>Yards</th>
          <th>Your result</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

// ---- The box score ----------------------------------------------------------------------------

function Passing({ box }: { box: GameBox }) {
  const p = box.pass;
  return (
    <Table
      title="Passing"
      cols={9}
      head={
        <tr>
          <th>Player</th>
          <th>Comp–Att</th>
          <th>Yards</th>
          <th>Avg</th>
          <th>TD</th>
          <th>INT</th>
          <th>Sacked</th>
          <th>Long</th>
          <th>Rating</th>
        </tr>
      }
    >
      <tr>
        <td>{p.name}</td>
        <td>
          {p.cmp}–{p.att}
        </td>
        <td>{r0(p.yds)}</td>
        <td>{avg(p.yds, p.att)}</td>
        <td>{p.td}</td>
        <td className={p.int ? 'bad' : ''}>{p.int}</td>
        <td>
          {p.sacks}
          {p.sacks ? <span className="sub">−{r0(p.sackYds)}</span> : null}
        </td>
        <td>{r0(p.long)}</td>
        <td>{r1(passerRating(p))}</td>
      </tr>
    </Table>
  );
}

function Rushing({ box }: { box: GameBox }) {
  const rows = Object.values(box.rush).sort((x, y) => y.yds - x.yds || y.car - x.car);
  return (
    <Table
      title="Rushing"
      cols={8}
      empty={rows.length ? false : 'No carries.'}
      head={
        <tr>
          <th>Player</th>
          <th>Carries</th>
          <th>Yards</th>
          <th>Avg</th>
          <th>TD</th>
          <th>Long</th>
          <th>Broke tackles</th>
          <th>Fumbles</th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.name}>
          <td>{r.name}</td>
          <td>{r.car}</td>
          <td>{r0(r.yds)}</td>
          <td>{avg(r.yds, r.car)}</td>
          <td>{r.td}</td>
          <td>{r0(r.long)}</td>
          <td>{r.bt}</td>
          <td className={r.lost ? 'bad' : ''}>
            {r.fum}
            {r.lost ? <span className="sub">{r.lost} lost</span> : null}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function Receiving({ box }: { box: GameBox }) {
  const rows = Object.values(box.rec).sort((x, y) => y.yds - x.yds || y.tgt - x.tgt);
  return (
    <Table
      title="Receiving"
      cols={9}
      empty={rows.length ? false : 'No passes thrown.'}
      head={
        <tr>
          <th>Player</th>
          <th>Catches</th>
          <th>Targets</th>
          <th>Yards</th>
          <th>Avg</th>
          <th>TD</th>
          <th>Long</th>
          <th>After catch</th>
          <th>Drops</th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.name}>
          <td>{r.name}</td>
          <td>{r.rec}</td>
          <td>{r.tgt}</td>
          <td>{r0(r.yds)}</td>
          <td>{avg(r.yds, r.rec)}</td>
          <td>{r.td}</td>
          <td>{r0(r.long)}</td>
          <td>{r0(r.yac)}</td>
          <td className={r.drops ? 'bad' : ''}>{r.drops}</td>
        </tr>
      ))}
    </Table>
  );
}

const ROLE_LABEL: Record<PlayerGrade['role'], string> = { QB: 'QB', RB1: 'RB1', RB2: 'RB2', WR1: 'WR1', WR2: 'WR2', WR3: 'WR3', TE1: 'TE1', TE2: 'TE2' };

/** Every skill player: his grade, his snaps and why, in one line each. */
function ReportCard({ rec }: { rec: GameRecord }) {
  const grades = gradePlayers(rec);
  return (
    <section className="bx-sec bx-card">
      <h3>
        Player grades <span className="h3-note">against what his role makes in {plural(Math.max(1, rec.userDrives.length), 'drive')}</span>
      </h3>
      <table className="rep-table grades">
        <thead>
          <tr>
            <th>Grade</th>
            <th>Player</th>
            <th>Snaps</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {grades.map((g) => (
            <tr key={g.role} className={g.grade ? '' : 'ungraded'}>
              <td className="grade-cell" style={g.grade ? { color: gradeColor(g.grade) } : undefined}>
                {g.grade ?? '—'}
              </td>
              <td>
                <span className="role">{ROLE_LABEL[g.role]}</span> {g.name}
              </td>
              <td>{g.snaps ?? '—'}</td>
              <td className="why" title={g.contributions.map((c) => `${c.points >= 0 ? '+' : ''}${c.points.toFixed(1)} ${c.label}`).join('\n')}>
                {g.why}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The Beasts' defensive lines: everyone who made a play, by impact, the most that fit. */
const BEASTS_ROWS = 7;
function BeastsDefense({ rec }: { rec: GameRecord }) {
  const order = new Map(rec.beasts.map((x, i) => [x.name, i]));
  const impact = (d: GameBox['def'][string]) => d.sacks * 3 + d.ints * 4 + d.pbu * 1.5 + d.pressures + d.tackles + d.bigHits * 1.5;
  const all = Object.values(rec.box.def).filter((d) => impact(d) > 0);
  const rows = all.sort((x, y) => impact(y) - impact(x) || (order.get(x.name) ?? 99) - (order.get(y.name) ?? 99)).slice(0, BEASTS_ROWS);
  const more = all.length - rows.length;
  return (
    <Table
      title="The Beasts' defense"
      className="bx-def"
      cols={7}
      empty={rows.length ? false : 'No defensive plays.'}
      head={
        <tr>
          <th>Player</th>
          <th>Tackles</th>
          <th>Sacks</th>
          <th>Pressures</th>
          <th>INT</th>
          <th>Breakups</th>
          <th>Big hits</th>
        </tr>
      }
    >
      {rows.map((d) => (
        <tr key={d.name}>
          <td>
            {d.name} <span className="sub">{d.pos}</span>
          </td>
          <td>{d.tackles}</td>
          <td>{d.sacks}</td>
          <td>{d.pressures}</td>
          <td>{d.ints}</td>
          <td>{d.pbu}</td>
          <td className={d.bigHits ? 'hit' : ''}>{d.bigHits}</td>
        </tr>
      ))}
      {more > 0 ? (
        <tr className="rep-empty">
          <td colSpan={7}>and {plural(more, 'other')}</td>
        </tr>
      ) : null}
    </Table>
  );
}

const HITS_SHOWN = 4;
function BigHits({ rec }: { rec: GameRecord }) {
  const hits: BigHit[] | undefined = rec.box.hits;
  const hardest = hits ? [...hits].sort((a, b) => b.force - a.force).slice(0, HITS_SHOWN) : [];
  const when = (h: BigHit) => (h.ot ? (h.ot > 1 ? `${h.ot}OT` : 'OT') : h.round ? `Rd ${h.round}` : '');
  return (
    <section className="bx-sec bx-hits">
      <h3>
        Big hits <span className="h3-note">{plural(rec.box.bigHits, 'hit')} taken</span>
      </h3>
      {!hits ? (
        <p className="rep-note">Not recorded for this game.</p>
      ) : hardest.length ? (
        <ul>
          {hardest.map((h, i) => (
            <li key={i}>
              <span className="bh-when">{when(h)}</span>
              <span className="bh-who">
                <b>{h.by}</b> <span className="sub">{h.pos}</span> on {h.on}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rep-note">Nobody got blown up.</p>
      )}
    </section>
  );
}

/** One line: the play of the game (flagged for the M7 replay), and the Daily's perfect-team tally. */
export function PlayOfGameLine({ rec }: { rec: GameRecord }) {
  const p = rec.playOfGame;
  const matched = rec.perfect ? rec.perfect.filter((x) => x.same).length : 0;
  return (
    <div className="bx-pog">
      {p ? (
        <span className={`pog-line ${p.touchdown ? 'good' : p.turnover ? 'bad' : ''}`}>
          <span className="pog-k">Play of the game</span>
          <b>{p.headline}</b> <span className="pog-d">{p.detail}</span> <span className="pog-w">{whenLabel(rec, p.round, p.ot)}</span>
        </span>
      ) : null}
      {rec.perfect ? (
        <span className="pog-perfect">
          <span className="pog-k">Perfect team</span>
          {matched} of {rec.perfect.length} matched
        </span>
      ) : null}
    </div>
  );
}

/** The whole box score on one screen. */
export function BoxScore({ rec }: { rec: GameRecord }) {
  return (
    <div className="bx">
      <div className="bx-left">
        <Passing box={rec.box} />
        <Rushing box={rec.box} />
        <Receiving box={rec.box} />
        <ReportCard rec={rec} />
      </div>
      <div className="bx-right">
        <BeastsDefense rec={rec} />
        <section className="bx-sec">
          <h3>
            Drive chart <TeamLine box={rec.box} />
          </h3>
          <DriveChart rec={rec} />
        </section>
        <BigHits rec={rec} />
      </div>
    </div>
  );
}

/** The score, the result and the grade: the top of the results screen and the box score over the room. */
export function ResultHeader({ rec, shown, meta }: { rec: GameRecord; shown?: { u: number; b: number }; meta?: ReactNode }) {
  const res = resultWord(rec);
  return (
    <header className="res-head">
      <div className={`res-banner ${res.tone}`}>{res.word}</div>
      <div className="res-score">
        <span className="us">
          Contenders <b>{shown ? shown.u : rec.score.user}</b>
        </span>
        <span className="dash">–</span>
        <span className="them">
          <b>{shown ? shown.b : rec.score.beasts}</b> Beasts
        </span>
      </div>
      <div className="res-meta">
        <span>{rec.clock}</span>
        <span>
          {modeLabel(rec.mode)} · {rec.drives} rounds
        </span>
        {meta}
      </div>
      <div className={`res-grade ${res.tone}`}>
        {rec.grade ? (
          <>
            <span className="grade">{rec.grade.grade}</span>
            <span className="label">{rec.grade.label}</span>
          </>
        ) : (
          <span className="label">No grade: the game wasn&rsquo;t finished</span>
        )}
        {rec.ot ? <span className="ot">{rec.ot > 1 ? `${rec.ot} overtimes` : 'Overtime'}</span> : null}
      </div>
    </header>
  );
}

/** "Sep 25, 7:42 PM". */
export function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
