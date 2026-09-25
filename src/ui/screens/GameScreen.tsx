import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/app/appStore';
import { viewRecord } from '@/app/history';
import { urlFlags } from '@/app/platform';
import { Audio } from '@/audio/audio';
import { game, useGame } from '@/game/game';
import { canVictoryFormation, clockLabel, fgDistance, fgMakePct, type Match } from '@/game/match';
import { reasonFor } from '@/game/coordinator';
import { practice, usePractice } from '@/game/practice';
import { downLabel, spotLabel } from '@/game/situation';
import { aimFor } from '@/game/kick';
import { PLAY_TYPE_LABEL, PLAYS, playById, suggestPlays, type PlayType } from '@/sim';
import { Input } from '@/input/InputManager';
import { kickView, KICK_CONTACT } from '@/render/game/kickView';
import { useMenuNav } from '../nav';
import { Hints, MenuItem } from '../components/controls';
import { PlayArt } from '../game/PlayArt';
import { PlayHud } from './PracticeScreen';
import '../styles/game.css';
import '../styles/match.css';
import '../styles/results.css';

// A full game (GDD §7) over the live stadium: the score bug, the Beasts'
// "Meanwhile" possessions, the play call with the coordinator's Suggested
// tab, each snap with the Practice Field's HUD, fourth-down decisions,
// tries, field goals with the drag kick and the wind, punts, the
// two-minute drill's clock and overtime. The game ends on the results screen.

/** To the results screen, on this game's record (saved when the match ended). */
function toResults(): void {
  const rec = useGame.getState().record;
  viewRecord(rec?.id ?? null, 'game');
  if (useApp.getState().screen === 'game') useApp.getState().go('results');
}

/** Stages a card is up on (the pause menu can come up over them); a snap pauses in the play engine. */
const PAUSABLE = new Set(['call', 'fourth', 'try', 'meanwhile', 'play']);
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
      if (id !== 'global.pause' || info.repeat || justResumed) return;
      const g = useGame.getState();
      const ps = usePractice.getState().stage;
      if (g.paused || ps === 'paused') return resumeGame();
      if (!PAUSABLE.has(g.stage)) return;
      if (g.stage === 'play' && (ps === 'presnap' || ps === 'live')) practice.pause();
      else game.pause();
    });
  }, []);
  const showPause = paused || (stage === 'play' && snapPaused);
  return (
    <div className="game-screen">
      {stage === 'loading' ? <div className="practice-loading">Kickoff…</div> : null}
      {stage !== 'loading' ? <ScoreBug /> : null}
      {!paused ? (
        <>
          {stage === 'meanwhile' ? <Meanwhile /> : null}
          {stage === 'call' ? <GamePlayCall /> : null}
          {stage === 'play' ? <GamePlay /> : null}
          {stage === 'fourth' ? <FourthCard /> : null}
          {stage === 'try' ? <TryCard /> : null}
        </>
      ) : null}
      {stage === 'kick' ? <KickPanel /> : null}
      {stage === 'punt' ? <PuntCut /> : null}
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
  return (
    <div className="score-bug">
      <div className="sb-team us">
        <span className="sb-name">Contenders</span>
        <span className="sb-score">{m.score.user}</span>
      </div>
      <div className="sb-team them">
        <span className="sb-name">Beasts</span>
        <span className="sb-score">{m.score.beasts}</span>
      </div>
      <div className="sb-clock">
        <span>{clockLabel(m)}</span>
        {m.clock.live ? (
          <span className="sb-tos" title="Timeouts">
            {[0, 1, 2].map((i) => (
              <i key={i} className={i < m.clock.timeouts ? 'on' : ''} />
            ))}
          </span>
        ) : null}
      </div>
      {onField ? (
        <div className="sb-down">
          {m.phase === 'twoPoint' ? 'Two-point try' : downLabel(sit)} <span>{spotLabel(sit.los)}</span>
        </div>
      ) : (
        <div className="sb-down dim">
          Round {Math.min(m.round, m.cfg.drives)} of {m.cfg.drives}
        </div>
      )}
      <Wind m={m} />
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

// ---- Meanwhile -----------------------------------------------------------------------

const RESULT_LINE: Record<string, string> = {
  TD: 'Touchdown',
  FG: 'Field goal',
  Punt: 'Punt',
  Turnover: 'Turnover',
  Downs: 'Stopped on downs',
  Safety: 'Safety',
  MissedFG: 'Missed field goal',
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
      <div className="mw-next">{ot ? 'Your answer from their 25.' : `Your ball on the ${spotLabel(d.nextStart)}.`}</div>
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
  // The coordinator's five (sim/coordinator.ts: down, distance, field, clock and this roster's strengths), each with the coach's reason.
  const sugg = useMemo(() => {
    const team = practice.teams?.team;
    const opts = { twoMinute: m.clock.live, clockRunning: m.lastWhistle === 'runs' };
    const ids = team ? suggestPlays({ down: sit.down, toGo: sit.toGo, los: sit.los, secondsLeft: m.clock.live ? m.clock.secs : undefined, scoreDiff: m.score.user - m.score.beasts }, team) : [];
    return ids.map((id) => playById(id)).map((play) => ({ play, why: reasonFor(sit, opts, play) }));
  }, [sit, m.clock.live, m.clock.secs, m.lastWhistle, m.score.user, m.score.beasts]);
  const [group, setGroup] = useState(0);
  const g = GROUPS[group]!;
  const plays = g === 'suggested' ? sugg.map((s) => s.play) : PLAYS.filter((p) => p.type === g && (p.situ !== 'short' || sit.toGo <= 1) && (!p.hailMary || (m.clock.live && m.clock.secs <= 10)));
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
  const live = m.clock.live;
  const victory = canVictoryFormation(m);
  return (
    <div className="menu-screen play-call game-call">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">{twoPoint ? 'Two-point try' : downLabel(sit)}</h1>
        <div className="tabs">
          <span className="tab-key">Q</span>
          {GROUPS.map((x, i) => (
            <button key={x} className={`tab ${i === group ? 'is-active' : ''}`} onClick={() => switchGroup(i - group)} tabIndex={-1}>
              {x === 'suggested' ? 'Suggested' : PLAY_TYPE_LABEL[x]}
            </button>
          ))}
          <span className="tab-key">E</span>
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
            <MenuItem key={p.id} size="md" label={p.name} tag={p.formation.name} focused={focus === i} onHover={() => setFocus(i)} onClick={() => call(i)} />
          ))}
        </div>
        <aside className="call-art" key={cur.id}>
          <div className="detail-kicker">{cur.formation.name}</div>
          <h2 className="detail-title">{cur.name}</h2>
          <PlayArt play={cur} />
          <p className="call-note">{why ?? (cur.run ? 'A designed run: the back takes the handoff; you run it from there.' : 'Numbers are the reads in order: the key you press to throw to each receiver.')}</p>
        </aside>
      </div>
      {note ? <div className="clock-note">{note}</div> : null}
      <Hints
        items={[
          { kb: 'Q / E', pad: 'LB / RB', label: 'Play type' },
          { kb: '↑↓', pad: 'D-Pad', label: 'Choose' },
          { kb: 'Enter', pad: 'A', label: 'Call play' },
          ...(live ? [{ kb: 'T', pad: '—', label: 'Timeout' }, { kb: 'K', pad: '—', label: 'Spike' }] : []),
          ...(live || victory ? [{ kb: 'J', pad: '—', label: victory ? 'Victory formation' : 'Kneel' }] : []),
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
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, onConfirm: () => game.afterResult() });
  if (!r) return null;
  const head = outcome && OUTCOME[outcome] ? OUTCOME[outcome] : r.headline;
  const next =
    m.phase === 'drive' ? `${downLabel(m.sit)} on the ${spotLabel(m.sit.los)}` : m.phase === 'fourth' ? `4th & ${Math.max(1, Math.round(m.sit.toGo))}: decision` : m.phase === 'try' ? 'The try' : m.phase === 'final' ? 'Final' : 'The Beasts take over';
  return (
    <div className={`result-card tone-${r.tone}`}>
      <div className="result-kicker">{head === r.headline ? 'Result' : head}</div>
      <h2 className="result-head">{r.headline}</h2>
      <p className="result-detail">{r.detail}</p>
      <nav className="result-actions">
        <MenuItem size="md" label={`Continue: ${next}`} focused onHover={() => undefined} onClick={() => game.afterResult()} />
      </nav>
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
    { id: 'punt', label: 'Punt', sub: 'About 41 yards net' },
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

const DRAG_PX = 260; // a full-power pull, in CSS px
const AIM_MAX = 0.2; // rad at a full sideways pull

/**
 * The drag kick (GDD §9.6): press on the ball and pull back like a sling;
 * the length of the pull is the power, its sideways lean the aim (pull
 * left, the ball goes right). Past full power the strike slices. On the
 * keyboard or a pad: left and right aim, hold confirm to build power,
 * release to kick.
 */
function KickPanel() {
  const k = useGame((s) => s.kick);
  const m = game.match!;
  const [drag, setDrag] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [aim, setAim] = useState(0);
  const [power, setPower] = useState(0);
  const [reveal, setReveal] = useState(false);
  const charging = useRef(false);
  const done = useRef(false);
  useEffect(() => {
    kickView.active = true;
    kickView.spotX = m.sit.los - 7;
    kickView.path = null;
    kickView.t = 0;
    return () => {
      kickView.active = false;
      kickView.path = null;
    };
  }, [m]);
  const strike = (p: number, a: number) => {
    if (done.current) return;
    done.current = true;
    Audio.uiSelect();
    const res = game.strike(p, a);
    kickView.path = res.path;
    kickView.t = 0;
    // The snap and hold, then the flight; the call shows as it reaches the posts.
    setTimeout(() => setReveal(true), urlFlags.shot ? 100 : (KICK_CONTACT + res.hang * 0.75) * 1000);
    setTimeout(() => game.endKick(), urlFlags.shot ? 200 : (KICK_CONTACT + res.hang + 1.6) * 1000);
  };
  // Keyboard and pad: aim with left/right; hold confirm to build power, release to kick.
  useEffect(() => {
    let raf = 0;
    let t0 = 0;
    let p = 0;
    let a = 0;
    // The press and the release are timed from the input events, not the
    // frames, so a long frame can't swallow a quick hold.
    const tick = () => {
      if (charging.current) {
        const held = Input.isHeld('menu.confirm');
        const end = held ? performance.now() : Input.releasedAt('menu.confirm');
        p = Math.min(1.12, Math.max(0, end - t0) / 1300);
        setPower(p);
        if (!held) {
          charging.current = false;
          strike(p, a);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const off = Input.onAction((id, info) => {
      if (id === 'menu.confirm') {
        if (!info.repeat && !charging.current && !done.current) {
          charging.current = true;
          t0 = info.time;
        }
        return;
      }
      if (id === 'menu.left') a = Math.min(AIM_MAX, a + 0.01);
      else if (id === 'menu.right') a = Math.max(-AIM_MAX, a - 0.01);
      else return;
      setAim(a);
    });
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
     
  }, []);
  // Dev and the browser tests: ?autokick lines it up and strikes it.
  useEffect(() => {
    if (!(import.meta.env.DEV && new URLSearchParams(location.search).has('autokick')) || !k) return;
    const t = setTimeout(() => strike(0.95, aimFor({ distance: k.distance, power: 0.95, range: m.cfg.kickerRange, wind: m.wind })), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!k) return null;
  const dp = drag ? Math.hypot(drag.x - drag.x0, drag.y - drag.y0) / DRAG_PX : power;
  const da = drag ? Math.max(-AIM_MAX, Math.min(AIM_MAX, ((drag.x - drag.x0) / DRAG_PX) * AIM_MAX)) : aim;
  const res = k.result;
  return (
    <div
      className="kick-panel"
      onPointerDown={(e) => !done.current && setDrag({ x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY })}
      onPointerMove={(e) => drag && setDrag({ ...drag, x: e.clientX, y: e.clientY })}
      onPointerUp={() => {
        if (drag) strike(dp, da);
        setDrag(null);
      }}
    >
      <div className="kick-info">
        <div className="result-kicker">{k.kind === 'PAT' ? 'Extra point' : 'Field goal'}</div>
        <h2 className="result-head">{Math.round(k.distance)} yards</h2>
        <div className="kick-pct">{Math.round(k.pct * 100)}% for a clean strike</div>
      </div>
      {!res || !reveal ? (
        <div className="kick-meter" style={res ? { opacity: 0.35 } : undefined}>
          <div className="km-power">
            <span style={{ height: `${Math.min(1, dp) * 100}%` }} className={dp > 1 ? 'over' : ''} />
          </div>
          <div className="km-aim">
            <span style={{ transform: `rotate(${(-da * 180) / Math.PI}deg)` }} />
          </div>
        </div>
      ) : (
        <div className={`kick-result ${res.good ? 'good' : 'bad'}`}>{res.good ? "It's good!" : { short: 'Short', wideLeft: 'Wide left', wideRight: 'Wide right', doink: 'Off the upright', good: '' }[res.why]}</div>
      )}
      <Hints
        items={[
          { kb: 'Drag', pad: '—', label: 'Pull back to kick' },
          { kb: '← →', pad: 'D-Pad', label: 'Aim' },
          { kb: 'Hold Space', pad: 'Hold A', label: 'Power' },
        ]}
      />
    </div>
  );
}

// ---- Punt and final ------------------------------------------------------------------

function PuntCut() {
  const p = useGame((s) => s.punt);
  useEffect(() => {
    const t = setTimeout(() => game.endPunt(), urlFlags.shot ? 200 : 2600);
    return () => clearTimeout(t);
  }, []);
  if (!p) return null;
  const land = p.spot + p.yards;
  return (
    <div className="meanwhile stopped">
      <div className="mw-kicker">Punt</div>
      <div className="mw-line">
        <span className="mw-result">{p.yards} yards net</span>
      </div>
      <div className="mw-meta">{land >= 80 ? 'Touchback: the Beasts take over at their 20.' : `Downed at the Beasts' ${100 - land}.`}</div>
    </div>
  );
}

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
      <Hints items={[{ kb: 'Enter', pad: 'A', label: 'Results' }]} />
    </div>
  );
}

