import { useEffect, useLayoutEffect, useState } from "react";
import { useApp } from "@/app/appStore";
import { useSettings } from "@/app/settings";
import { urlFlags } from "@/app/platform";
import { Audio } from "@/audio/audio";
import { inputLabel } from "@/input/actions";
import { practice, usePractice } from "@/game/practice";
import { latency } from "@/game/latency";
import {
  downLabel,
  spotLabel,
  START_DOWNS,
  START_SPOTS,
  startSituation,
} from "@/game/situation";
import {
  DEF_CALLS,
  HOT_ROUTES,
  PLAY_TYPE_LABEL,
  playById,
  PLAYS,
  ROUTE_LABEL,
  type PlayType,
} from "@/sim";
import { routeOf } from "@/sim/ai";
import { useMenuNav } from "../nav";
import {
  Choice,
  Hints,
  MenuItem,
  SettingRow,
  useDevice,
} from "../components/controls";
import { PlayArt } from "../game/PlayArt";
import { hudDom, RING_LEN } from "../game/hudDom";
import "../styles/game.css";

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
    void practice.enter(
      urlFlags.seed !== null ? Number(urlFlags.seed) : undefined,
    );
    return () => practice.leave();
  }, []);

  if (error)
    return (
      <div className="menu-screen">
        <div className="practice-loading">{error}</div>
      </div>
    );
  return (
    <>
      {stage === "loading" ? (
        <div className="practice-loading">Loading the Beasts…</div>
      ) : null}
      {stage === "call" ? <PlayCall /> : null}
      {stage === "presnap" || stage === "live" || stage === "result" ? (
        <PlayHud />
      ) : null}
      {stage === "result" ? <ResultPanel /> : null}
      {stage === "paused" ? <PauseMenu /> : null}
    </>
  );
}

// ---- Play call ---------------------------------------------------------------

const COVERS = [
  { value: "random", label: "Beasts choose" },
  ...DEF_CALLS.map((d) => ({ value: d.id, label: d.name })),
];

/** The play call's groups, in tab order (Q/E or LB/RB to switch). */
const GROUPS: PlayType[] = [
  "quick",
  "dropback",
  "shot",
  "playAction",
  "screen",
  "run",
];

function PlayCall() {
  const ui = usePractice();
  const back = useApp((s) => s.back);
  const current = playById(ui.playId);
  const [group, setGroup] = useState(Math.max(0, GROUPS.indexOf(current.type)));
  const plays = PLAYS.filter((p) => p.type === GROUPS[group]);
  const n = plays.length;
  const [focus, setFocus] = useState(
    Math.max(
      0,
      plays.findIndex((p) => p.id === ui.playId),
    ),
  );
  const [artPlay, setArtPlay] = useState(ui.playId);
  const rows = n + 3;
  const focusRow = (i: number) => {
    setFocus(i);
    if (i < n) setArtPlay(plays[i]!.id);
  };
  const switchGroup = (d: number) => {
    Audio.uiTick();
    const g = (group + d + GROUPS.length) % GROUPS.length;
    setGroup(g);
    const first = PLAYS.find((p) => p.type === GROUPS[g]);
    setFocus(0);
    if (first) setArtPlay(first.id);
  };
  const setStart = (spot: number, downs: number) =>
    usePractice.setState({
      startSpot: spot,
      startDowns: downs,
      situation: startSituation(spot, downs),
      seriesOver: false,
    });
  const change = (i: number, d: number) => {
    if (i === n)
      setStart(
        (ui.startSpot + d + START_SPOTS.length) % START_SPOTS.length,
        ui.startDowns,
      );
    if (i === n + 1)
      setStart(
        ui.startSpot,
        (ui.startDowns + d + START_DOWNS.length) % START_DOWNS.length,
      );
    if (i === n + 2) {
      const k = COVERS.findIndex((c) => c.value === ui.cover);
      usePractice.setState({
        cover: COVERS[(k + d + COVERS.length) % COVERS.length]!.value,
      });
    }
    if (i >= n) Audio.uiTick();
  };
  const confirm = (i: number) => {
    if (i < n) {
      Audio.uiSelect();
      practice.callPlay(plays[i]!.id);
    } else change(i, 1);
  };
  useMenuNav({
    count: rows,
    focus,
    setFocus: focusRow,
    onConfirm: confirm,
    onBack: back,
    onLeft: (i) => change(i, -1),
    onRight: (i) => change(i, 1),
    onTabPrev: () => switchGroup(-1),
    onTabNext: () => switchGroup(1),
  });
  const sit = ui.seriesOver
    ? startSituation(ui.startSpot, ui.startDowns)
    : ui.situation;
  const play = playById(artPlay);
  return (
    <div className="menu-screen play-call">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">Practice Field</h1>
        <div className="tabs">
          <span className="tab-key">Q</span>
          {GROUPS.map((g, i) => (
            <button
              key={g}
              className={`tab ${i === group ? "is-active" : ""}`}
              onClick={() => switchGroup(i - group)}
              tabIndex={-1}
            >
              {PLAY_TYPE_LABEL[g]}
            </button>
          ))}
          <span className="tab-key">E</span>
        </div>
        <div className="call-sit">
          <span className="call-down">{downLabel(sit)}</span>
          <span className="call-spot">Ball on the {spotLabel(sit.los)}</span>
        </div>
      </header>
      <div className="call-body">
        <div className="call-list">
          <div className="setting-header">
            {PLAY_TYPE_LABEL[GROUPS[group]!]}
          </div>
          {plays.map((p, i) => (
            <MenuItem
              key={p.id}
              size="md"
              label={p.name}
              tag={p.formation.name}
              focused={focus === i}
              onHover={() => focusRow(i)}
              onClick={() => confirm(i)}
            />
          ))}
          <div className="setting-header">Situation</div>
          <SettingRow
            label="Start at"
            focused={focus === n}
            onHover={() => focusRow(n)}
          >
            <Choice
              value={ui.startSpot}
              options={START_SPOTS.map((s, k) => ({
                value: k,
                label: s.label,
              }))}
              onChange={(v) => setStart(v, ui.startDowns)}
            />
          </SettingRow>
          <SettingRow
            label="Down"
            focused={focus === n + 1}
            onHover={() => focusRow(n + 1)}
          >
            <Choice
              value={ui.startDowns}
              options={START_DOWNS.map((s, k) => ({
                value: k,
                label: s.label,
              }))}
              onChange={(v) => setStart(ui.startSpot, v)}
            />
          </SettingRow>
          <SettingRow
            label="Coverage"
            focused={focus === n + 2}
            onHover={() => focusRow(n + 2)}
          >
            <Choice
              value={ui.cover}
              options={COVERS}
              onChange={(v) => usePractice.setState({ cover: v })}
            />
          </SettingRow>
        </div>
        <aside className="call-art" key={play.id}>
          <div className="detail-kicker">{play.formation.name}</div>
          <h2 className="detail-title">{play.name}</h2>
          <PlayArt play={play} />
          <p className="call-note">
            {play.run
              ? "A designed run: the back takes the handoff; you run it from there."
              : "Numbers are the reads in order: the key you press to throw to each receiver."}
          </p>
        </aside>
      </div>
      <Hints
        items={[
          { kb: "Q / E", pad: "LB / RB", label: "Play type" },
          { kb: "↑↓", pad: "D-Pad", label: "Choose" },
          { kb: "←→", pad: "D-Pad", label: "Change" },
          { kb: "Enter", pad: "A", label: "Call play" },
          { kb: "Esc", pad: "B", label: "Main menu" },
        ]}
      />
    </div>
  );
}

// ---- In-play HUD -------------------------------------------------------------

const ICON_COLOR: Record<string, string> = {
  WR: "#00e5ff",
  TE: "#bd6bff",
  RB: "#ff2a6d",
  QB: "#ffd400",
};
const PAD_GLYPH = ["A", "B", "X", "Y", "RB"];
const PAD_SHAPE = ["▼", "●", "■", "▲", "◆"];

/** The three catch calls, in key order (1, 2, 3). Prompts are a key and a word or two; How to Play explains them. */
const CATCHES = [
  { type: "aggressive", action: "air.aggressive", word: "Go up" },
  { type: "possession", action: "air.possession", word: "Secure" },
  { type: "rac", action: "air.rac", word: "Run" },
] as const;

/** The carrier's three move options (M6.5 #9): whatever the situation offers now, 1 the likeliest to work. The words are written every frame from the sim (GameScene, hudDom.opts). */
const OPTIONS = ["carrier.option1", "carrier.option2", "carrier.option3"] as const;

/** The key (or button) bound to an action, for prompts. */
function useKey() {
  const kb = useSettings((s) => s.settings.controls.keyboard);
  const pad = useSettings((s) => s.settings.controls.gamepad);
  const device = useDevice();
  return (action: string) => {
    const list = device === "gamepad" ? pad[action] : kb[action];
    return list?.[0] ? inputLabel(list[0]) : "—";
  };
}

/** One prompt: a key and a word or two. */
function Cue({
  k,
  w,
  className,
}: {
  k: string;
  w: string;
  className?: string;
}) {
  return (
    <span className={`cue${className ? ` ${className}` : ""}`}>
      <kbd>{k}</kbd>
      <span className="cue-w">{w}</span>
    </span>
  );
}

export function PlayHud({ bug = true }: { bug?: boolean } = {}) {
  const ui = usePractice();
  const device = useDevice();
  const colorblind = useSettings(
    (s) => s.settings.accessibility.colorblind !== "off",
  );
  const key = useKey();
  const pad = device === "gamepad";
  // The four move keys as one label (↑←↓→ by default), or the stick.
  const moveKeys = (p: string) =>
    pad
      ? "L-Stick"
      : (p === "carrier."
          ? ["up", "left", "down", "right"]
          : ["Up", "Left", "Down", "Right"]
        )
          .map((d) => key(p + d))
          .join("");
  const receivers = pad
    ? "A B X Y RB"
    : `${key("pocket.throw1")}–${key("pocket.throw5")}`;
  const runner = practice.runner;
  const icons = runner
    ? runner.state.icons.map((i) => runner.state.agents[i]!)
    : [];
  const phase = ui.phase;
  const inPocket =
    phase === "snap" || phase === "dropback" || phase === "pocket";
  const runPlay = !!playById(ui.playId).run;
  const qbRunning = !!runner && runner.state.carrier === runner.state.qb;
  const live = ui.stage === "live";
  return (
    <div className="play-hud">
      {bug ? (
        <div className="bug">
          <span className="bug-mark">B</span>
          <span className="bug-down">{downLabel(ui.playSit)}</span>
          <span className="bug-spot">{spotLabel(ui.playSit.los)}</span>
          <span className="bug-play">
            {runner ? runner.state.setup.play.name : ""}
          </span>
        </div>
      ) : null}
      <div className="icon-layer">
        {icons.map((a, k) => (
          <div
            key={k}
            className="rec-icon"
            data-open="none"
            ref={(el) => void (hudDom.icons[k] = el)}
            style={{ ["--c" as string]: ICON_COLOR[a.p.pos] ?? "#fff" }}
          >
            <svg className="rec-ring" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="17" className="ring-base" />
              <circle
                cx="20"
                cy="20"
                r="17"
                className="ring-charge"
                ref={(el) => void (hudDom.rings[k] = el)}
                strokeDasharray={RING_LEN}
                strokeDashoffset={RING_LEN}
              />
            </svg>
            <span className="rec-glyph">
              {pad
                ? colorblind
                  ? PAD_SHAPE[k]
                  : PAD_GLYPH[k]
                : key(`pocket.throw${k + 1}`)}
            </span>
            <span className="rec-name">{a.p.name.split(" ").slice(-1)[0]}</span>
          </div>
        ))}
        <div className="aim-reticle" ref={(el) => void (hudDom.reticle = el)} />
        {/* Under the ball carrier, the whole time he has it: his stamina and his three move options. */}
        <div
          className="carrier-hud"
          ref={(el) => void (hudDom.carrierHud = el)}
        >
          <div className="stamina" ref={(el) => void (hudDom.stamina = el)}>
            <span
              className="stamina-fill"
              ref={(el) => void (hudDom.staminaFill = el)}
            />
          </div>
          <div className="carrier-keys carrier-opts">
            {OPTIONS.map((a, k) => (
              <span
                key={a}
                className="cue opt"
                ref={(el) => void (hudDom.opts[k] = el)}
              >
                <kbd>{key(a)}</kbd>
                <span className="cue-w" />
              </span>
            ))}
          </div>
        </div>
      </div>
      {ui.stage === "presnap" && !ui.hot ? (
        <div className="snap-call">
          <Cue className="big" k={key("preSnap.snap")} w="Snap" />
          {runPlay ? (
            <div className="cue-row">
              <Cue k={key("preSnap.routes")} w="Play" />
            </div>
          ) : (
            <div className="cue-row">
              <Cue k={receivers} w="Receivers" />
              <Cue k={key("preSnap.routes")} w="Routes" />
              <Cue k={key("preSnap.hotRoute")} w="Hot route" />
            </div>
          )}
        </div>
      ) : null}
      {ui.stage === "presnap" && ui.hot ? <HotRoutePicker /> : null}
      {live && inPocket && !runPlay && ui.scrambling ? (
        <div className="prompt-row cue-row">
          <Cue k={moveKeys("pocket.move")} w="Run" />
          <Cue k={receivers} w="Throw on the run" />
          <Cue k={key("pocket.throwAway")} w="Throw away" />
        </div>
      ) : live && inPocket && !runPlay ? (
        <div className="prompt-row cue-row">
          <Cue k={moveKeys("pocket.move")} w="Move" />
          <Cue k={receivers} w="Throw" />
          <Cue k={pad ? "L-Stick" : "Mouse"} w="Aim" />
          <Cue k={key("pocket.pumpFake")} w="Pump" />
          <Cue k={key("pocket.throwAway")} w="Throw away" />
          <Cue k={key("pocket.scramble")} w="Scramble" />
          <span className="legend">
            <i className="dot open" /> Open <i className="dot covered" />{" "}
            Covered
          </span>
        </div>
      ) : null}
      {live && phase === "air" ? (
        <CatchCall called={ui.catchType} keyOf={key} />
      ) : null}
      {live && phase === "carrier" && ui.carrier ? (
        <div className="prompt-row cue-row">
          <Cue k={moveKeys("carrier.")} w="Run" />
          {qbRunning ? <Cue k={key("carrier.dive")} w="Slide" /> : null}
        </div>
      ) : null}
      <Tutorial />
    </div>
  );
}

/**
 * The first-play tutorial: which step of the down you're on and its keys,
 * in the prompts' words. It follows the play and never waits; How to Play
 * explains the rest.
 */
function Tutorial() {
  const step = usePractice((s) => s.tutorial);
  const device = useDevice();
  const key = useKey();
  if (!step) return null;
  const pad = device === "gamepad";
  const receivers = pad
    ? "A B X Y RB"
    : `${key("pocket.throw1")}–${key("pocket.throw5")}`;
  const cues: Record<string, [string, string][]> = {
    snap: [[key("preSnap.snap"), "Snap"]],
    read: [
      ["Glow", "Open"],
      ["Dim", "Covered"],
    ],
    throw: [
      [receivers, "Throw"],
      ["Hold", "Touch"],
    ],
    catch: CATCHES.map((c) => [key(c.action), c.word]),
    run: [
      [
        `${key("carrier.option1")} ${key("carrier.option2")} ${key("carrier.option3")}`,
        "Moves",
      ],
    ],
  };
  const order = ["snap", "read", "throw", "catch", "run"];
  return (
    <div className="tutorial-card" data-step={step}>
      <span className="tutorial-step">
        {order.indexOf(step) + 1}/{order.length}
      </span>
      {cues[step]!.map(([k, w]) => (
        <Cue key={w} k={k} w={w} />
      ))}
    </div>
  );
}

/**
 * The hot-route picker: which receiver (his number), then his route (its
 * number, or up/down and confirm; on a gamepad the D-pad and A). The route
 * art on the field previews the focused route.
 */
function HotRoutePicker() {
  const hot = usePractice((s) => s.hot);
  const device = useDevice();
  const key = useKey();
  const runner = practice.runner;
  if (!hot || !runner) return null;
  const s = runner.state;
  const pad = device === "gamepad";
  if (hot.stage === "receiver") {
    return (
      <div className="hot-picker">
        <div className="hot-head">Hot route</div>
        <div className="cue-row">
          <Cue
            k={
              pad
                ? "A B X Y RB"
                : `${key("hot.n1")}–${key(`hot.n${s.icons.length}`)}`
            }
            w="Receiver"
          />
          <Cue k={key("hot.cancel")} w="Close" />
        </div>
      </div>
    );
  }
  const a = s.agents[s.icons[hot.icon - 1]!]!;
  const current = routeOf(s, a);
  return (
    <div className="hot-picker">
      <div className="hot-head">
        {a.p.name.split(" ").slice(-1)[0]}{" "}
        <span className="hot-now">{current ? ROUTE_LABEL[current] : ""}</span>
      </div>
      <ol className="hot-list">
        {HOT_ROUTES.map((r, i) => (
          <li
            key={r}
            className={`hot-item${i === hot.focus ? " focus" : ""}${r === current ? " current" : ""}`}
            onMouseEnter={() =>
              usePractice.setState({ hot: { ...hot, focus: i } })
            }
            onClick={() => practice.pickHot(hot.icon, r)}
          >
            {pad ? null : <kbd>{key(`hot.n${i + 1}`)}</kbd>}
            <span>{ROUTE_LABEL[r]}</span>
          </li>
        ))}
      </ol>
      <div className="cue-row">
        {pad ? (
          <>
            <Cue k="A" w="Call" />
            <Cue k="B" w="Back" />
          </>
        ) : (
          <>
            <Cue k={key("hot.confirm")} w="Call" />
            <Cue k={key("hot.cancel")} w="Close" />
          </>
        )}
      </div>
    </div>
  );
}

/** The catch call: large and centred the moment the ball is thrown; the called one lights up. */
function CatchCall({
  called,
  keyOf,
}: {
  called: string | null;
  keyOf: (action: string) => string;
}) {
  useLayoutEffect(() => {
    if (called) latency.respond("catch");
  }, [called]);
  return (
    <div className="catch-call" data-called={called ?? "none"}>
      <div className="catch-opts">
        {CATCHES.map((c) => (
          <div
            key={c.type}
            className={`catch-opt${called === c.type ? " on" : called ? " off" : ""}`}
          >
            <kbd>{keyOf(c.action)}</kbd>
            <span className="catch-name">{c.word}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Result and pause --------------------------------------------------------

function ResultPanel() {
  const ui = usePractice();
  const back = useApp((s) => s.back);
  const [focus, setFocus] = useState(0);
  const items = [
    { label: "Next play", run: () => practice.nextPlay() },
    { label: "Run it back", run: () => practice.runItBack() },
    { label: "Leave practice", run: () => back() },
  ];
  const confirm = (i: number) => {
    Audio.uiSelect();
    items[i]!.run();
  };
  useMenuNav({
    count: items.length,
    focus,
    setFocus,
    onConfirm: confirm,
    onBack: () => confirm(0),
    onAlt: () => confirm(1),
  });
  const r = ui.result;
  if (!r) return null;
  const next = ui.seriesOver
    ? `Series over. Back to ${downLabel(startSituation(ui.startSpot, ui.startDowns))} on the ${spotLabel(START_SPOTS[ui.startSpot]!.los)}.`
    : `Next: ${downLabel(ui.situation)} on the ${spotLabel(ui.situation.los)}.`;
  return (
    <div className={`result-card tone-${r.tone}`}>
      <div className="result-kicker">
        {ui.lastCover ? `The Beasts played ${ui.lastCover}` : "Result"}
      </div>
      <h2 className="result-head">{r.headline}</h2>
      <p className="result-detail">{r.detail}</p>
      <p className="result-next">{next}</p>
      <p className="result-box">
        Session: {ui.box.plays} {ui.box.plays === 1 ? "play" : "plays"},{" "}
        {ui.box.yards.toFixed(0)} yd · passing {ui.box.comp}/{ui.box.att},{" "}
        {ui.box.passYds.toFixed(0)} yd · rushing {ui.box.rushes} for{" "}
        {ui.box.rushYds.toFixed(0)} · {ui.box.sacks}{" "}
        {ui.box.sacks === 1 ? "sack" : "sacks"} · {ui.box.bigHits} big{" "}
        {ui.box.bigHits === 1 ? "hit" : "hits"}
      </p>
      <nav className="result-actions">
        {items.map((it, i) => (
          <MenuItem
            key={it.label}
            size="md"
            label={it.label}
            focused={focus === i}
            onHover={() => setFocus(i)}
            onClick={() => confirm(i)}
          />
        ))}
      </nav>
    </div>
  );
}

function PauseMenu() {
  const back = useApp((s) => s.back);
  const [focus, setFocus] = useState(0);
  const items = [
    { label: "Resume", run: () => practice.resume() },
    { label: "Restart play", run: () => practice.runItBack() },
    { label: "Call a new play", run: () => practice.abandon() },
    usePractice.getState().tutorial
      ? {
          label: "Skip the tutorial",
          run: () => (practice.skipTutorial(), practice.resume()),
        }
      : {
          label: practice.tutorialPending
            ? "Tutorial on next play"
            : "Show the tutorial next play",
          run: () => (practice.replayTutorial(), practice.resume()),
        },
    { label: "Leave practice", run: () => back() },
  ];
  const confirm = (i: number) => {
    Audio.uiSelect();
    items[i]!.run();
  };
  useMenuNav({
    count: items.length,
    focus,
    setFocus,
    onConfirm: confirm,
    onBack: () => confirm(0),
  });
  return (
    <div className="menu-screen pause">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">Paused</h1>
      </header>
      <nav className="menu-list">
        {items.map((it, i) => (
          <MenuItem
            key={it.label}
            label={it.label}
            focused={focus === i}
            onHover={() => setFocus(i)}
            onClick={() => confirm(i)}
          />
        ))}
      </nav>
      <Hints
        items={[
          { kb: "Enter", pad: "A", label: "Select" },
          { kb: "Esc", pad: "B", label: "Resume" },
        ]}
      />
    </div>
  );
}
