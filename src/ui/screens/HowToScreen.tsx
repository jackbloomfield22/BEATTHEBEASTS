import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/app/appStore';
import { useSettings } from '@/app/settings';
import { ACTIONS, CONTEXT_LABELS, inputLabel, type InputContext } from '@/input/actions';
import { Audio } from '@/audio/audio';
import { useMenuNav } from '../nav';
import { Hints, useDevice } from '../components/controls';

// Reference pages. The interactive tutorial arrives with core play; these
// pages already reflect the live keybinds, including rebinds.

const PAGES = ['The Game', 'The Draft', 'Controls'] as const;

export function HowToScreen() {
  const back = useApp((s) => s.back);
  const setShot = useApp((s) => s.setShot);
  const [page, setPage] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setShot('history');
  }, [setShot]);

  const scroll = (d: number) => scroller.current?.scrollBy({ top: d * 120, behavior: 'smooth' });
  useMenuNav({
    count: 1,
    focus: 0,
    setFocus: () => undefined,
    onBack: back,
    onTabPrev: () => { Audio.uiTick(); setPage((p) => (p + PAGES.length - 1) % PAGES.length); },
    onTabNext: () => { Audio.uiTick(); setPage((p) => (p + 1) % PAGES.length); },
    onLeft: () => { Audio.uiTick(); setPage((p) => (p + PAGES.length - 1) % PAGES.length); },
    onRight: () => { Audio.uiTick(); setPage((p) => (p + 1) % PAGES.length); },
  });
  // Up/down scroll the page.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'ArrowDown' || e.code === 'KeyS') scroll(1);
      if (e.code === 'ArrowUp' || e.code === 'KeyW') scroll(-1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    // Braces matter: scrollTo returns a Promise in current Chrome, and an
    // effect that returns it hands React a "cleanup" that isn't a function
    // (it threw on the first page change: the How to Play → The Draft crash).
    scroller.current?.scrollTo({ top: 0 });
  }, [page]);

  return (
    <div className="menu-screen howto-screen">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">How to Play</h1>
        <div className="tabs">
          <span className="tab-key">Q</span>
          {PAGES.map((p, i) => (
            <button key={p} className={`tab ${i === page ? 'is-active' : ''}`} onClick={() => setPage(i)} tabIndex={-1}>
              {p}
            </button>
          ))}
          <span className="tab-key">E</span>
        </div>
      </header>
      <div className="howto-body" ref={scroller}>
        {page === 0 ? <GamePage /> : page === 1 ? <DraftPage /> : <ControlsPage />}
      </div>
      <Hints items={[{ kb: 'Q / E', pad: 'LB / RB', label: 'Pages' }, { kb: '↑ ↓', pad: 'Stick', label: 'Scroll' }, { kb: 'Esc', pad: 'B', label: 'Back' }]} />
    </div>
  );
}

function GamePage() {
  return (
    <div className="prose">
      <p className="lead">The Beasts are an eleven-man defense built from the greatest defenders in football history, pulled from every era. Draft an all-time offense, then take the field and beat them yourself.</p>
      <h3>Possessions</h3>
      <p>A game is a set number of rounds: Quick 4, Standard 6, Full 10. Each round the Beasts' offense has the ball first (shown as a quick broadcast cut), then you get a drive. You always have the last word.</p>
      <h3>Your drives</h3>
      <p>Four downs to gain ten yards. Touchdowns, field goals, PATs and two-point tries work as they do on Sundays. Turnovers end the drive, and a pick-six or scoop-and-score adds seven to the Beasts. On fourth down you choose: go for it, punt, or kick.</p>
      <h3>The last drive</h3>
      <p>Trailing or tied on your final drive? The clock goes live: two minutes, three timeouts, spike and kneel. Tied at the end means overtime, college style from the 25.</p>
      <h3>The grade</h3>
      <p>Your margin of victory earns a grade, from Total Domination down to Beatdown.</p>
    </div>
  );
}

function DraftPage() {
  return (
    <div className="prose">
      <p className="lead">Nine rounds. Each round the slot machine lands on a team and a decade, and you fill any open position from that roster.</p>
      <ul>
        <li>Roster: QB, two RBs, three WRs, two TEs and an offensive line.</li>
        <li>One Team Skip (keep the decade, new team) and one Era Skip (keep the team, new decade) per game.</li>
        <li>No player twice, even from a different team or decade.</li>
        <li>At most one player from the 1970s.</li>
        <li>Classic shows every rating and stat. Film Room hides the numbers: draft from memory.</li>
        <li>The Daily Challenge gives everyone the same Beasts and the same draft sequence each day.</li>
      </ul>
    </div>
  );
}

function ControlsPage() {
  const kb = useSettings((s) => s.settings.controls.keyboard);
  const pad = useSettings((s) => s.settings.controls.gamepad);
  const device = useDevice();
  const contexts: InputContext[] = ['preSnap', 'pocket', 'ballInAir', 'carrier', 'kick', 'replay', 'global'];
  return (
    <div className="controls-ref">
      {contexts.map((ctx) => (
        <section key={ctx}>
          <h3>{CONTEXT_LABELS[ctx]}</h3>
          <dl>
            {ACTIONS.filter((a) => a.context === ctx && a.id !== 'global.perf')
              .map((a) => ({ a, codes: (device === 'gamepad' ? pad[a.id] : kb[a.id]) ?? [] }))
              // An action with no default on this device (the directional jukes on a keyboard) is left off unless it's been bound.
              .filter(({ a, codes }) => codes.length > 0 || a[device === 'gamepad' ? 'pad' : 'kb'].length > 0)
              .map(({ a, codes }) => (
                <div key={a.id} className="ref-row">
                  <dt>{a.label}</dt>
                  <dd>
                    <kbd>{codes.map(inputLabel).join(' / ') || '—'}</kbd>
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
