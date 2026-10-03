import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/app/appStore';
import { viewRecord } from '@/app/history';
import { urlFlags } from '@/app/platform';
import { Audio } from '@/audio/audio';
import { game, useGame } from '@/game/game';
import { canVictoryFormation, clockLabel, clockText, fgDistance, fgMakePct, halfSecs, hurry, isTimed, quarterName, type Match } from '@/game/match';
import { reasonFor } from '@/game/coordinator';
import { practice, usePractice } from '@/game/practice';
import { replay, snapFlag, useReplay } from '@/game/replaySession';
import { downLabel, spotLabel } from '@/game/situation';
import { aimFor, powerNeeded, PUNT_DEPTH } from '@/game/kick';
import { KickControl, METER, METER_MAX, strikeWord, type Strike } from '@/game/kickMeter';
import { PLAY_TYPE_LABEL, PLAYS, playById, suggestPlays, type DefSlot, type PlayType } from '@/sim';
import { Input } from '@/input/InputManager';
import { contactFor, kickView } from '@/render/game/kickView';
import { useMenuNav } from '../nav';
import { Hints, KeyCap, MenuItem, useDevice } from '../components/controls';
import { TabKey } from '../components/Glyph';
import { PlayArt } from '../game/PlayArt';
import { PlayHud, readsNote } from './PracticeScreen';
import { ReplayCue, ReplayHud, useReplayKey } from '../game/ReplayHud';
import '../styles/game.css';
import '../styles/match.css';
import '../styles/results.css';

// A full game (GDD §7) over the live stadium: the score bug (quarter, game
// clock, play clock), the Beasts' "Meanwhile" possessions, the play call
// with the coordinator's Suggested tab, each snap with the Practice Field's
// HUD, fourth-down decisions, tries, kicks (aim, then hold and release in
// the window: PATs, field goals and punts), the clock's banners and the
// delay-of-game flag, halftime, the two-minute drill and overtime. The game
// ends on the results screen.

/** To the results screen, on this game's record (saved when the match ended). */
function toResults(): void {
  const rec = useGame.getState().record;
  viewRecord(rec?.id ?? null, 'game');
  if (useApp.getState().screen === 'game') useApp.getState().go('results');
}

/** Stages a card is up on (the pause menu can come up over them); a snap pauses in the play engine. */
const PAUSABLE = new Set(['call', 'fourth', 'try', 'meanwhile', 'play', 'penalty', 'break']);
let justResumed = false;
function resumeGame(): void {
  justResumed = true;
  queueMicrotask(() => (justResumed = false));
  if (usePractice.getState().stage === 'paused') practice.resume();
  game.resume();
}

export function GameScreen() {
  const stage = useGame((s) => s.stage);
  const paused = useGame((s) => s.paused);
  const snapPaused = usePractice((s) => s.stage === 'paused');
  // The final whistle, then the results: on a timer, or sooner with Enter (FinalBanner).
  useEffect(() => {
    if (stage === 'final') {
      const t = setTimeout(toResults, urlFlags.shot ? 0 : 2400);
      return () => clearTimeout(t);
    }
  }, [stage]);
  // Esc (Start on a pad) brings the pause menu up over a card; a snap is paused by the play engine.
  useEffect(() => {
    return Input.onAction((id, info) => {
      // (Esc is also menu.back: the pause menu's Back may have just resumed on this same press.)
      // In a replay Esc goes back to the result card (replaySession.ts).
      if (id !== 'global.pause' || info.repeat || justResumed || replay.active) return;
      const g = useGame.getState();
      const ps = usePractice.getState().stage;
      if (g.paused || ps === 'paused') return resumeGame();
      if (!PAUSABLE.has(g.stage)) return;
      if (g.stage === 'play' && (ps === 'presnap' || ps === 'live')) practice.pause();
      else game.pause();
    });
  }, []);
  const showPause = paused || (stage === 'play' && snapPaused);
  // The instant replay (M7) keeps the screen clean: no score bug or clock banners over it.
  const replayOpen = useReplay((s) => s.open);
  useEffect(() => () => replay.abort(), []);
  return (
    <div className="game-screen">
      {stage === 'loading' ? <div className="practice-loading">Kickoff…</div> : null}
      {stage !== 'loading' && !replayOpen ? <ScoreBug /> : null}
      {!paused ? (
        <>
          {stage === 'pregame' ? <PreGame /> : null}
          {stage === 'meanwhile' ? <Meanwhile /> : null}
          {stage === 'call' ? <GamePlayCall /> : null}
          {stage === 'play' ? <GamePlay /> : null}
          {stage === 'fourth' ? <FourthCard /> : null}
          {stage === 'try' ? <TryCard /> : null}
          {stage === 'penalty' ? <PenaltyCard /> : null}
          {stage === 'break' ? <HalftimeCard /> : null}
          {replayOpen ? null : <ClockFlag />}
        </>
      ) : null}
      {stage === 'kick' ? <KickPanel /> : null}
      {stage === 'final' ? <FinalBanner /> : null}
      {showPause ? <GamePause /> : null}
    </div>
  );
}

// ---- Pause ---------------------------------------------------------------------------

/**
 * The pause menu (Esc / Start): resume, or leave the game. Leaving ends it
 * where it stands and goes to its results (a snap whose whistle has already
 * blown still counts, so leaving after the last play is a proper final).
 */
function GamePause() {
  useGame((s) => s.v);
  const m = game.match;
  const [focus, setFocus] = useState(0);
  const over = m?.phase === 'final';
  const items = [
    { label: 'Resume', sub: '', run: resumeGame },
    {
      label: over ? 'See the results' : 'Leave game',
      sub: over ? 'The game is over' : 'The game ends here and goes in your History with its box score',
      run: () => {
        game.quitToResults();
        toResults();
      },
    },
  ];
  const pick = (i: number) => {
    Audio.uiSelect();
    items[i]!.run();
  };
  useMenuNav({ count: items.length, focus, setFocus, onConfirm: pick, onBack: resumeGame });
  return (
    <div className="menu-screen pause game-pause">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">Paused</h1>
        {m ? (
          <div className="call-sit">
            <span className="call-down">
              Contenders {m.score.user}, Beasts {m.score.beasts}
            </span>
            <span className="call-spot">{clockLabel(m)}</span>
          </div>
        ) : null}
      </header>
      <nav className="menu-list">
        {items.map((it, i) => (
          <MenuItem key={it.label} label={it.label} sub={focus === i ? it.sub : undefined} focused={focus === i} onHover={() => setFocus(i)} onClick={() => pick(i)} />
        ))}
      </nav>
      <Hints
        items={[
          { kb: 'Enter', pad: 'A', label: 'Select' },
          { kb: 'Esc', pad: 'B', label: 'Resume' },
        ]}
      />
    </div>
  );
}

// ---- Score bug -----------------------------------------------------------------------

function ScoreBug() {
  useGame((s) => s.v);
  const m = game.match;
  if (!m) return null;
  const sit = m.sit;
  const onField = m.phase === 'drive' || m.phase === 'fourth' || m.phase === 'twoPoint';
  const timed = isTimed(m);
  const pc = m.playClock;
  // The game clock ticks between plays only when it's running (and a snap is due).
  const running = m.clock.live && m.lastWhistle === 'runs' && pc !== null;
  const final = m.phase === 'final';
  const q = final ? (m.ot ? `F/${m.ot > 1 ? `${m.ot}OT` : 'OT'}` : 'FINAL') : m.ot ? (m.ot > 1 ? `${m.ot}OT` : 'OT') : `Q${m.clock.quarter}`;
  const showTime = !final && !m.ot;
  return (
    <div className="score-bug">
      <div className="sb-team us">
        <span className="sb-name">Contenders</span>
        <span className="sb-score">{m.score.user}</span>
        {m.clock.live && !final ? (
          <span className="sb-tos" title="Timeouts">
            {[0, 1, 2].map((i) => (
              <i key={i} className={i < m.clock.timeouts ? 'on' : ''} />
            ))}
          </span>
        ) : null}
      </div>
      <div className="sb-team them">
        <span className="sb-name">Beasts</span>
        <span className="sb-score">{m.score.beasts}</span>
      </div>
      <div className="sb-clock">
        <span className="sb-q">{q}</span>
        {showTime ? <span className={`sb-time ${running ? 'running' : 'stopped'}`}>{clockText(m.clock.secs)}</span> : null}
        {pc !== null && !final ? (
          <span className={`sb-play ${pc <= 5 ? 'hot' : ''}`} title="Play clock">
            :{String(Math.max(0, pc)).padStart(2, '0')}
          </span>
        ) : null}
      </div>
      {onField ? (
        <div className="sb-down">
          {m.phase === 'twoPoint' ? 'Two-point try' : downLabel(sit)} <span>{spotLabel(sit.los)}</span>
        </div>
      ) : timed ? (
        <div className="sb-down dim">{final ? 'Final' : m.ot ? 'Overtime' : `${quarterName(m.clock.quarter)} quarter`}</div>
      ) : (
        <div className="sb-down dim">
          Round {Math.min(m.round, m.cfg.drives)} of {m.cfg.drives}
        </div>
      )}
      <Wind m={m} />
    </div>
  );
}

/** The clock's banner under the score bug: the two-minute warning, the end of a quarter. */
function ClockFlag() {
  const flag = useGame((s) => s.flag);
  useEffect(() => {
    if (!flag) return;
    const t = setTimeout(() => useGame.getState().flag === flag && useGame.setState({ flag: null }), urlFlags.shot ? 60_000 : 3200);
    return () => clearTimeout(t);
  }, [flag]);
  if (!flag) return null;
  return (
    <div className={`clock-flag ev-${flag.event}`} key={flag.at}>
      {flag.line}
    </div>
  );
}

/** Points by quarter (a timed game): Q1–Q4, OT when it went there, the total. */
function LineScore({ m, upTo }: { m: Match; upTo?: number }) {
  const n = upTo ?? 4;
  const cols = [...Array.from({ length: n }, (_, i) => i), ...(m.ot && upTo === undefined ? [4] : [])];
  return (
    <table className="linescore">
      <thead>
        <tr>
          <th />
          {cols.map((i) => (
            <th key={i}>{i === 4 ? 'OT' : i + 1}</th>
          ))}
          <th>T</th>
        </tr>
      </thead>
      <tbody>
        {(['user', 'beasts'] as const).map((side) => (
          <tr key={side} className={side}>
            <td>{side === 'user' ? 'Contenders' : 'Beasts'}</td>
            {cols.map((i) => (
              <td key={i}>{m.byQuarter[side][i] ?? 0}</td>
            ))}
            <td className="tot">{m.score[side]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The flag: delay of game. Five yards, the down again; the play clock is reset to 25. */
function PenaltyCard() {
  const line = useGame((s) => s.penalty);
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, onConfirm: () => game.afterPenalty(), onBack: () => game.afterPenalty() });
  return (
    <div className="decision-card penalty-card">
      <div className="flag-icon" aria-hidden="true" />
      <div className="result-kicker">Flag</div>
      <h2 className="result-head">Delay of game</h2>
      <p className="result-detail">{line}</p>
      <p className="call-note">The play clock ran out before the snap. Snap it sooner, or take a timeout (T).</p>
      <nav className="result-actions">
        <MenuItem size="md" label="Back to the huddle" focused onHover={() => undefined} onClick={() => game.afterPenalty()} />
      </nav>
    </div>
  );
}

/** Halftime: the score by quarter, and you get the ball to start the second half. */
function HalftimeCard() {
  useGame((s) => s.v);
  const m = game.match;
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, onConfirm: () => game.afterBreak(), onBack: () => game.afterBreak() });
  if (!m) return null;
  return (
    <div className="decision-card halftime-card">
      <div className="result-kicker">Halftime</div>
      <h2 className="result-head">
        Contenders {m.score.user}, Beasts {m.score.beasts}
      </h2>
      <LineScore m={m} upTo={2} />
      <p className="call-note">The Beasts took the opening kickoff: you get the ball to start the second half, from your 25. Three timeouts again.</p>
      <nav className="result-actions">
        <MenuItem size="md" label="Second half" focused onHover={() => undefined} onClick={() => game.afterBreak()} />
      </nav>
    </div>
  );
}

function Wind({ m }: { m: Match }) {
  // The arrow points where the wind blows, relative to the posts you attack (up the screen).
  const deg = (-m.wind.dir * 180) / Math.PI;
  return (
    <div className="sb-wind" title="Wind">
      <span className="wind-arrow" style={{ transform: `rotate(${deg}deg)` }}>
        ↑
      </span>
      {m.wind.mph} mph
    </div>
  );
}

// ---- Pre-game -----------------------------------------------------------------------

/** How long the pre-game holds before a press can kick off (a press from the walk-out never carries over). */
const KICKOFF_ARM_MS = 900;
const BEAST_ORDER: DefSlot[] = ['LE', 'LDT', 'RDT', 'RE', 'WLB', 'MLB', 'SLB', 'LCB', 'FS', 'SS', 'RCB'];

/**
 * The pre-game moment (Playtest 1): after the walk-out, the field with both
 * teams set, the Beasts' eleven, the scoreboard, and nothing happens until an
 * explicit press to kick off. The press only counts once the card has been
 * up for KICKOFF_ARM_MS, and a held key's repeats never count, so a button
 * mashed through the walk-out can't run anything.
 */
function PreGame() {
  const m = game.match;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), urlFlags.shot ? 0 : KICKOFF_ARM_MS);
    return () => clearTimeout(t);
  }, []);
  const kick = () => {
    if (!armed) return;
    Audio.uiSelect();
    game.kickoff();
  };
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, enabled: armed, onConfirm: kick });
  const beasts = practice.teams?.beasts.base;
  if (!m) return null;
  return (
    <div className="pregame">
      <div className="pg-card">
        <div className="pg-kicker">
          Pre-game · {m.cfg.drives} rounds · Wind {m.wind.mph} mph
        </div>
        <h2 className="pg-head">
          Contenders <span className="pg-vs">vs</span> <span className="pg-beasts">The Beasts</span>
        </h2>
        <p className="pg-sub">The Beasts get the ball first. Your drive starts after their possession.</p>
        {beasts ? (
          <ul className="pg-lineup">
            {BEAST_ORDER.map((k) => (
              <li key={k}>
                <span className="pg-pos">{beasts[k].pos}</span>
                <span className="pg-name">{beasts[k].name}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button className={`pg-kick ${armed ? 'is-armed' : ''}`} tabIndex={-1} onClick={kick}>
        <KeyCap kb="Enter" pad="A" className="pg-key" />
        <span>Kick off</span>
      </button>
    </div>
  );
}

// ---- Meanwhile -----------------------------------------------------------------------

const RESULT_LINE: Record<string, string> = {
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

function Meanwhile() {
  const d = useGame((s) => s.meanwhile);
  const m = game.match;
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, onConfirm: () => game.endMeanwhile(), onBack: () => game.endMeanwhile() });
  useEffect(() => {
    const t = setTimeout(() => game.endMeanwhile(), urlFlags.shot ? 400 : 5600);
    return () => clearTimeout(t);
  }, [d]);
  if (!d || !m) return null;
  const scored = d.points > 0;
  const ot = m.ot > 0;
  return (
    <div className={`meanwhile ${scored ? 'scored' : 'stopped'}`}>
      <div className="mw-kicker">{ot ? `Overtime ${m.ot}` : 'Meanwhile…'}</div>
      <div className="mw-line">
        <span className="mw-team">The Beasts</span>
        <span className="mw-result">{RESULT_LINE[d.result]}</span>
        {d.points ? <span className="mw-pts">+{d.points}</span> : null}
      </div>
      <div className="mw-meta">
        {d.plays} {d.plays === 1 ? 'play' : 'plays'}, {Math.max(0, Math.round(d.yards))} yd, {d.top}
        {d.twoPoint ? ` · two-point try ${d.twoPoint.good ? 'good' : 'failed'}` : ''}
        {d.result === 'Safety' ? ' · +2 Contenders' : ''}
      </div>
      <div className="mw-next">{ot ? 'Your answer from their 25.' : d.result === 'EndOfHalf' ? 'Halftime: you receive the second half.' : d.result === 'EndOfGame' ? (m.score.beasts + d.points > m.score.user ? 'They kneel it out.' : 'The end of regulation.') : `Your ball on the ${spotLabel(d.nextStart)}.`}</div>
      <Hints items={[{ kb: 'Enter', pad: 'A', label: 'Skip' }]} />
    </div>
  );
}

// ---- Play call -----------------------------------------------------------------------

const GROUPS: (PlayType | 'suggested')[] = ['suggested', 'quick', 'dropback', 'shot', 'playAction', 'screen', 'run'];

function GamePlayCall() {
  useGame((s) => s.v);
  const note = useGame((s) => s.note);
  const m = game.match!;
  const sit = m.sit;
  const twoPoint = m.phase === 'twoPoint';
  const rush = hurry(m);
  // The coordinator's ten, ranked (Playtest 2; sim/coordinator.ts: down, distance, field, clock and this roster's strengths), each with the coach's reason.
  const sugg = useMemo(() => {
    const team = practice.teams?.team;
    const opts = { twoMinute: rush, clockRunning: m.lastWhistle === 'runs' };
    const ids = team ? suggestPlays({ down: sit.down, toGo: sit.toGo, los: sit.los, secondsLeft: m.clock.live ? halfSecs(m) : undefined, scoreDiff: m.score.user - m.score.beasts }, team) : [];
    return ids.map((id) => playById(id)).map((play) => ({ play, why: reasonFor(sit, opts, play) }));
    // The clock's seconds only matter to the suggestions in the hurry-up; re-reading every tick would reshuffle the list under the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sit, m.clock.live, m.lastWhistle, m.score.user, m.score.beasts, m.clock.quarter, rush]);
  const [group, setGroup] = useState(0);
  const g = GROUPS[group]!;
  const plays = g === 'suggested' ? sugg.map((s) => s.play) : PLAYS.filter((p) => p.type === g && (p.situ !== 'short' || sit.toGo <= 1) && (!p.hailMary || (m.clock.live && halfSecs(m) <= 10)));
  const [focus, setFocus] = useState(0);
  const cur = plays[Math.min(focus, plays.length - 1)]!;
  const why = g === 'suggested' ? sugg[Math.min(focus, sugg.length - 1)]?.why : null;
  const call = (i: number) => {
    Audio.uiSelect();
    practice.callPlay(plays[i]!.id);
    useGame.setState({ stage: 'play', note: null });
  };
  const switchGroup = (d: number) => {
    Audio.uiTick();
    setGroup((group + d + GROUPS.length) % GROUPS.length);
    setFocus(0);
  };
  useMenuNav({ count: plays.length, focus, setFocus, onConfirm: call, onTabPrev: () => switchGroup(-1), onTabNext: () => switchGroup(1) });
  // On a pad the clock calls are on the play call's free buttons (T, K and J on the keyboard are global).
  useEffect(() => {
    return Input.onAction((id, info) => {
      if (info.device !== 'gamepad' || info.repeat) return;
      if (id === 'menu.alt') game.timeout();
      else if (id === 'menu.alt2') game.spike();
      else if (id === 'menu.alt3') game.kneel();
    });
  }, []);
  const pad = useDevice() === 'gamepad';
  const live = m.clock.live;
  const victory = canVictoryFormation(m);
  return (
    <div className="menu-screen play-call game-call">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">{twoPoint ? 'Two-point try' : downLabel(sit)}</h1>
        <div className="tabs">
          <TabKey dir="prev" />
          {GROUPS.map((x, i) => (
            <button key={x} className={`tab ${i === group ? 'is-active' : ''}`} onClick={() => switchGroup(i - group)} tabIndex={-1}>
              {x === 'suggested' ? 'Suggested' : PLAY_TYPE_LABEL[x]}
            </button>
          ))}
          <TabKey dir="next" />
        </div>
        <div className="call-sit">
          <span className="call-down">Ball on the {spotLabel(sit.los)}</span>
          <span className="call-spot">
            {clockLabel(m)}
            {live ? ` · ${m.clock.timeouts} ${m.clock.timeouts === 1 ? 'timeout' : 'timeouts'}` : ''}
          </span>
        </div>
      </header>
      <div className="call-body">
        <div className="call-list">
          <div className="setting-header">{g === 'suggested' ? 'Your coordinator' : PLAY_TYPE_LABEL[g]}</div>
          {plays.map((p, i) => (
            <MenuItem
              key={p.id}
              size="md"
              label={g === 'suggested' ? `${i + 1}. ${p.name}` : p.name}
              tag={g === 'suggested' ? `${p.type === 'run' ? 'Run' : PLAY_TYPE_LABEL[p.type]} · ${p.formation.name}` : p.formation.name}
              focused={focus === i}
              onHover={() => setFocus(i)}
              onClick={() => call(i)}
            />
          ))}
        </div>
        <aside className="call-art" key={cur.id}>
          <div className="detail-kicker">{cur.formation.name}</div>
          <h2 className="detail-title">{cur.name}</h2>
          <PlayArt play={cur} />
          <p className="call-note">{why ?? (cur.run ? 'A designed run: the back takes the handoff; you run it from there.' : readsNote(pad))}</p>
        </aside>
      </div>
      {note ? <div className="clock-note">{note}</div> : null}
      <Hints
        items={[
          { kb: 'Q / E', pad: 'LB / RB', label: 'Play type' },
          { kb: '↑↓', pad: 'D-Pad', label: 'Choose' },
          { kb: 'Enter', pad: 'A', label: 'Call play' },
          ...(live ? [{ kb: 'T', pad: 'Y', label: 'Timeout' }, { kb: 'K', pad: 'X', label: 'Spike' }] : []),
          ...(live || victory ? [{ kb: 'J', pad: 'LT', label: victory ? 'Victory formation' : 'Kneel' }] : []),
        ]}
      />
    </div>
  );
}

// ---- The snap ------------------------------------------------------------------------

const OUTCOME: Record<string, string> = {
  firstDown: 'First down',
  touchdown: 'Touchdown!',
  turnover: 'Turnover',
  downs: 'Turnover on downs',
  safety: 'Safety',
  pickSix: 'Pick six',
  twoPointGood: 'Two-point try good',
  twoPointFailed: 'Two-point try fails',
  timeExpired: 'Time expires',
};

function GamePlay() {
  const stage = usePractice((s) => s.stage);
  const replayOpen = useReplay((s) => s.open);
  if (replayOpen) return <ReplayHud />;
  return (
    <>
      {stage === 'presnap' || stage === 'live' || stage === 'result' ? <PlayHud bug={false} /> : null}
      {stage === 'result' ? <GameResult /> : null}
    </>
  );
}

function GameResult() {
  const r = usePractice((s) => s.result);
  const outcome = useGame((s) => s.outcome);
  const m = game.match!;
  // The instant replay (M7): Continue stays first; a flagged play leads the card with its replay until it's watched.
  const flag = r ? snapFlag() : null;
  const watched = useReplay((s) => s.watched) === practice.playId;
  const watch = () => void replay.openSnap();
  useReplayKey(watch);
  const [focus, setFocus] = useState(0);
  const pick = (i: number) => (i === 0 ? game.afterResult() : watch());
  useMenuNav({ count: 2, focus, setFocus, columns: 2, onConfirm: pick });
  if (!r) return null;
  const head = outcome && OUTCOME[outcome] ? OUTCOME[outcome] : r.headline;
  const next =
    m.phase === 'drive' ? `${downLabel(m.sit)} on the ${spotLabel(m.sit.los)}` : m.phase === 'fourth' ? `4th & ${Math.max(1, Math.round(m.sit.toGo))}: decision` : m.phase === 'try' ? 'The try' : m.phase === 'final' ? 'Final' : 'The Beasts take over';
  return (
    <div className={`result-card tone-${r.tone}`}>
      <div className="result-kicker">{head === r.headline ? 'Result' : head}</div>
      <h2 className="result-head">{r.headline}</h2>
      <p className="result-detail">{r.detail}</p>
      {flag && !watched ? (
        <div className="replay-offer">
          <span className="ro-tag">{flag.label}</span>
          <ReplayCue label="Watch the replay" onClick={watch} />
        </div>
      ) : null}
      <nav className="result-actions">
        <MenuItem size="md" label={`Continue: ${next}`} focused={focus === 0} onHover={() => setFocus(0)} onClick={() => pick(0)} />
        <MenuItem size="md" label="Replay" focused={focus === 1} onHover={() => setFocus(1)} onClick={() => pick(1)} />
      </nav>
      {!flag || watched ? (
        <div className="result-replay">
          <ReplayCue label="Replay" onClick={watch} />
        </div>
      ) : null}
    </div>
  );
}

// ---- Decisions -----------------------------------------------------------------------

function FourthCard() {
  useGame((s) => s.v);
  const m = game.match!;
  const dist = fgDistance(m.sit.los);
  const pct = fgMakePct(m, dist);
  const items = [
    { id: 'go', label: `Go for it (4th & ${Math.max(1, Math.round(m.sit.toGo))})`, sub: '' },
    { id: 'punt', label: 'Punt', sub: 'Your punter: aim it, then hold and release' },
    ...(pct > 0 ? [{ id: 'fg', label: `Field goal: ${Math.round(dist)} yd`, sub: `${Math.round(pct * 100)}% with this leg and wind` }] : []),
  ] as { id: 'go' | 'punt' | 'fg'; label: string; sub: string }[];
  const [focus, setFocus] = useState(items.length > 2 && m.sit.los >= 60 ? 2 : m.sit.toGo <= 1 && m.sit.los >= 45 ? 0 : 1);
  const pick = (i: number) => {
    Audio.uiSelect();
    game.fourth(items[i]!.id);
  };
  useMenuNav({ count: items.length, focus, setFocus, onConfirm: pick });
  return (
    <div className="decision-card">
      <div className="result-kicker">Fourth down</div>
      <h2 className="result-head">
        4th & {Math.max(1, Math.round(m.sit.toGo))} on the {spotLabel(m.sit.los)}
      </h2>
      <nav className="result-actions">
        {items.map((it, i) => (
          <MenuItem key={it.id} size="md" label={it.label} sub={it.sub} focused={focus === i} onHover={() => setFocus(i)} onClick={() => pick(i)} />
        ))}
      </nav>
      <Hints items={[{ kb: '↑↓', pad: 'D-Pad', label: 'Choose' }, { kb: 'Enter', pad: 'A', label: 'Decide' }]} />
    </div>
  );
}

function TryCard() {
  useGame((s) => s.v);
  const m = game.match!;
  const items = [
    { two: false, label: 'Kick the extra point', sub: `33 yd · ${Math.round(fgMakePct(m, 33) * 100)}%` },
    { two: true, label: 'Go for two', sub: 'One play from the 3' },
  ];
  const [focus, setFocus] = useState(0);
  const pick = (i: number) => {
    Audio.uiSelect();
    game.try(items[i]!.two);
  };
  useMenuNav({ count: 2, focus, setFocus, onConfirm: pick });
  return (
    <div className="decision-card">
      <div className="result-kicker">Touchdown</div>
      <h2 className="result-head">
        Contenders {m.score.user}, Beasts {m.score.beasts}
      </h2>
      <nav className="result-actions">
        {items.map((it, i) => (
          <MenuItem key={it.label} size="md" label={it.label} sub={it.sub} focused={focus === i} onHover={() => setFocus(i)} onClick={() => pick(i)} />
        ))}
      </nav>
    </div>
  );
}

// ---- The kick ------------------------------------------------------------------------

/** Mouse aim: rad per pixel of sideways movement (250 px is a field goal's full aim). */
const MOUSE_AIM = 0.0008;

const WHY_LINE: Record<string, string> = { good: "It's good!", short: 'Short', wideLeft: 'Wide left', wideRight: 'Wide right', doink: 'Off the upright' };
const PUNT_HOW: Record<string, string> = { returned: 'Returned', fairCatch: 'Fair catch', outOfBounds: 'Out of bounds', touchback: 'Touchback', downed: 'Downed' };

/** "Wind 9 mph, left to right", relative to your kick (0 = at your back). */
function windWords(w: { mph: number; dir: number }): string {
  if (w.mph <= 1) return 'No wind';
  const c = Math.cos(w.dir);
  const sn = Math.sin(w.dir);
  const along = c > 0.5 ? 'at your back' : c < -0.5 ? 'in your face' : '';
  const across = sn > 0.5 ? 'right to left' : sn < -0.5 ? 'left to right' : '';
  return `Wind ${w.mph} mph${along || across ? ', ' : ''}${[along, across].filter(Boolean).join(' and ')}`;
}

/**
 * The kick (Playtest 2): aim first (arrows, the D-pad or the left stick,
 * or the mouse), with the aim line and the wind on the field; then hold
 * (Space, A or the mouse button) to charge and let go with the fill inside
 * the green window as it slides up and down the meter. The same for PATs,
 * field goals and punts. The press and release are timed from their own
 * input events (src/game/kickMeter.ts), the meter is drawn per frame
 * straight to the DOM.
 */
function KickPanel() {
  const k = useGame((s) => s.kick);
  const m = game.match!;
  const kind = k?.kind ?? 'FG';
  const tuning = METER[practice.difficulty];
  const ctl = useRef<KickControl | null>(null);
  const fillEl = useRef<HTMLDivElement>(null);
  const winEl = useRef<HTMLDivElement>(null);
  const aimEl = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<'aim' | 'charge' | 'struck'>('aim');
  const [strikeInfo, setStrikeInfo] = useState<Strike | null>(null);
  const [reveal, setReveal] = useState(false);
  // How much leg this one needs (the meter's mark): a field goal or PAT straight down the middle in this wind.
  const need = useMemo(() => (k && k.kind !== 'PUNT' ? powerNeeded({ distance: k.distance, range: m.cfg.kickerRange, wind: m.wind }) : null), [k?.kind, k?.distance, m]); // eslint-disable-line react-hooks/exhaustive-deps
  const doStrike = (st: Strike) => {
    const c = ctl.current!;
    kickView.aiming = false;
    const fl = game.strike(st.power, c.aim + st.error);
    Audio.kickThump(contactFor(kind), st.clean);
    kickView.path = fl.path;
    kickView.t = 0;
    setStrikeInfo(st);
    setPhase('struck');
    const contact = contactFor(kind);
    // The snap and the hold (or the punter's catch and steps), then the flight; the call comes as it lands.
    setTimeout(
      () => {
        setReveal(true);
        const kk = useGame.getState().kick;
        Audio.kickCrowd(kk?.punt ? kk.punt.net >= 38 || kk.punt.how === 'outOfBounds' : !!kk?.result?.good);
      },
      urlFlags.shot ? 100 : (contact + fl.hang * (kind === 'PUNT' ? 1 : 0.75)) * 1000,
    );
    // (The capture harness ends it itself: its frames are too slow for a timer.)
    if (!urlFlags.shot) setTimeout(() => game.endKick(), (contact + fl.hang + (kind === 'PUNT' ? 2.6 : 1.6)) * 1000);
  };
  useEffect(() => {
    if (!k) return;
    kickView.active = true;
    kickView.kind = k.kind;
    kickView.spotX = k.kind === 'PUNT' ? m.sit.los - PUNT_DEPTH : m.sit.los - 7;
    kickView.distance = k.distance;
    kickView.wind = { ...m.wind };
    kickView.aim = 0;
    kickView.aiming = true;
    kickView.path = null;
    kickView.t = 0;
    const c = new KickControl(k.kind, tuning, performance.now());
    ctl.current = c;
    // The capture specs (tools/shots/clockkick.spec.ts) set the aim, freeze the meter at a moment (__btbKickNow) and strike at a time.
    if (import.meta.env.DEV)
      Object.assign(globalThis, {
        __btbKick: c,
        __btbKickPress: (t: number) => c.press(t) && setPhase('charge'),
        __btbKickStrike: (t: number) => {
          const st = c.release(t);
          if (st) doStrike(st);
        },
      });
    const pop = Input.pushContext('kick');
    const offDown = Input.onAction((id, info) => {
      if (id !== 'kick.charge' || info.repeat || useGame.getState().paused) return;
      if (c.press(info.time)) setPhase('charge');
    });
    const offUp = Input.onRelease((id, info) => {
      if (id !== 'kick.charge') return;
      const st = c.release(info.time);
      if (st) doStrike(st);
    });
    const onMove = (e: PointerEvent) => c.steer(0, 0, -e.movementX * MOUSE_AIM);
    window.addEventListener('pointermove', onMove);
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Dev: a frozen meter for a still (the capture harness's frames are seconds long).
      const frozen = import.meta.env.DEV ? (globalThis as { __btbKickNow?: number }).__btbKickNow : undefined;
      if (frozen !== undefined) now = frozen;
      else if (!useGame.getState().paused) {
        // Aim: the keys and D-pad (+ = left), and the left stick's analog x.
        const dir = (Input.isHeld('kick.aimLeft') ? 1 : 0) - (Input.isHeld('kick.aimRight') ? 1 : 0) - Input.sticks.left.x;
        c.steer(Math.max(-1, Math.min(1, dir)), dt);
        const auto = c.frame(now);
        if (auto) doStrike(auto);
      }
      kickView.aim = c.aim;
      const mtr = c.meter(now);
      if (fillEl.current) fillEl.current.style.height = `${(mtr.fill / METER_MAX) * 100}%`;
      if (winEl.current) winEl.current.style.bottom = `${((mtr.window - tuning.half) / METER_MAX) * 100}%`;
      if (aimEl.current) {
        const deg = (c.aim * 180) / Math.PI;
        aimEl.current.textContent = Math.abs(deg) < 0.25 ? 'Aim: straight' : `Aim: ${Math.abs(deg).toFixed(1)}° ${deg > 0 ? 'left' : 'right'}`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      offDown();
      offUp();
      pop();
      window.removeEventListener('pointermove', onMove);
      kickView.active = false;
      kickView.aiming = false;
      kickView.path = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, k?.kind]);
  // Dev and the browser tests: ?autokick lines it up and strikes it cleanly.
  useEffect(() => {
    if (!(import.meta.env.DEV && new URLSearchParams(location.search).has('autokick')) || !k) return;
    const t = setTimeout(() => {
      const c = ctl.current;
      if (!c || c.phase !== 'aim') return;
      const power = k.kind === 'PUNT' ? 0.95 : Math.min(1.02, Math.max(0.9, (need ?? 0.9) + 0.04));
      c.phase = 'struck';
      c.aim = k.kind === 'PUNT' ? 0 : aimFor({ distance: k.distance, power, range: m.cfg.kickerRange, wind: m.wind });
      doStrike({ power, error: 0, off: 0, clean: true, heldMs: power * tuning.fillMs });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!k) return null;
  const res = k.result;
  const pr = k.punt;
  const title = k.kind === 'PAT' ? 'Extra point' : k.kind === 'FG' ? 'Field goal' : 'Punt';
  return (
    <div className="kick-panel">
      <div className="kick-info">
        <div className="result-kicker">{title}</div>
        <h2 className="result-head">{k.kind === 'PUNT' ? `From the ${spotLabel(m.sit.los)}` : `${Math.round(k.distance)} yards`}</h2>
        <div className="kick-pct">{k.kind === 'PUNT' ? 'Power is distance. Aim for the sideline to kill the return.' : `${Math.round(k.pct * 100)}% for a clean strike`}</div>
        <div className="kick-wind">
          <span className="wind-arrow" style={{ transform: `rotate(${(-m.wind.dir * 180) / Math.PI}deg)` }}>
            ↑
          </span>
          {windWords(m.wind)}
        </div>
        <span className="kick-aim" ref={aimEl}>
          Aim: straight
        </span>
      </div>
      <div className={`kick-meter2 ${phase}`}>
        <div className="km2-label">Power</div>
        <div className="km2-bar">
          <div className="km2-over" style={{ bottom: `${(1 / METER_MAX) * 100}%` }} />
          {need !== null && need < METER_MAX ? <div className="km2-need" style={{ bottom: `${(need / METER_MAX) * 100}%` }} title="Enough leg to get there" /> : null}
          <div className="km2-window" ref={winEl} style={{ height: `${((tuning.half * 2) / METER_MAX) * 100}%` }} />
          <div className="km2-fill" ref={fillEl} />
        </div>
        <div className="km2-steps">
          <span className={phase === 'aim' ? 'on' : 'done'}>1 · Aim</span>
          <span className={phase === 'charge' ? 'on' : phase === 'struck' ? 'done' : ''}>2 · Hold</span>
          <span className={phase === 'struck' ? 'on' : ''}>3 · Release in the green</span>
        </div>
        {strikeInfo ? <div className={`km2-word ${strikeInfo.clean ? 'clean' : 'miss'}`}>{strikeWord(strikeInfo)}</div> : null}
      </div>
      {reveal && res ? <div className={`kick-result ${res.good ? 'good' : 'bad'}`}>{WHY_LINE[res.why]}</div> : null}
      {reveal && pr ? (
        <div className="kick-result punt">
          <span>{pr.gross}-yard punt</span>
          <small>
            {PUNT_HOW[pr.how]}
            {pr.how === 'returned' ? ` ${pr.ret} ${pr.ret === 1 ? 'yard' : 'yards'}` : ''} · {pr.how === 'touchback' ? "Beasts' ball on their 20" : `Beasts' ball on their ${pr.beastsStart}`} · net {pr.net}
          </small>
        </div>
      ) : null}
      {phase === 'struck' ? null : (
      <Hints
        items={
          phase === 'aim'
            ? [
                { kb: '← →  or mouse', pad: 'D-Pad / L-Stick', label: 'Aim' },
                { kb: 'Hold Space / click', pad: 'Hold A', label: 'Charge' },
              ]
            : [{ kb: 'Release', pad: 'Release A', label: 'Strike in the green' }]
        }
      />
      )}
    </div>
  );
}

// ---- Final ---------------------------------------------------------------------------

/** The final whistle: the score holds a beat, then the results (Enter goes now). */
function FinalBanner() {
  const rec = useGame((s) => s.record);
  const m = game.match;
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, onConfirm: toResults });
  const score = m?.score ?? rec?.score;
  if (!score) return null;
  return (
    <div className="meanwhile final">
      <div className="mw-kicker">{m ? clockLabel(m) : (rec?.clock ?? 'Final')}</div>
      <div className="mw-line">
        <span className="mw-team">Contenders {score.user}</span>
        <span className="mw-result">Beasts {score.beasts}</span>
      </div>
      {m && isTimed(m) ? <LineScore m={m} /> : null}
      <Hints items={[{ kb: 'Enter', pad: 'A', label: 'Results' }]} />
    </div>
  );
}

