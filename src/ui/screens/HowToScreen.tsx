import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/app/appStore';
import { useSettings } from '@/app/settings';
import { ACTIONS, CONTEXT_LABELS, inputLabel, type InputContext } from '@/input/actions';
import { Audio } from '@/audio/audio';
import { useMenuNav } from '../nav';
import { Hints, useDevice } from '../components/controls';

// Reference pages. The interactive tutorial arrives with core play; these
// pages already reflect the live keybinds, including rebinds.

const PAGES = ['The Game', 'The Draft', 'On the Field', 'Controls'] as const;

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
        {page === 0 ? <GamePage /> : page === 1 ? <DraftPage /> : page === 2 ? <FieldPage /> : <ControlsPage />}
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

/**
 * On the Field: what the prompts on the field mean. The field only ever
 * shows a key and a word or two; the explanations live here, with the keys
 * as they're bound now.
 */
function FieldPage() {
  const kb = useSettings((s) => s.settings.controls.keyboard);
  const pad = useSettings((s) => s.settings.controls.gamepad);
  const device = useDevice();
  const k = (a: string) => <kbd>{((device === 'gamepad' ? pad[a] : kb[a]) ?? []).map(inputLabel)[0] ?? '—'}</kbd>;
  return (
    <div className="prose">
      <p className="lead">The number row does the work. What the numbers mean changes with the phase of the play, and the prompts on the field always say which.</p>
      <h3>The play call</h3>
      <p>
        The book is in six groups: quick game, dropback, shots, play action, screens and runs ({k('menu.tabPrev')} {k('menu.tabNext')} to switch). The art shows every route with its read number, the back's path on a run, and every block: a line ending in a bar.
      </p>
      <h3>Before the snap</h3>
      <p>
        {k('pocket.throw1')}–{k('pocket.throw5')} are your receivers, in read order (1 is the first read). Hold {k('preSnap.routes')} to see every route drawn on the field. {k('preSnap.hotRoute')} calls a hot route: press it, then the receiver's number, then his new route
        (go, out, in, slant, curl, comeback, flat, hitch). {k('preSnap.snap')} snaps the ball.
      </p>
      <h3>In the pocket</h3>
      <p>
        Move with {k('pocket.moveUp')}{k('pocket.moveLeft')}{k('pocket.moveDown')}{k('pocket.moveRight')}. A receiver's number throws to him: tap it and the ball is driven in on a line; hold it for touch, more air the longer you hold (the ring fills). He puts air under a driven ball on his own when a defender is in the way. Move the mouse off his icon while you hold it to place the
        ball: along his path leads him or throws back shoulder, up the screen is high. The ring on the field shows where it will come down, sized to the error you can expect. A glowing icon is an open man; a dim one is covered. {k('pocket.pumpFake')} pump-fakes, {k('pocket.throwAway')} throws
        it away.
      </p>
      <h3>Scrambling</h3>
      <p>
        {k('pocket.scramble')} tucks it and takes off: he runs like a ball carrier, and until he crosses the line of scrimmage he can still throw on the run (less accurately). The rush comes after him: the nearest free rusher chases, the ends try to keep him inside, and the underneath
        defenders come up once he heads for the line. Past the line he's a runner, and {k('carrier.dive')} is a <b>slide</b>: feet first, down where the slide began, and nobody may hit him.
      </p>
      <h3>Runs</h3>
      <p>On a designed run the back takes the handoff and you run it from there: press the aiming point, read the blocks, and cut where it opens. Inside zone and outside zone read the defense; power and counter follow a pulling guard; the draw shows pass first.</p>
      <h3>Ball in the air</h3>
      <p>
        {k('air.aggressive')} <b>Go up</b>: attack the ball at its highest point. Best in traffic; he lands and loses a step. {k('air.possession')} <b>Secure</b>: both hands on it; the sure catch, still at speed, and the only one that can tap both feet on the sideline. {k('air.rac')} <b>Run</b>: catch it in stride and
        keep going. With no call he catches and runs.
      </p>
      <h3>With the ball</h3>
      <p>
        You steer; he sets the pace: flat out in space, a controlled run when a tackler is close (so cuts and moves land), a jog only when he's protecting the ball. There's no sprint key. He finds an extra gear on his own coming out of a cut or when he clears the last man near him, longer for a quicker back and not when he's tired. Under him are three moves, on {k('carrier.option1')} {k('carrier.option2')} {k('carrier.option3')}, picked for the picture in front of him and changing as it changes: a tackler from the side offers <b>Juke</b>, <b>Stiff arm</b> and <b>Spin</b>; one square in front offers <b>Truck</b>, <b>Spin</b> and <b>Juke</b>; in the open field it's the best move for the nearest man, <b>Dive</b> (a quarterback slides to give himself up) and <b>Protect</b> (two hands on the ball, a little slower, far harder to strip). The first is always the one most likely to work, and the one he's making lights up. Every move also has its own key: {k('carrier.juke')} Juke (toward the side you steer, else away from the tackler), {k('carrier.stiffArm')} Stiff arm, {k('carrier.spin')} Spin, {k('carrier.truck')} Truck, {k('carrier.dive')} Dive, {k('carrier.protect')} Protect (hold). A move pressed a beat early still fires when he can make it.
      </p>
      <h3>Big hits</h3>
      <p>
        A hard hitter arriving at full speed, with his weight behind it, can lay a runner out; Break Tackle, size and running through the contact are what stand up to it. Big hits are rare (a few a game), shake the ball loose more often (Ball Security holds on), and the man who took one
        starts the next play short of breath. The biggest play in slow motion for a moment (Settings, Gameplay).
      </p>
    </div>
  );
}

function ControlsPage() {
  const kb = useSettings((s) => s.settings.controls.keyboard);
  const pad = useSettings((s) => s.settings.controls.gamepad);
  const device = useDevice();
  const contexts: InputContext[] = ['preSnap', 'hotRoute', 'pocket', 'ballInAir', 'carrier', 'kick', 'replay', 'global'];
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
