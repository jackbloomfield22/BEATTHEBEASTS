import { forwardRef, type ReactNode } from 'react';
import { gradeColor, gradeQB, gradeRec, gradeRush, scoreToGrade } from '@/engine/legacy/grades';
import type { UserDrive } from '@/game/match';
import type { GameRecord } from '@/game/record';
import { spotLabel } from '@/game/situation';
import { passerRating, type GameBox } from '@/game/stats';
import '../styles/results.css';

// The box score for one game record (GDD §14), as tabs: the summary (the
// play of the game, the drive chart, the key matchups), passing and rushing,
// receiving, the offensive line, and the Beasts with the coverage snapshot.
// Shared by the results screen, the Locker Room's Last Game view and
// History. Numbers show here in every mode (Film Room included): the game
// is over.

export const REPORT_TABS = ['Summary', 'Passing & Rushing', 'Receiving', 'O-Line', 'The Beasts'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

/** "1 turnover", "2 turnovers", "1 big hit taken". */
export function plural(n: number, one: string, many = `${one}s`, tail = ''): string {
  return `${n} ${n === 1 ? one : many}${tail ? ` ${tail}` : ''}`;
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');
const avg = (y: number, n: number) => (n ? r1(y / n) : '—');

const DRIVE_RESULT: Record<UserDrive['result'], string> = {
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

function GradeCell({ s }: { s: number }) {
  const g = scoreToGrade(s);
  return (
    <td className="grade-cell" style={{ color: gradeColor(g) }}>
      {g}
    </td>
  );
}

function Table({ head, children, empty, cols }: { head: ReactNode; children: ReactNode; empty?: string | false; cols: number }) {
  return (
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
  );
}

export function TeamLine({ box }: { box: GameBox }) {
  return (
    <div className="rep-team">
      <span>{plural(box.plays, 'play')}</span>
      <span>{r0(box.yards)} yd</span>
      <span>{plural(box.firstDowns, 'first down')}</span>
      <span>{plural(box.sacks, 'sack', 'sacks', 'taken')}</span>
      <span>{plural(box.turnovers, 'turnover')}</span>
      <span className="hits">{plural(box.bigHits, 'big hit', 'big hits', 'taken')}</span>
    </div>
  );
}

// ---- Summary ------------------------------------------------------------------------------

export function DriveChart({ rec, compact = false }: { rec: GameRecord; compact?: boolean }) {
  const n = Math.max(rec.userDrives.length, rec.beastsDrives.length);
  const rows: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const b = rec.beastsDrives[i];
    const u = rec.userDrives[i];
    if (b) {
      const pts = b.points ? ` +${b.points}` : '';
      rows.push(
        <tr key={`b${i}`} className={`dc-beasts ${b.points ? 'scored' : ''}`}>
          <td className="dc-rd">{roundLabel(rec, i)}</td>
          <td className="dc-team">Beasts</td>
          {compact ? null : <td>—</td>}
          <td>{b.plays}</td>
          <td>{Math.max(0, Math.round(b.yards))}</td>
          <td className="dc-res">
            {BEASTS_RESULT[b.result] ?? b.result}
            {pts}
          </td>
        </tr>,
      );
    }
    if (u) {
      rows.push(
        <tr key={`u${i}`} className={`dc-you r-${u.result}`}>
          <td className="dc-rd">{b ? '' : roundLabel(rec, i)}</td>
          <td className="dc-team">You</td>
          {compact ? null : <td>{spotLabel(u.start)}</td>}
          <td>{u.plays}</td>
          <td>{r0(u.yards)}</td>
          <td className="dc-res">
            {DRIVE_RESULT[u.result] ?? u.result}
            {u.against ? ` (−${u.against})` : ''}
          </td>
        </tr>,
      );
    }
  }
  return (
    <table className={`rep-table drive-chart ${compact ? 'compact' : ''}`}>
      <thead>
        <tr>
          <th>Rd</th>
          <th>Drive</th>
          {compact ? null : <th>Start</th>}
          <th>Plays</th>
          <th>Yds</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

function PlayOfGame({ rec }: { rec: GameRecord }) {
  const p = rec.playOfGame;
  if (!p) return <div className="pog empty">No snaps this game.</div>;
  return (
    <div className={`pog ${p.touchdown ? 'good' : p.turnover ? 'bad' : ''}`}>
      <div className="pog-kicker">
        Play of the game <span className="pog-flag">Flagged for replay</span>
      </div>
      <div className="pog-head">{p.headline}</div>
      <div className="pog-detail">{p.detail}</div>
      <div className="pog-meta">
        {whenLabel(rec, p.round, p.ot)} · drive {p.drive + 1}, play {p.n} · {p.down === 1 ? '1st' : p.down === 2 ? '2nd' : p.down === 3 ? '3rd' : '4th'} & {Math.max(1, Math.round(p.toGo))} at {spotLabel(p.los)} · {p.playName}
      </div>
    </div>
  );
}

function Summary({ rec }: { rec: GameRecord }) {
  return (
    <div className="rep-cols">
      <section>
        <PlayOfGame rec={rec} />
        <h3>Team</h3>
        <TeamLine box={rec.box} />
        {rec.matchups.length ? (
          <>
            <h3>Key matchups</h3>
            <ul className="res-matchups">
              {rec.matchups.map((x) => (
                <li key={x.rec}>
                  <span className="slot">{x.slot}</span>
                  <span className="who">
                    {x.rec} <em>vs</em> {x.def}
                  </span>
                  <span className="line">{x.line}</span>
                  <span className={`verdict v-${x.verdict.split(' ')[0]!.toLowerCase()}`}>{x.verdict}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {rec.perfect ? (
          <>
            <h3>The perfect team</h3>
            <ul className="res-perfect">
              {rec.perfect.map((p) => (
                <li key={p.slot} className={p.same ? 'same' : ''}>
                  <span className="slot">{p.slot}</span>
                  <span>{p.pick ?? '—'}</span>
                  <span className="you">{p.same ? '✓ you' : (p.mine ?? '')}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      <section>
        <h3>Drive chart</h3>
        <DriveChart rec={rec} />
      </section>
    </div>
  );
}

// ---- The offense --------------------------------------------------------------------------

function PassingRushing({ rec }: { rec: GameRecord }) {
  const b = rec.box;
  const p = b.pass;
  const scale = 10 / rec.drives; // legacy grades read a 10-drive game's yardage
  const rush = Object.values(b.rush).sort((x, y) => y.yds - x.yds);
  return (
    <div className="rep-stack">
      <h3>Passing</h3>
      <Table
        cols={10}
        head={
          <tr>
            <th>Player</th>
            <th>C/Att</th>
            <th>Yds</th>
            <th>Y/A</th>
            <th>TD</th>
            <th>Int</th>
            <th>Sk</th>
            <th>Long</th>
            <th>Rating</th>
            <th>Grade</th>
          </tr>
        }
      >
        <tr>
          <td>{p.name}</td>
          <td>
            {p.cmp}/{p.att}
          </td>
          <td>{r0(p.yds)}</td>
          <td>{avg(p.yds, p.att)}</td>
          <td>{p.td}</td>
          <td>{p.int}</td>
          <td>
            {p.sacks}
            {p.sacks ? <span className="sub">−{r0(p.sackYds)}</span> : null}
          </td>
          <td>{r0(p.long)}</td>
          <td>{r1(passerRating(p))}</td>
          <GradeCell s={gradeQB({ ...p, yds: p.yds * scale })} />
        </tr>
      </Table>
      <h3>Rushing</h3>
      <Table
        cols={9}
        empty={rush.length ? false : 'No carries.'}
        head={
          <tr>
            <th>Player</th>
            <th>Car</th>
            <th>Yds</th>
            <th>Avg</th>
            <th>TD</th>
            <th>Long</th>
            <th title="Broken tackles">BT</th>
            <th>Fum</th>
            <th>Grade</th>
          </tr>
        }
      >
        {rush.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{r.car}</td>
            <td>{r0(r.yds)}</td>
            <td>{avg(r.yds, r.car)}</td>
            <td>{r.td}</td>
            <td>{r0(r.long)}</td>
            <td>{r.bt}</td>
            <td>
              {r.fum}
              {r.lost ? <span className="sub">{r.lost} lost</span> : null}
            </td>
            <GradeCell s={gradeRush({ ...r, yds: r.yds * scale })} />
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Receiving({ rec }: { rec: GameRecord }) {
  const scale = 10 / rec.drives;
  const rows = Object.values(rec.box.rec).sort((x, y) => y.yds - x.yds || y.tgt - x.tgt);
  return (
    <div className="rep-stack">
      <h3>Receiving</h3>
      <Table
        cols={11}
        empty={rows.length ? false : 'No targets.'}
        head={
          <tr>
            <th>Player</th>
            <th>Tgt</th>
            <th>Rec</th>
            <th>Yds</th>
            <th>Avg</th>
            <th>TD</th>
            <th>Long</th>
            <th title="Yards after the catch">YAC</th>
            <th>Drops</th>
            <th title="Contested catches won (a defender within a yard when the ball arrived)">Contested</th>
            <th>Grade</th>
          </tr>
        }
      >
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{r.tgt}</td>
            <td>{r.rec}</td>
            <td>{r0(r.yds)}</td>
            <td>{avg(r.yds, r.rec)}</td>
            <td>{r.td}</td>
            <td>{r0(r.long)}</td>
            <td>{r0(r.yac)}</td>
            <td>{r.drops}</td>
            <td>
              {r.contestedWon}/{r.contested}
            </td>
            <GradeCell s={gradeRec({ ...r, yds: r.yds * scale })} />
          </tr>
        ))}
      </Table>
      <p className="rep-note">Contested: caught / targets with a Beast within a yard when the ball got there. YAC: yards after the catch.</p>
    </div>
  );
}

const OL_ORDER = ['LT', 'LG', 'C', 'RG', 'RT'];

function OLine({ rec }: { rec: GameRecord }) {
  const b = rec.box;
  const line = rec.offense.filter((o) => OL_ORDER.includes(o.slot)).map((o) => b.ol[o.name] ?? { name: o.name, slot: o.slot, sacks: 0, pressures: 0, runReps: 0, runWins: 0 });
  const others = Object.values(b.ol).filter((l) => !line.some((x) => x.name === l.name));
  const rows = [...line, ...others];
  const pct = (w: number, n: number) => (n ? `${Math.round((w / n) * 100)}%` : '—');
  return (
    <div className="rep-stack">
      <h3>Offensive line</h3>
      <Table
        cols={6}
        head={
          <tr>
            <th>Pos</th>
            <th>Player</th>
            <th>Sacks allowed</th>
            <th>Pressures allowed</th>
            <th>Run blocks won</th>
            <th>Run-block win rate</th>
          </tr>
        }
      >
        {rows.map((l) => (
          <tr key={l.name}>
            <td className="dim">{l.slot}</td>
            <td>{l.name}</td>
            <td className={l.sacks ? 'bad' : ''}>{l.sacks}</td>
            <td>{l.pressures}</td>
            <td>
              {l.runWins}/{l.runReps}
            </td>
            <td>{pct(l.runWins, l.runReps)}</td>
          </tr>
        ))}
      </Table>
      <p className="rep-note">
        Unblocked: {plural(b.freeRushers.pressures, 'pressure')}, {plural(b.freeRushers.sacks, 'sack')}. A run block is won when the man he engaged doesn't shed him before the play is decided (2.5 s or the whistle).
      </p>
    </div>
  );
}

// ---- The Beasts ---------------------------------------------------------------------------

function Beasts({ rec }: { rec: GameRecord }) {
  const b = rec.box;
  const order = new Map(rec.beasts.map((x, i) => [x.name, i]));
  const rows = Object.values(b.def).sort((x, y) => (order.get(x.name) ?? 99) - (order.get(y.name) ?? 99));
  const best = rec.bestReceiver;
  const sh = best ? b.shadow[best] : undefined;
  const cover = best ? (b.covered[best] ?? {}) : {};
  const shadows = sh ? Object.entries(sh.by).sort((x, y) => y[1] - x[1]) : [];
  return (
    <div className="rep-cols wide-left">
      <section>
        <h3>The Beasts</h3>
        <Table
          cols={8}
          empty={rows.length ? false : 'No defensive plays.'}
          head={
            <tr>
              <th>Pos</th>
              <th>Player</th>
              <th>Tkl</th>
              <th>Sacks</th>
              <th>Press</th>
              <th>Int</th>
              <th title="Passes broken up">PBU</th>
              <th>Big hits</th>
            </tr>
          }
        >
          {rows.map((d) => (
            <tr key={d.name}>
              <td className="dim">
                {d.pos} <span className="sub">#{d.num}</span>
              </td>
              <td>{d.name}</td>
              <td>{d.tackles}</td>
              <td>{d.sacks}</td>
              <td>{d.pressures}</td>
              <td>{d.ints}</td>
              <td>{d.pbu}</td>
              <td className={d.bigHits ? 'hit' : ''}>{d.bigHits}</td>
            </tr>
          ))}
        </Table>
      </section>
      <section>
        <h3>Coverage snapshot</h3>
        {best && sh ? (
          <div className="shadow">
            <div className="shadow-head">
              Who shadowed <b>{best}</b>
            </div>
            <div className="shadow-sub">Nearest Beast when the ball came out, over {plural(sh.snaps, 'dropback')}</div>
            <ul>
              {shadows.map(([name, n]) => {
                const c = cover[name];
                return (
                  <li key={name}>
                    <span className="sh-name">{name}</span>
                    <span className="sh-bar">
                      <i style={{ width: `${(n / sh.snaps) * 100}%` }} />
                    </span>
                    <span className="sh-pct">{Math.round((n / sh.snaps) * 100)}%</span>
                    <span className="sh-line">{c ? `${plural(c.tgt, 'target')}, ${r0(c.yds)} yd` : ''}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="rep-note">{best ? `No dropbacks with ${best} out on a route.` : 'No dropbacks.'}</p>
        )}
      </section>
    </div>
  );
}

/** The report body for one tab (the parent draws the tabs and owns the scroll). */
export const GameReport = forwardRef<HTMLDivElement, { rec: GameRecord; tab: number; className?: string }>(function GameReport({ rec, tab, className = '' }, ref) {
  const t = REPORT_TABS[tab] ?? 'Summary';
  return (
    <div className={`rep-body ${className}`} ref={ref} key={t}>
      {t === 'Summary' ? <Summary rec={rec} /> : t === 'Passing & Rushing' ? <PassingRushing rec={rec} /> : t === 'Receiving' ? <Receiving rec={rec} /> : t === 'O-Line' ? <OLine rec={rec} /> : <Beasts rec={rec} />}
    </div>
  );
});

export function ReportTabs({ tab, onTab }: { tab: number; onTab: (i: number) => void }) {
  return (
    <div className="tabs rep-tabs">
      <span className="tab-key">Q</span>
      {REPORT_TABS.map((t, i) => (
        <button key={t} className={`tab ${i === tab ? 'is-active' : ''}`} onClick={() => onTab(i)} tabIndex={-1}>
          {t}
        </button>
      ))}
      <span className="tab-key">E</span>
    </div>
  );
}

/** "Sep 25, 7:42 PM". */
export function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
