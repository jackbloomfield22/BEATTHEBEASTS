import { useEffect, useMemo, useRef, useState } from 'react';
import { DECADES, SLOT_ORDER } from '@data/legacy/constants';
import { POS_HEX, DECADE_HEX } from '@data/legacy/palette';
import { PLAYERS } from '@data/legacy/players';
import type { Slot } from '@data/legacy/types';
import { useApp } from '@/app/appStore';
import { useDraft, SPIN_S, isComplete } from '@/app/draftStore';
import { useHistory } from '@/app/history';
import { urlFlags } from '@/app/platform';
import { Audio } from '@/audio/audio';
import { autoAllowed, skipsAllowed, type Candidate, type Pair, type Roster } from '@/game/draft';
import { compareForList, highlights, plainTraits } from '@/game/draftView';
import { DRESS_DELAY } from '@/render/locker/LockerRoom';
import { DRESS_END } from '@/render/locker/locker';
import { useMenuNav } from '../nav';
import { Hints, KeyCap } from '../components/controls';
import { TraitList } from '../scouting/TraitBadge';
import { LastGamePanel, ReportOverlay } from '../results/LastGame';
import '../styles/draft.css';

// The draft over the Contenders' locker room (M6). The reels spin on the
// video wall; the pick panel lists what the pair offers, filtered by
// position and searchable, with a Scouting card for the focused man. The
// draft tests football knowledge, so no numbers show in any mode: no OVR, no
// attribute values, no confidence; the card names his three best attributes
// and his traits with plain-language reasons (src/game/draftView.ts). Film
// Room shows name, position, team and decade only. Each pick dresses its
// locker. Keyboard, mouse and gamepad drive all of it through the shared
// menu actions.
//
// The stage (.draft-stage) is one spot at the center of the frame, between
// the locker row and the CONTENDERS mark on the carpet: the Spin button with
// the round counter above it, the reel readout while the reels turn, the
// Draft confirm while a pair is on the wall, and Walk out once the row is
// full, so the eye never has to move. Its height is --stage-y in draft.css.

const POS_TABS = ['All', 'QB', 'RB', 'WR', 'TE', 'OL'] as const;
type PosTab = (typeof POS_TABS)[number];

const SLOT_LABEL: Record<Slot, string> = { QB: 'QB', RB: 'RB', RB2: 'RB2', WR1: 'WR1', WR2: 'WR2', WR3: 'WR3', TE: 'TE', TE2: 'TE2', OL: 'OL' };
const POS_OF: Record<Slot, string> = { QB: 'QB', RB: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', WR3: 'WR', TE: 'TE', TE2: 'TE', OL: 'OL' };

/**
 * What each decade's game looked like, for the Scouting card's era line.
 * Rule and schedule facts from the NFL record (season lengths, the 1978
 * pass-defense and blocking rules, official sacks from 1982, the 1994 cap,
 * the 2004 illegal-contact emphasis, 17 games from 2021).
 */
export const ERA_NOTE: Record<string, string> = {
  '1960s': 'AFL and NFL: 14-game seasons, run-first offenses, bump-and-run all the way downfield.',
  '1970s': 'The dead-ball era until the 1978 rules freed receivers and let linemen extend their hands.',
  '1980s': 'The West Coast offense and the 3-4 pass rush; sacks became official in 1982.',
  '1990s': 'The salary cap (1994), the zone blitz and the first Tampa 2 looks.',
  '2000s': 'Spread passing takes over after the 2004 illegal-contact emphasis.',
  '2010s': 'Record passing, the RPO and protected receivers.',
  '2020s': 'Seventeen games from 2021 and fourth-down aggression.',
};

export function DraftScreen() {
  const go = useApp((s) => s.go);
  const back = useApp((s) => s.back);
  const d = useDraft();
  const draft = d.draft;
  const film = d.mode === 'film';
  const [tab, setTab] = useState<PosTab>('All');
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState(0);
  const [roomFocus, setRoomFocus] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  // The Locker Room entry: the last game on the board, its full box score a key away.
  const lastGame = useHistory((s) => s.records[0] ?? null);
  const [boxOpen, setBoxOpen] = useState(false);
  const showLast = d.phase === 'viewing' && !!lastGame;

  // Start a draft when the screen opens without one (Play from the menu starts its own).
  useEffect(() => {
    const st = useDraft.getState();
    if (!st.draft && !st.starting && st.phase !== 'viewing') void st.begin('classic', { seed: urlFlags.seed ? Number(urlFlags.seed) : undefined });
  }, []);

  // Dev and screenshot harness: ?fill=N drafts N rounds at once (best OVR), ?pick=1 shows the pick panel.
  useEffect(() => {
    if (!import.meta.env.DEV && !urlFlags.shot) return;
    const p = new URLSearchParams(location.search);
    const fill = Number(p.get('fill') ?? 0);
    if (!fill || !draft || Object.keys(draft.roster).length) return;
    const st = useDraft.getState();
    for (let i = 0; i < fill && !isComplete(draft); i++) {
      st.spin();
      const all = Object.values(st.offers()).flat().filter((c) => c!.slot) as Candidate[];
      const best = all.sort((a, b) => b.ovr - a.ovr)[0];
      if (best) st.pick(best);
    }
    useDraft.setState((s) => ({ phase: isComplete(draft) ? 'complete' : 'ready', focus: null, instantSeq: s.instantSeq + 1, lastPick: null, wallBeasts: null }));
    if (p.has('pickpanel')) useDraft.getState().spin();
  }, [draft]);

  // Phase timing: the reels land, then the choice; a dressing ends in "ready".
  // (A video recording steps the phases itself: its frames aren't wall time.)
  useEffect(() => {
    if (urlFlags.video) return;
    if (d.phase === 'spinning') {
      const t = setTimeout(() => useDraft.getState().setPhase('choosing'), urlFlags.shot ? 0 : (SPIN_S + 0.35) * 1000);
      return () => clearTimeout(t);
    }
    if (d.phase === 'dressing') {
      const t = setTimeout(
        () => {
          const st = useDraft.getState();
          useDraft.setState({ phase: st.draft && isComplete(st.draft) ? 'complete' : 'ready', focus: null });
        },
        (DRESS_DELAY + DRESS_END + 0.4) * 1000,
      );
      return () => clearTimeout(t);
    }
  }, [d.phase, d.version]);

  // Quick Play: the auto-draft's reveal (the stalls dress in turn down the
  // row), a look at the full row, then straight out of the tunnel. The room
  // starts the walk-out on its own clock once the reveal is over
  // (LockerRoom.tsx); the screenshot harness skips straight to it.
  useEffect(() => {
    if (d.mode !== 'quick' || d.phase !== 'complete' || urlFlags.shot === null) return;
    const t = setTimeout(() => useDraft.setState({ phase: 'walkout', focus: null, wallBeasts: null }), 200);
    return () => clearTimeout(t);
  }, [d.mode, d.phase]);

  // A new pair on the reels resets the panel.
  const pairKey = `${draft?.pair?.t}|${draft?.pair?.d}|${draft?.sequence.length}`;
  const [seenPair, setSeenPair] = useState(pairKey);
  if (seenPair !== pairKey) {
    setSeenPair(pairKey);
    setQuery('');
    setFocus(0);
    setTab('All');
  }

  const offers = useMemo(() => {
    void d.version;
    return d.offers();
  }, [d]);
  const all = useMemo(() => Object.values(offers).flat() as Candidate[], [offers]);
  const openPos = useMemo(() => new Set(all.filter((c) => c.slot).map((c) => c.pos)), [all]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const l = all.filter((c) => (tab === 'All' || c.pos === tab) && (!q || c.name.toLowerCase().includes(q)));
    // QB, RB, WR, TE, OL, then last name, in every mode: the order never leaks a rating.
    return l.sort(compareForList);
  }, [all, tab, query]);
  const cur = list[Math.min(focus, list.length - 1)] ?? null;

  const choosing = d.phase === 'choosing';
  const canSkip = draft ? skipsAllowed(draft) : false;
  const canAuto = draft ? autoAllowed(draft) : false;
  const complete = draft ? isComplete(draft) : false;
  const dressed = SLOT_ORDER.filter((k) => draft?.roster[k]);

  const doSpin = () => {
    if (!draft || complete) return;
    Audio.uiSelect();
    useDraft.getState().spin();
  };
  const doPick = (c: Candidate | null) => {
    if (!c || !c.slot) {
      Audio.uiError();
      return;
    }
    Audio.uiSelect();
    useDraft.getState().pick(c);
  };
  const doAuto = () => {
    if (!canAuto) return;
    Audio.uiSelect();
    useDraft.getState().auto();
  };
  const walkOut = () => {
    Audio.uiSelect();
    useDraft.setState({ phase: 'walkout', focus: null, wallBeasts: null });
  };
  const cycleTab = (dir: 1 | -1) => {
    const tabs = POS_TABS.filter((t) => t === 'All' || all.some((c) => c.pos === t));
    const i = tabs.indexOf(tab);
    setTab(tabs[(i + dir + tabs.length) % tabs.length]!);
    setFocus(0);
    Audio.uiTick();
  };
  const browse = (dir: 1 | -1) => {
    const n = dressed.length;
    if (!n) return;
    const i = (roomFocus + dir + n) % n;
    setRoomFocus(i);
    useDraft.getState().setFocus(dressed[i]!);
    Audio.uiTick();
  };

  const phase = d.phase;
  useMenuNav({
    count: choosing ? list.length : 0,
    focus,
    setFocus,
    enabled: phase !== 'walkout' && phase !== 'loading' && !boxOpen,
    wrap: false,
    onConfirm: () => {
      if (choosing) doPick(cur);
      else if (phase === 'intro' || phase === 'ready') doSpin();
      else if (phase === 'complete' || phase === 'viewing') walkOut();
    },
    onBack: () => {
      if (choosing && query) setQuery('');
      else if (phase !== 'spinning' && phase !== 'dressing') back();
    },
    onTabPrev: () => (choosing ? cycleTab(-1) : phase === 'intro' ? flipBeasts(-1) : browse(-1)),
    onTabNext: () => (choosing ? cycleTab(1) : phase === 'intro' ? flipBeasts(1) : browse(1)),
    onLeft: () => (phase === 'viewing' || phase === 'complete' || phase === 'ready' ? browse(-1) : undefined),
    onRight: () => (phase === 'viewing' || phase === 'complete' || phase === 'ready' ? browse(1) : undefined),
    onAlt: () => {
      if (choosing && canSkip && !draft!.teamSkipUsed) {
        Audio.uiSelect();
        useDraft.getState().skipTeam();
      } else if ((phase === 'intro' || phase === 'ready') && canAuto) doAuto();
    },
    onAlt2: () => {
      if (choosing && canSkip && !draft!.eraSkipUsed) {
        Audio.uiSelect();
        useDraft.getState().skipEra();
      } else if (phase === 'intro' || phase === 'ready') useDraft.getState().setWallBeasts(d.wallBeasts === null ? 0 : null);
      else if (showLast) {
        Audio.uiSelect();
        setBoxOpen(true);
      }
    },
  });
  function flipBeasts(dir: 1 | -1) {
    const p = d.wallBeasts ?? 0;
    useDraft.getState().setWallBeasts((p + dir + 4) % 4);
    Audio.uiTick();
  }

  // "/" focuses the search box (typing then goes to it; Enter drafts, Esc clears).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.code === 'Slash' && choosing && document.activeElement !== search.current) {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.code === 'Escape' && document.activeElement === search.current) search.current?.blur();
    };
    window.addEventListener('keydown', on, { capture: true });
    return () => window.removeEventListener('keydown', on, { capture: true });
  }, [choosing]);

  const round = draft ? Math.min(9, Object.keys(draft.roster).length + (phase === 'dressing' ? 0 : 1)) : 0;
  const lastPick = d.lastPick?.pick;

  return (
    <div className={`draft-screen phase-${phase}`}>
      <header className="draft-top">
        <div className="draft-brand">
          <span className="brand-mark">B</span>
          <span>
            <span className="draft-mode">{{ classic: 'Classic', film: 'Film Room', daily: 'Daily Challenge', quick: 'Quick Play' }[d.mode]}</span>
            <span className="draft-round">{complete ? 'The roster is set' : phase === 'viewing' ? 'Locker Room' : `Round ${round} of 9`}</span>
          </span>
        </div>
        <ol className="draft-slots">
          {SLOT_ORDER.map((k) => {
            const p = draft?.roster[k];
            const col = POS_HEX[POS_OF[k]]!.solid;
            return (
              <li key={k} className={`${p ? 'filled' : ''} ${d.focus === k ? 'focused' : ''}`} style={{ ['--pc' as string]: col }} onClick={() => p && useDraft.getState().setFocus(k)}>
                <span className="slot-key">{SLOT_LABEL[k]}</span>
                <span className="slot-name">{p ? (p.linemen ? `${p.team} ${p.decade}` : p.name.split(' ').slice(-1)[0]) : '—'}</span>
              </li>
            );
          })}
        </ol>
      </header>

      {phase === 'loading' ? <div className="draft-center">Opening the locker room…</div> : null}

      {draft && (phase === 'intro' || phase === 'ready' || phase === 'spinning' || (choosing && draft.pair) || phase === 'complete' || phase === 'viewing') ? (
        <div className={`draft-stage stage-${phase}`}>
          <div className="stage-top">
            {phase === 'intro' ? (
              <div className="stage-caption">
                Tonight: <b>The Beasts</b>, an all-time defense
              </div>
            ) : null}
            <div className="stage-round">{phase === 'viewing' ? 'Your last roster' : complete ? 'Nine lockers, full' : `Round ${round} of 9`}</div>
          </div>
          {phase === 'spinning' && draft.pair ? (
            <div className="stage-btn is-reels">
              <Reels key={d.version} pair={draft.pair} roster={draft.roster} />
            </div>
          ) : choosing ? (
            <button className={`stage-btn is-draft ${cur?.slot ? '' : 'is-off'}`} tabIndex={-1} onClick={() => doPick(cur)} style={cur ? { ['--pc' as string]: POS_HEX[cur.pos]!.solid } : undefined}>
              <span className="stage-text">
                <span className="stage-verb">{cur ? (cur.slot ? `Draft → ${SLOT_LABEL[cur.slot]}` : `${cur.pos} is full`) : 'Choose a player'}</span>
                <span className={`stage-label ${cur && stageName(cur).length > 18 ? 'is-xlong' : cur && stageName(cur).length > 12 ? 'is-long' : ''}`}>{cur ? stageName(cur) : '—'}</span>
              </span>
              <KeyCap kb="Enter" pad="A" className="stage-key" />
            </button>
          ) : phase === 'complete' || phase === 'viewing' ? (
            <button className="stage-btn" tabIndex={-1} onClick={walkOut}>
              <span className="stage-text">
                <span className="stage-label">Walk out</span>
              </span>
              <KeyCap kb="Enter" pad="A" className="stage-key" />
            </button>
          ) : (
            <button className="stage-btn" tabIndex={-1} onClick={doSpin} disabled={phase === 'spinning'}>
              <span className="stage-text">
                <span className="stage-label">Spin</span>
              </span>
              <KeyCap kb="Enter" pad="A" className="stage-key" />
            </button>
          )}
          <div className="stage-sub">
            {(phase === 'intro' || phase === 'ready') && canAuto ? (
              <button className="btn sm stage-alt" tabIndex={-1} onClick={doAuto}>
                <KeyCap kb="R" pad="Y" /> {phase === 'intro' ? 'Auto-Draft' : 'Auto-Draft the rest'}
              </button>
            ) : null}
            {phase === 'complete' || phase === 'viewing' ? (
              <button className="btn sm stage-alt" tabIndex={-1} onClick={() => go('main')}>
                Main menu
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase === 'dressing' && lastPick ? (
        <div className="lower-third" style={{ ['--pc' as string]: POS_HEX[POS_OF[lastPick.slot]]!.solid }}>
          <span className="lt-pos">{SLOT_LABEL[lastPick.slot]}</span>
          <span className="lt-name">{lastPick.name}</span>
          <span className="lt-meta">
            {lastPick.linemen ? lastPick.linemen.map((l) => l.name.split(' ').slice(-1)[0]).join(' · ') : `#${lastPick.num}`} · {lastPick.team} {lastPick.decade}
          </span>
        </div>
      ) : null}

      {choosing && draft?.pair ? (
        <aside className="pick-panel">
          <div className="pick-head">
            <div className="pick-pair">
              <span className="pair-team">{draft.pair.t}</span>
              <span className="pair-decade" style={{ color: DECADE_HEX[draft.pair.d]?.text }}>
                {draft.pair.d}
              </span>
            </div>
            {canSkip ? (
              <div className="skips">
                <button className="btn sm" tabIndex={-1} disabled={draft.teamSkipUsed} onClick={() => useDraft.getState().skipTeam()}>
                  <KeyCap kb="R" pad="Y" /> Team Skip
                </button>
                <button className="btn sm" tabIndex={-1} disabled={draft.eraSkipUsed} onClick={() => useDraft.getState().skipEra()}>
                  <KeyCap kb="F" pad="X" /> Era Skip
                </button>
              </div>
            ) : (
              <div className="skips daily-note">The Daily: no skips</div>
            )}
          </div>
          <div className="pick-tools">
            <div className="pos-tabs">
              {POS_TABS.filter((t) => t === 'All' || all.some((c) => c.pos === t)).map((t) => (
                <button key={t} className={`tab ${tab === t ? 'on' : ''} ${t !== 'All' && !openPos.has(t) ? 'full' : ''}`} style={t !== 'All' ? { ['--pc' as string]: POS_HEX[t]!.solid } : undefined} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <input ref={search} className="draft-search" data-text-input="true" placeholder="Search  /" value={query} onChange={(e) => (setQuery(e.target.value), setFocus(0))} onKeyDown={(e) => e.code === 'Enter' && doPick(cur)} />
          </div>
          <ul className="pick-list">
            {list.map((c, i) => (
              <li key={c.id} className={`${i === focus ? 'is-focused' : ''} ${c.slot ? '' : 'is-full'}`} onMouseEnter={() => setFocus(i)} onClick={() => doPick(c)} ref={(el) => void (i === focus && el?.scrollIntoView({ block: 'nearest' }))}>
                <span className="pl-pos" style={{ background: POS_HEX[c.pos]!.solid }}>
                  {c.pos}
                </span>
                <span className="pl-name">{c.kind === 'unit' ? `${c.team} ${c.decade} line` : c.name}</span>
                <span className="pl-slot">{c.slot ? `→ ${SLOT_LABEL[c.slot]}` : 'Full'}</span>
              </li>
            ))}
            {!list.length ? <li className="pl-empty">No one matches.</li> : null}
          </ul>
          {cur ? <DraftScout c={cur} film={film} /> : null}
        </aside>
      ) : null}

      {showLast && !boxOpen ? <LastGamePanel rec={lastGame!} onOpen={() => setBoxOpen(true)} /> : null}
      {showLast && boxOpen ? <ReportOverlay rec={lastGame!} onClose={() => setBoxOpen(false)} /> : null}

      {/* Enter (Spin, Draft, Walk out) and Auto-Draft show on the stage itself. */}
      <Hints
        items={
          choosing
            ? [
                { kb: '↑↓', pad: 'D-Pad', label: 'Browse' },
                { kb: 'Q E', pad: 'LB RB', label: 'Position' },
                { kb: '/', pad: '—', label: 'Search' },
                ...(canSkip ? [{ kb: 'R', pad: 'Y', label: 'Team Skip' }, { kb: 'F', pad: 'X', label: 'Era Skip' }] : []),
              ]
            : phase === 'intro'
              ? [
                  { kb: 'Q E', pad: 'LB RB', label: 'Flip the Beasts' },
                  { kb: 'Esc', pad: 'B', label: 'Back' },
                ]
              : phase === 'ready'
                ? [
                    { kb: '← →', pad: 'D-Pad', label: 'Lockers' },
                    { kb: 'F', pad: 'X', label: 'The Beasts' },
                  ]
                : phase === 'complete' || phase === 'viewing'
                  ? [
                      { kb: '← →', pad: 'D-Pad', label: 'Lockers' },
                      ...(showLast ? [{ kb: 'F', pad: 'X', label: 'Last game' }] : []),
                      { kb: 'Esc', pad: 'B', label: 'Back' },
                    ]
                  : []
        }
      />
    </div>
  );
}

/** The name on the Draft confirm. */
const stageName = (c: Candidate) => (c.kind === 'unit' ? `${c.team} ${c.decade} line` : c.name);

/** Teams on the team reel (as the video wall's, LockerRoom.tsx). */
const REEL_TEAMS = [...new Set(PLAYERS.map((p) => p.t))].sort();

/**
 * The reel readout on the stage while the reels turn: the same easing as
 * the video wall's reels (videoWall.ts drawSlot: ~5 turns, cubic ease-out;
 * the team reel stops at 82% of the spin, the decade reel at the end), timed
 * from the moment this mounts (a skip remounts it). Display only.
 */
function Reels({ pair, roster }: { pair: Pair; roster: Roster }) {
  const locked = urlFlags.shot !== null && !urlFlags.video;
  const [t, setT] = useState(locked ? SPIN_S + 1 : 0);
  useEffect(() => {
    if (locked) return;
    const start = performance.now();
    let raf = 0;
    let last = -1;
    const tick = (now: number) => {
      const s = (now - start) / 1000;
      if (s - last >= 1 / 30) {
        last = s;
        setT(s);
      }
      if (s <= SPIN_S) raf = requestAnimationFrame(tick);
      else setT(SPIN_S + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [locked]);
  // Once a '70s man is on the roster the decade reel skips the '70s (as the wall does).
  const decades = useMemo(() => DECADES.filter((x) => x !== '1970s' || !Object.values(roster).some((p) => p?.decade === '1970s') || pair.d === '1970s'), [roster, pair]);
  const reel = (items: readonly string[], final: string, stop: number) => {
    const n = items.length;
    const fi = Math.max(0, items.indexOf(final));
    const u = Math.min(1, t / stop);
    const turns = 5 * n;
    const pos = fi + turns * (1 - Math.pow(1 - u, 3)) - turns;
    return { text: u >= 1 ? final : items[((Math.round(pos) % n) + n) % n]!, done: u >= 1 };
  };
  const team = reel(REEL_TEAMS, pair.t, SPIN_S * 0.82);
  const decade = reel(decades, pair.d, SPIN_S);
  return (
    <span className="stage-reels">
      <span className={`reel ${team.done ? 'is-locked' : ''}`}>{team.text}</span>
      <span className={`reel ${decade.done ? 'is-locked' : ''}`} style={decade.done ? { color: DECADE_HEX[decade.text]?.text } : undefined}>
        {decade.text}
      </span>
    </span>
  );
}

/**
 * The Scouting card for the focused candidate, with no numbers: his three
 * best attributes by name, his traits with plain-language reasons, and the
 * era line. Film Room: name, position, team and decade only (an OL unit
 * keeps its five names; the names are who you're drafting).
 */
function DraftScout({ c, film }: { c: Candidate; film: boolean }) {
  const cat = useDraft((s) => s.cat);
  const linemen = useMemo(() => (c.kind === 'unit' && cat ? (cat.unit.get(c.id)?.linemen ?? []).map((id) => cat.entry.get(id)).filter(Boolean) : []), [c, cat]);
  const best = useMemo(() => (film ? [] : highlights(c)), [c, film]);
  const traits = useMemo(() => (film ? [] : plainTraits(c)), [c, film]);
  return (
    <div className="draft-scout">
      <div className="ds-head">
        <div>
          <div className="ds-kicker">
            {c.pos} · {c.team} · {c.decade}
          </div>
          <div className="ds-name">{c.kind === 'unit' ? `${c.team} ${c.decade} offensive line` : c.name}</div>
        </div>
      </div>
      {c.kind === 'unit' ? (
        <ul className="ds-line">
          {linemen.map((l) => (
            <li key={l!.id}>
              <span>{l!.id.split('#')[1]}</span>
              <span>{l!.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!film ? (
        <>
          {best.length ? (
            <div className="ds-best">
              <span className="ds-best-label">Strengths</span>
              <ul>
                {best.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="ds-traits">
            <TraitList traits={traits} size="sm" empty="No traits" />
          </div>
          <div className="ds-era">
            <span style={{ color: DECADE_HEX[c.decade]?.text }}>{c.decade}</span> {ERA_NOTE[c.decade]}
          </div>
        </>
      ) : null}
    </div>
  );
}
