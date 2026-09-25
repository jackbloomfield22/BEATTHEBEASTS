import { useEffect, useMemo, useRef, useState } from 'react';
import { SLOT_ORDER } from '@data/legacy/constants';
import { POS_HEX, DECADE_HEX } from '@data/legacy/palette';
import type { Slot } from '@data/legacy/types';
import { useApp } from '@/app/appStore';
import { useDraft, SPIN_S, isComplete } from '@/app/draftStore';
import { urlFlags } from '@/app/platform';
import { Audio } from '@/audio/audio';
import { attrLabel } from '@/engine/ratings/attributes';
import { CARD_ATTRS } from '@/engine/ratings/ovrWeights';
import type { RatedPos } from '@/engine/ratings/types';
import { autoAllowed, skipsAllowed, type Candidate } from '@/game/draft';
import { DRESS_DELAY } from '@/render/locker/LockerRoom';
import { DRESS_END } from '@/render/locker/locker';
import { useMenuNav } from '../nav';
import { Hints } from '../components/controls';
import { TraitList } from '../scouting/TraitBadge';
import '../styles/draft.css';

// The draft over the Contenders' locker room (M6). The reels spin on the
// video wall; the pick panel lists what the pair offers, filtered by
// position and searchable, with a Scouting card for the focused man (Film
// Room hides every number). Each pick dresses its locker. Keyboard, mouse
// and gamepad drive all of it through the shared menu actions.

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

  // Quick Play: a look down the full row, then straight out of the tunnel.
  useEffect(() => {
    if (d.mode !== 'quick' || d.phase !== 'complete') return;
    const t = setTimeout(() => useDraft.setState({ phase: 'walkout', focus: null, wallBeasts: null }), urlFlags.shot ? 200 : 3500);
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
    // Open slots first; by OVR (Film Room: by position and name, so the order doesn't leak the numbers).
    return l.sort((a, b) => Number(!!b.slot) - Number(!!a.slot) || (film ? a.pos.localeCompare(b.pos) || a.name.localeCompare(b.name) : b.ovr - a.ovr));
  }, [all, tab, query, film]);
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
    enabled: phase !== 'walkout' && phase !== 'loading',
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

      {phase === 'intro' ? (
        <div className="draft-card intro">
          <div className="kicker">Tonight's opponent</div>
          <h2>The Beasts</h2>
          <p>An all-time defense, on the wall. Draft nine lockers from the reels and beat them.</p>
          <div className="draft-actions">
            <button className="btn primary" onClick={doSpin}>
              Spin round 1
            </button>
            {canAuto ? (
              <button className="btn" onClick={doAuto}>
                Auto-Draft
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase === 'ready' ? (
        <div className="draft-card ready">
          <div className="kicker">Round {round} of 9</div>
          <div className="draft-actions">
            <button className="btn primary" onClick={doSpin}>
              Spin
            </button>
            {canAuto ? (
              <button className="btn" onClick={doAuto}>
                Auto-Draft the rest
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
            {!film ? ` · ${lastPick.ovr} OVR` : ''}
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
                <button className="btn sm" disabled={draft.teamSkipUsed} onClick={() => useDraft.getState().skipTeam()}>
                  <kbd>R</kbd> Team Skip
                </button>
                <button className="btn sm" disabled={draft.eraSkipUsed} onClick={() => useDraft.getState().skipEra()}>
                  <kbd>F</kbd> Era Skip
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
                {!film ? <span className="pl-ovr">{c.ovr}</span> : null}
              </li>
            ))}
            {!list.length ? <li className="pl-empty">No one matches.</li> : null}
          </ul>
          {cur ? <DraftScout c={cur} film={film} /> : null}
        </aside>
      ) : null}

      {phase === 'complete' || phase === 'viewing' ? (
        <div className="draft-card ready">
          <div className="kicker">{phase === 'viewing' ? 'Your last roster' : 'Nine lockers, full'}</div>
          <div className="draft-actions">
            <button className="btn primary" onClick={walkOut}>
              Walk out
            </button>
            <button className="btn" onClick={() => go('main')}>
              Main menu
            </button>
          </div>
        </div>
      ) : null}

      <Hints
        items={
          choosing
            ? [
                { kb: '↑↓', pad: 'D-Pad', label: 'Browse' },
                { kb: 'Q E', pad: 'LB RB', label: 'Position' },
                { kb: '/', pad: '—', label: 'Search' },
                { kb: 'Enter', pad: 'A', label: 'Draft' },
                ...(canSkip ? [{ kb: 'R', pad: 'Y', label: 'Team Skip' }, { kb: 'F', pad: 'X', label: 'Era Skip' }] : []),
              ]
            : phase === 'intro'
              ? [
                  { kb: 'Enter', pad: 'A', label: 'Spin' },
                  { kb: 'Q E', pad: 'LB RB', label: 'Flip the Beasts' },
                  ...(canAuto ? [{ kb: 'R', pad: 'Y', label: 'Auto-Draft' }] : []),
                  { kb: 'Esc', pad: 'B', label: 'Back' },
                ]
              : phase === 'ready'
                ? [
                    { kb: 'Enter', pad: 'A', label: 'Spin' },
                    { kb: '← →', pad: 'D-Pad', label: 'Lockers' },
                    { kb: 'F', pad: 'X', label: 'The Beasts' },
                    ...(canAuto ? [{ kb: 'R', pad: 'Y', label: 'Auto-Draft' }] : []),
                  ]
                : phase === 'complete' || phase === 'viewing'
                  ? [
                      { kb: 'Enter', pad: 'A', label: 'Walk out' },
                      { kb: '← →', pad: 'D-Pad', label: 'Lockers' },
                      { kb: 'Esc', pad: 'B', label: 'Back' },
                    ]
                  : []
        }
      />
    </div>
  );
}

/** The Scouting card for the focused candidate (Film Room: no numbers). */
function DraftScout({ c, film }: { c: Candidate; film: boolean }) {
  const cat = useDraft((s) => s.cat);
  const linemen = useMemo(() => (c.kind === 'unit' && cat ? (cat.unit.get(c.id)?.linemen ?? []).map((id) => cat.entry.get(id)).filter(Boolean) : []), [c, cat]);
  const pos = c.pos as RatedPos;
  return (
    <div className="draft-scout">
      <div className="ds-head">
        <div>
          <div className="ds-kicker">
            {c.pos} · {c.team} · {c.decade}
            {!film ? <span className={`ds-conf conf-${c.conf}`}>{{ h: 'High', m: 'Medium', l: 'Low' }[c.conf]} confidence</span> : null}
          </div>
          <div className="ds-name">{c.kind === 'unit' ? `${c.team} ${c.decade} offensive line` : c.name}</div>
        </div>
        {!film ? <div className="ds-ovr">{c.ovr}</div> : null}
      </div>
      {c.kind === 'unit' ? (
        <ul className="ds-line">
          {linemen.map((l) => (
            <li key={l!.id}>
              <span>{l!.id.split('#')[1]}</span>
              <span>{l!.name}</span>
              {!film ? <span>{l!.ovr}</span> : null}
            </li>
          ))}
          {!film ? (
            <li className="ds-agg">
              <span />
              <span>Pass block {c.attrs.passBlock} · Run block {c.attrs.runBlock}</span>
              <span />
            </li>
          ) : null}
        </ul>
      ) : !film ? (
        <div className="ds-attrs">
          {(CARD_ATTRS[pos] ?? []).map((k) =>
            c.attrs[k] !== undefined ? (
              <div key={k} className="ds-attr">
                <span>{attrLabel(pos, k)}</span>
                <span className="ds-bar">
                  <span style={{ width: `${c.attrs[k]}%` }} />
                </span>
                <span className="ds-val">{c.attrs[k]}</span>
              </div>
            ) : null,
          )}
        </div>
      ) : null}
      <div className="ds-traits">{film ? <TraitList traits={c.traits.map((t) => ({ id: t.id, why: '' }))} showWhy={false} size="sm" empty="No traits" /> : <TraitList traits={c.traits} size="sm" empty="No traits" />}</div>
      <div className="ds-era">
        <span style={{ color: DECADE_HEX[c.decade]?.text }}>{c.decade}</span> {ERA_NOTE[c.decade]}
      </div>
    </div>
  );
}
