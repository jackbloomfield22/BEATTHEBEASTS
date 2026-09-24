import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useApp } from '@/app/appStore';
import { useSettings } from '@/app/settings';
import { urlFlags } from '@/app/platform';
import { Audio } from '@/audio/audio';
import { inputLabel } from '@/input/actions';
import { practice, usePractice } from '@/game/practice';
import { latency } from '@/game/latency';
import { downLabel, spotLabel, START_DOWNS, START_SPOTS, startSituation } from '@/game/situation';
import { DEF_CALLS, HOT_ROUTES, playById, PLAYS, ROUTE_LABEL } from '@/sim';
import { routeOf } from '@/sim/ai';
import { useMenuNav } from '../nav';
import { Choice, Hints, MenuItem, SettingRow, useDevice } from '../components/controls';
import { PlayArt } from '../game/PlayArt';
import { hudDom, RING_LEN } from '../game/hudDom';
import '../styles/game.css';

// The Practice Field (GDD §4): free play against the Beasts. The play call is
// a full-screen overlay over the live stadium; the play itself runs with a
// light HUD (receiver icons, prompts, stamina); the result card offers the
// next snap, the same play again, or the way out.

export function PracticeScreen() {
  const stage = usePractice((s) => s.stage);
  const error = usePractice((s) => s.error);
  const difficulty = useSettings((s) => s.settings.gameplay.difficulty);

  useEffect(() => {
    practice.difficulty = difficulty;
  }, [difficulty]);
  useEffect(() => {
    void practice.enter(urlFlags.seed !== null ? Number(urlFlags.seed) : undefined);
    return () => practice.leave();
  }, []);

  if (error) return <div className="menu-screen"><div className="practice-loading">{error}</div></div>;
  return (
    <>
      {stage === 'loading' ? <div className="practice-loading">Loading the Beasts…</div> : null}
      {stage === 'call' ? <PlayCall /> : null}
      {stage === 'presnap' || stage === 'live' || stage === 'result' ? <PlayHud /> : null}
      {stage === 'result' ? <ResultPanel /> : null}
      {stage === 'paused' ? <PauseMenu /> : null}
    </>
  );
}

// ---- Play call ---------------------------------------------------------------

const COVERS = [{ value: 'random', label: 'Beasts choose' }, ...DEF_CALLS.map((d) => ({ value: d.id, label: d.name }))];

function PlayCall() {
  const ui = usePractice();
  const back = useApp((s) => s.back);
  const n = PLAYS.length;
  const [focus, setFocus] = useState(Math.max(0, PLAYS.findIndex((p) => p.id === ui.playId)));
  const [artPlay, setArtPlay] = useState(ui.playId);
  const rows = n + 3;
  const focusRow = (i: number) => {
    setFocus(i);
    if (i < n) setArtPlay(PLAYS[i]!.id);
  };
  const setStart = (spot: number, downs: number) => usePractice.setState({ startSpot: spot, startDowns: downs, situation: startSituation(spot, downs), seriesOver: false });
  const change = (i: number, d: number) => {
    if (i === n) setStart((ui.startSpot + d + START_SPOTS.length) % START_SPOTS.length, ui.startDowns);
    if (i === n + 1) setStart(ui.startSpot, (ui.startDowns + d + START_DOWNS.length) % START_DOWNS.length);
    if (i === n + 2) {
      const k = COVERS.findIndex((c) => c.value === ui.cover);
      usePractice.setState({ cover: COVERS[(k + d + COVERS.length) % COVERS.length]!.value });
    }
    if (i >= n) Audio.uiTick();
  };
  const confirm = (i: number) => {
    if (i < n) {
      Audio.uiSelect();
      practice.callPlay(PLAYS[i]!.id);
    } else change(i, 1);
  };
  useMenuNav({ count: rows, focus, setFocus: focusRow, onConfirm: confirm, onBack: back, onLeft: (i) => change(i, -1), onRight: (i) => change(i, 1) });
  const sit = ui.seriesOver ? startSituation(ui.startSpot, ui.startDowns) : ui.situation;
  const play = playById(artPlay);
  let lastFormation = '';
  return (
    <div className="menu-screen play-call">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">Practice Field</h1>
        <div className="call-sit">
          <span className="call-down">{downLabel(sit)}</span>
          <span className="call-spot">Ball on the {spotLabel(sit.los)}</span>
        </div>
      </header>
      <div className="call-body">
        <div className="call-list">
          {PLAYS.map((p, i) => {
            const head = p.formation.name !== lastFormation ? (lastFormation = p.formation.name) : null;
            return (
              <div key={p.id}>
                {head ? <div className="setting-header">{head}</div> : null}
                <MenuItem size="md" label={p.name} focused={focus === i} onHover={() => focusRow(i)} onClick={() => confirm(i)} />
              </div>
            );
          })}
          <div className="setting-header">Situation</div>
          <SettingRow label="Start at" focused={focus === n} onHover={() => focusRow(n)}>
            <Choice value={ui.startSpot} options={START_SPOTS.map((s, k) => ({ value: k, label: s.label }))} onChange={(v) => setStart(v, ui.startDowns)} />
          </SettingRow>
          <SettingRow label="Down" focused={focus === n + 1} onHover={() => focusRow(n + 1)}>
            <Choice value={ui.startDowns} options={START_DOWNS.map((s, k) => ({ value: k, label: s.label }))} onChange={(v) => setStart(ui.startSpot, v)} />
          </SettingRow>
          <SettingRow label="Coverage" focused={focus === n + 2} onHover={() => focusRow(n + 2)}>
            <Choice value={ui.cover} options={COVERS} onChange={(v) => usePractice.setState({ cover: v })} />
          </SettingRow>
        </div>
        <aside className="call-art" key={play.id}>
          <div className="detail-kicker">{play.formation.name}</div>
          <h2 className="detail-title">{play.name}</h2>
          <PlayArt play={play} />
          <p className="call-note">Numbers are the reads in order: the icon you press to throw to each receiver.</p>
        </aside>
      </div>
      <Hints
        items={[
          { kb: '↑↓', pad: 'D-Pad', label: 'Choose' },
          { kb: '←→', pad: 'D-Pad', label: 'Change' },
          { kb: 'Enter', pad: 'A', label: 'Call play' },
          { kb: 'Esc', pad: 'B', label: 'Main menu' },
        ]}
      />
    </div>
  );
}

// ---- In-play HUD -------------------------------------------------------------

const ICON_COLOR: Record<string, string> = { WR: '#00e5ff', TE: '#bd6bff', RB: '#ff2a6d', QB: '#ffd400' };
const PAD_GLYPH = ['A', 'B', 'X', 'Y', 'RB'];
const PAD_SHAPE = ['▼', '●', '■', '▲', '◆'];

/** The three catches, in their key order (1, 2, 3 on the keyboard). */
const CATCHES = [
  { type: 'aggressive', action: 'air.aggressive', name: 'Go up and get it', sub: 'Aggressive' },
  { type: 'possession', action: 'air.possession', name: 'Secure it, go down', sub: 'Possession' },
  { type: 'rac', action: 'air.rac', name: 'Catch and run', sub: 'Run after catch' },
] as const;

/** The key (or button) bound to an action, for prompts. */
function useKey() {
  const kb = useSettings((s) => s.settings.controls.keyboard);
  const pad = useSettings((s) => s.settings.controls.gamepad);
  const device = useDevice();
  return (action: string) => {
    const list = device === 'gamepad' ? pad[action] : kb[action];
    return list?.[0] ? inputLabel(list[0]) : '—';
  };
}

function PlayHud() {
  const ui = usePractice();
  const device = useDevice();
  const colorblind = useSettings((s) => s.settings.accessibility.colorblind !== 'off');
  const key = useKey();
  // The four move keys as one label (↑←↓→ by default), or the stick.
  const moveKeys = (p: string) =>
    device === 'gamepad' ? 'L-Stick' : (p === 'carrier.' ? ['up', 'left', 'down', 'right'] : ['Up', 'Left', 'Down', 'Right']).map((d) => key(p + d)).join('');
  const runner = practice.runner;
  const icons = runner ? runner.state.icons.map((i) => runner.state.agents[i]!) : [];
  const phase = ui.phase;
  const inPocket = phase === 'snap' || phase === 'dropback' || phase === 'pocket';
  const live = ui.stage === 'live';
  const pad = device === 'gamepad';
  return (
    <div className="play-hud">
      <div className="bug">
        <span className="bug-mark">B</span>
        <span className="bug-down">{downLabel(ui.playSit)}</span>
        <span className="bug-spot">{spotLabel(ui.playSit.los)}</span>
        <span className="bug-play">{runner ? runner.state.setup.play.name : ''}</span>
      </div>
      <div className="icon-layer">
        {icons.map((a, k) => (
          <div key={k} className="rec-icon" data-open="none" ref={(el) => void (hudDom.icons[k] = el)} style={{ ['--c' as string]: ICON_COLOR[a.p.pos] ?? '#fff' }}>
            <svg className="rec-ring" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="17" className="ring-base" />
              <circle cx="20" cy="20" r="17" className="ring-charge" ref={(el) => void (hudDom.rings[k] = el)} strokeDasharray={RING_LEN} strokeDashoffset={RING_LEN} />
            </svg>
            <span className="rec-glyph">{pad ? (colorblind ? PAD_SHAPE[k] : PAD_GLYPH[k]) : key(`pocket.throw${k + 1}`)}</span>
            <span className="rec-name">{a.p.name.split(' ').slice(-1)[0]}</span>
          </div>
        ))}
        <div className="aim-reticle" ref={(el) => void (hudDom.reticle = el)} />
        {/* Under the ball carrier, the whole time he has it: stamina and his moves. */}
        <div className="carrier-hud" ref={(el) => void (hudDom.carrierHud = el)}>
          <div className="stamina" ref={(el) => void (hudDom.stamina = el)}>
            <span className="stamina-fill" ref={(el) => void (hudDom.staminaFill = el)} />
          </div>
          <div className="carrier-keys">
            <span><kbd>{pad ? 'R-Stick ←→' : key('carrier.juke')}</kbd>Juke</span>
            <span><kbd>{key('carrier.stiffArm')}</kbd>Stiff arm</span>
            <span><kbd>{key('carrier.spin')}</kbd>Spin</span>
            <span><kbd>{key('carrier.sprint')}</kbd>Sprint</span>
          </div>
        </div>
      </div>
      {ui.stage === 'presnap' && !ui.hot ? (
        <div className="snap-call">
          <div className="snap-key">
            <kbd>{key('preSnap.snap')}</kbd> Snap
          </div>
          <div className="snap-sub">
            {pad ? 'A B X Y RB' : `${key('pocket.throw1')}–${key('pocket.throw5')}`} are your receivers, in read order
          </div>
          <div className="snap-more">
            <span>
              Hold <kbd>{key('preSnap.routes')}</kbd> to see the routes
            </span>
            <span>
              <kbd>{key('preSnap.hotRoute')}</kbd> Hot route
            </span>
          </div>
        </div>
      ) : null}
      {ui.stage === 'presnap' && ui.hot ? <HotRoutePicker /> : null}
      {live && inPocket ? (
        <div className="prompt-row">
          <span><kbd>{moveKeys('pocket.move')}</kbd> Move</span>
          <span><kbd>{pad ? 'A B X Y RB' : `${key('pocket.throw1')}–${key('pocket.throw5')}`}</kbd> Throw: tap for touch, hold for a bullet</span>
          <span>{pad ? 'Left stick while holding: placement' : 'Mouse off the icon: placement'}</span>
          <span><kbd>{key('pocket.pumpFake')}</kbd> Pump</span>
          <span><kbd>{key('pocket.throwAway')}</kbd> Throw away</span>
          <span className="legend"><i className="dot open" /> open <i className="dot covered" /> covered</span>
        </div>
      ) : null}
      {live && phase === 'air' ? <CatchCall called={ui.catchType} keyOf={key} /> : null}
      {live && phase === 'carrier' && ui.carrier ? (
        <div className="prompt-row">
          <span><kbd>{moveKeys('carrier.')}</kbd> Run</span>
          <span><kbd>{key('carrier.truck')}</kbd> Truck</span>
          <span><kbd>{key('carrier.dive')}</kbd> Dive</span>
          <span><kbd>{key('carrier.protect')}</kbd> Protect (hold)</span>
        </div>
      ) : null}
      <Tutorial />
    </div>
  );
}

/**
 * The first-play tutorial card: one line per step, under the score bug, with
 * the keys as they're bound for the device in use. It follows the play and
 * never waits for the player.
 */
function Tutorial() {
  const step = usePractice((s) => s.tutorial);
  const device = useDevice();
  const key = useKey();
  if (!step) return null;
  const pad = device === 'gamepad';
  const k = (a: string) => <kbd>{key(a)}</kbd>;
  const lit = (label: string) => <kbd>{label}</kbd>;
  const body: Record<string, ReactNode> = {
    snap: (
      <>
        Press {k('preSnap.snap')} to snap the ball.
      </>
    ),
    read: <>Read the field while you drop back. A glowing icon is an open man; a dim one is covered.</>,
    throw: (
      <>
        {pad ? 'Press his button' : <>Press {lit(`${key('pocket.throw1')}–${key('pocket.throw5')}`)}</>} to throw to him: tap for touch, hold for a bullet.{' '}
        {pad ? 'The left stick' : 'The mouse off his icon'} places it; the ring on the field is where it lands.
      </>
    ),
    catch: (
      <>
        Call the catch while it's in the air: {k('air.aggressive')} go up and get it, {k('air.possession')} secure it, {k('air.rac')} catch and run. Slowed down this once.
      </>
    ),
    run: (
      <>
        Run with {pad ? lit('L-Stick') : lit(['up', 'left', 'down', 'right'].map((d) => key(`carrier.${d}`)).join(''))}, {k('carrier.sprint')} to sprint. {pad ? lit('R-Stick ←→') : k('carrier.juke')} juke,{' '}
        {k('carrier.stiffArm')} stiff arm, {k('carrier.spin')} spin.
      </>
    ),
  };
  const order = ['snap', 'read', 'throw', 'catch', 'run'];
  return (
    <div className="tutorial-card" data-step={step}>
      <span className="tutorial-step">
        {order.indexOf(step) + 1}/{order.length}
      </span>
      <span className="tutorial-text">{body[step]}</span>
    </div>
  );
}

/**
 * The hot-route picker: first which receiver (his number), then his new
 * route from the list (its number, or up/down and confirm; on a gamepad the
 * D-pad and A). The route art on the field previews the focused route.
 */
function HotRoutePicker() {
  const hot = usePractice((s) => s.hot);
  const device = useDevice();
  const key = useKey();
  const runner = practice.runner;
  if (!hot || !runner) return null;
  const s = runner.state;
  const pad = device === 'gamepad';
  if (hot.stage === 'receiver') {
    return (
      <div className="hot-picker">
        <div className="hot-head">Hot route</div>
        <div className="hot-sub">
          Which receiver? {pad ? 'His button' : <kbd>{`${key('hot.n1')}–${key(`hot.n${s.icons.length}`)}`}</kbd>}
        </div>
        <div className="hot-foot">
          <kbd>{key('hot.cancel')}</kbd> Close
        </div>
      </div>
    );
  }
  const a = s.agents[s.icons[hot.icon - 1]!]!;
  const current = routeOf(s, a);
  return (
    <div className="hot-picker">
      <div className="hot-head">
        {a.p.name} <span className="hot-now">now: {current ? ROUTE_LABEL[current] : ''}</span>
      </div>
      <ol className="hot-list">
        {HOT_ROUTES.map((r, i) => (
          <li key={r} className={`hot-item${i === hot.focus ? ' focus' : ''}${r === current ? ' current' : ''}`} onMouseEnter={() => usePractice.setState({ hot: { ...hot, focus: i } })} onClick={() => practice.pickHot(hot.icon, r)}>
            {pad ? null : <kbd>{key(`hot.n${i + 1}`)}</kbd>}
            <span>{ROUTE_LABEL[r]}</span>
          </li>
        ))}
      </ol>
      <div className="hot-foot">
        {pad ? (
          <>
            <kbd>D-Pad</kbd> choose <kbd>A</kbd> call <kbd>B</kbd> back
          </>
        ) : (
          <>
            <kbd>{key('hot.confirm')}</kbd> call <kbd>{key('hot.cancel')}</kbd> close
          </>
        )}
      </div>
    </div>
  );
}

/** The catch call: large and centered the moment the ball is thrown; the called one lights up. */
function CatchCall({ called, keyOf }: { called: string | null; keyOf: (action: string) => string }) {
  useLayoutEffect(() => {
    if (called) latency.respond('catch');
  }, [called]);
  return (
    <div className="catch-call" data-called={called ?? 'none'}>
      <div className="catch-head">{called ? 'Catch called' : 'Call the catch'}</div>
      <div className="catch-opts">
        {CATCHES.map((c) => (
          <div key={c.type} className={`catch-opt${called === c.type ? ' on' : called ? ' off' : ''}`}>
            <kbd>{keyOf(c.action)}</kbd>
            <span className="catch-name">{c.name}</span>
            <span className="catch-sub">{c.sub}</span>
          </div>
        ))}
      </div>
      {!called ? <div className="catch-foot">No call: catch and run</div> : null}
    </div>
  );
}

// ---- Result and pause --------------------------------------------------------

function ResultPanel() {
  const ui = usePractice();
  const back = useApp((s) => s.back);
  const [focus, setFocus] = useState(0);
  const items = [
    { label: 'Next play', run: () => practice.nextPlay() },
    { label: 'Run it back', run: () => practice.runItBack() },
    { label: 'Leave practice', run: () => back() },
  ];
  const confirm = (i: number) => {
    Audio.uiSelect();
    items[i]!.run();
  };
  useMenuNav({ count: items.length, focus, setFocus, onConfirm: confirm, onBack: () => confirm(0), onAlt: () => confirm(1) });
  const r = ui.result;
  if (!r) return null;
  const next = ui.seriesOver ? `Series over. Back to ${downLabel(startSituation(ui.startSpot, ui.startDowns))} on the ${spotLabel(START_SPOTS[ui.startSpot]!.los)}.` : `Next: ${downLabel(ui.situation)} on the ${spotLabel(ui.situation.los)}.`;
  return (
    <div className={`result-card tone-${r.tone}`}>
      <div className="result-kicker">{ui.lastCover ? `The Beasts played ${ui.lastCover}` : 'Result'}</div>
      <h2 className="result-head">{r.headline}</h2>
      <p className="result-detail">{r.detail}</p>
      <p className="result-next">{next}</p>
      <nav className="result-actions">
        {items.map((it, i) => (
          <MenuItem key={it.label} size="md" label={it.label} focused={focus === i} onHover={() => setFocus(i)} onClick={() => confirm(i)} />
        ))}
      </nav>
    </div>
  );
}

function PauseMenu() {
  const back = useApp((s) => s.back);
  const [focus, setFocus] = useState(0);
  const items = [
    { label: 'Resume', run: () => practice.resume() },
    { label: 'Restart play', run: () => practice.runItBack() },
    { label: 'Call a new play', run: () => practice.abandon() },
    usePractice.getState().tutorial
      ? { label: 'Skip the tutorial', run: () => (practice.skipTutorial(), practice.resume()) }
      : { label: practice.tutorialPending ? 'Tutorial on next play' : 'Show the tutorial next play', run: () => (practice.replayTutorial(), practice.resume()) },
    { label: 'Leave practice', run: () => back() },
  ];
  const confirm = (i: number) => {
    Audio.uiSelect();
    items[i]!.run();
  };
  useMenuNav({ count: items.length, focus, setFocus, onConfirm: confirm, onBack: () => confirm(0) });
  return (
    <div className="menu-screen pause">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">Paused</h1>
      </header>
      <nav className="menu-list">
        {items.map((it, i) => (
          <MenuItem key={it.label} label={it.label} focused={focus === i} onHover={() => setFocus(i)} onClick={() => confirm(i)} />
        ))}
      </nav>
      <Hints items={[{ kb: 'Enter', pad: 'A', label: 'Select' }, { kb: 'Esc', pad: 'B', label: 'Resume' }]} />
    </div>
  );
}
