import { useEffect, useState } from 'react';
import { useApp } from '@/app/appStore';
import { useSettings } from '@/app/settings';
import { urlFlags } from '@/app/platform';
import { Audio } from '@/audio/audio';
import { inputLabel } from '@/input/actions';
import { practice, usePractice } from '@/game/practice';
import { downLabel, spotLabel, START_DOWNS, START_SPOTS, startSituation } from '@/game/situation';
import { DEF_CALLS, playById, PLAYS } from '@/sim';
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
  const runner = practice.runner;
  const icons = runner ? runner.state.icons.map((i) => runner.state.agents[i]!) : [];
  const phase = ui.phase;
  const inPocket = phase === 'snap' || phase === 'dropback' || phase === 'pocket';
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
          <div key={k} className="rec-icon" ref={(el) => void (hudDom.icons[k] = el)} style={{ ['--c' as string]: ICON_COLOR[a.p.pos] ?? '#fff' }}>
            <svg className="rec-ring" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="17" className="ring-base" />
              <circle cx="20" cy="20" r="17" className="ring-charge" ref={(el) => void (hudDom.rings[k] = el)} strokeDasharray={RING_LEN} strokeDashoffset={RING_LEN} />
            </svg>
            <span className="rec-glyph">{device === 'gamepad' ? (colorblind ? PAD_SHAPE[k] : PAD_GLYPH[k]) : k + 1}</span>
            <span className="rec-name">{a.p.name.split(' ').slice(-1)[0]}</span>
          </div>
        ))}
        <div className="aim-reticle" ref={(el) => void (hudDom.reticle = el)} />
      </div>
      <div className="stamina" ref={(el) => void (hudDom.stamina = el)}>
        <span className="stamina-fill" ref={(el) => void (hudDom.staminaFill = el)} />
      </div>
      {ui.stage === 'presnap' ? (
        <div className="prompt">
          <kbd>{key('preSnap.snap')}</kbd> Snap
        </div>
      ) : null}
      {ui.stage === 'live' && inPocket ? (
        <div className="prompt-row">
          <span><kbd>{device === 'gamepad' ? 'A B X Y RB' : '1–5'}</kbd> Throw: tap for touch, hold for a bullet</span>
          <span>{device === 'gamepad' ? 'Left stick while holding: placement' : 'Mouse off the icon: placement'}</span>
          <span><kbd>{key('pocket.pumpFake')}</kbd> Pump</span>
          <span><kbd>{key('pocket.throwAway')}</kbd> Throw away</span>
        </div>
      ) : null}
      {ui.stage === 'live' && phase === 'air' ? (
        <div className="prompt-row catch">
          <span><kbd>{key('air.aggressive')}</kbd> Aggressive</span>
          <span><kbd>{key('air.rac')}</kbd> Run after catch</span>
          <span><kbd>{key('air.possession')}</kbd> Possession</span>
        </div>
      ) : null}
      {ui.stage === 'live' && phase === 'carrier' && ui.carrier ? (
        <div className="prompt-row">
          <span><kbd>{key('carrier.sprint')}</kbd> Sprint</span>
          <span><kbd>{key('carrier.jukeLeft')}</kbd><kbd>{key('carrier.jukeRight')}</kbd> Juke</span>
          <span><kbd>{key('carrier.spin')}</kbd> Spin</span>
          <span><kbd>{key('carrier.stiffArm')}</kbd> Stiff arm</span>
          <span><kbd>{key('carrier.truck')}</kbd> Truck</span>
          <span><kbd>{key('carrier.dive')}</kbd> Dive</span>
          <span><kbd>{key('carrier.protect')}</kbd> Protect</span>
        </div>
      ) : null}
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
