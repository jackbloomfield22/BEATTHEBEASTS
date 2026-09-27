import { useMemo, useState } from 'react';
import { useApp, type CameraShot, type Screen } from '@/app/appStore';
import { useMenuNav } from '../nav';
import { Hints, MenuItem } from '../components/controls';
import { Audio } from '@/audio/audio';
import { useDraft } from '@/app/draftStore';
import { useHistory, viewRecord } from '@/app/history';
import { getDailyChallenge, rateBeasts, threatTier, todayKey } from '@/engine';
import { modeLabel, resultWord } from '../results/GameReport';

interface Item {
  id: string;
  label: string;
  blurb: string;
  shot: CameraShot;
  screen?: Screen;
  /** Milestone that brings it online; the item stays visible but locked until then. */
  arrives?: string;
  /** How big it sits in the list (Playtest 2: New Draft is the big one; Last Game and History are smaller). */
  size: 'hero' | 'lg' | 'md';
}

const ALL_ITEMS: Item[] = [
  { id: 'play', size: 'hero', label: 'New Draft', blurb: 'Draft an all-time offense in the Contenders\' locker room through the slot machine, then take the field against the Beasts. Classic names every strength; Film Room hides them (← → to switch).', shot: 'menu' },
  { id: 'daily', size: 'lg', label: 'Daily Challenge', blurb: 'Same Beasts, same draft sequence for everyone today. Film Room rules, no skips, no Auto-Draft. Your final margin is your score.', shot: 'daily' },
  { id: 'quick', size: 'lg', label: 'Quick Play', blurb: 'Auto-draft, a look at the lockers, and straight out of the tunnel to kickoff.', shot: 'menu' },
  { id: 'myteam', size: 'lg', label: 'My Team', blurb: 'Your last roster, dressed and waiting in the locker room, with its depth chart and your last game on the board. To play again, draft a new team.', shot: 'menu' },
  { id: 'practice', size: 'lg', label: 'Practice Field', blurb: 'Free play against the Beasts: pick a play, a spot and a coverage, and run it as often as you like.', shot: 'practice', screen: 'practice' },
  { id: 'last', size: 'md', label: 'Last Game', blurb: 'The box score of your last game: the passing, rushing and receiving lines, every player\'s grade and why, the Beasts\' defense, the drive chart and the big hits.', shot: 'history' },
  { id: 'history', size: 'md', label: 'History', blurb: 'Every game you have played against the Beasts: the final score, the grade, the box score and the drive chart.', shot: 'history', screen: 'history' },
  { id: 'howto', size: 'md', label: 'How to Play', blurb: 'Controls and the rules of the game.', shot: 'history', screen: 'howto' },
  { id: 'settings', size: 'md', label: 'Settings', blurb: 'Display, graphics, controls, audio, gameplay and accessibility.', shot: 'settings', screen: 'settings' },
];

function useDailyPreview() {
  return useMemo(() => {
    const now = new Date();
    const key = todayKey({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
    const daily = getDailyChallenge(key);
    const rating = rateBeasts(daily.beasts).rating;
    return { key, rating, tier: threatTier(rating), beasts: daily.beasts, date: now };
  }, []);
}

export function MainMenu() {
  const go = useApp((s) => s.go);
  const hasDraft = useDraft((s) => !!s.saved);
  const last = useHistory((s) => s.records[0] ?? null);
  const [film, setFilm] = useState(false);
  const ITEMS = ALL_ITEMS.filter((it) => (it.id !== 'myteam' || hasDraft) && (it.id !== 'last' || last));
  const setShot = useApp((s) => s.setShot);
  const showToast = useApp((s) => s.showToast);
  const [focus, setFocus] = useState(0);
  const [dailyOpen, setDailyOpen] = useState(false);
  const item = ITEMS[focus]!;

  const focusItem = (i: number) => {
    setFocus(i);
    setShot(ITEMS[i]!.shot);
    if (ITEMS[i]!.id === 'daily') setDailyOpen(true);
  };
  const activate = (i: number) => {
    const it = ITEMS[i]!;
    const draft = useDraft.getState();
    if (it.id === 'play' || it.id === 'daily' || it.id === 'quick') {
      Audio.uiSelect();
      void draft.begin(it.id === 'daily' ? 'daily' : it.id === 'quick' ? 'quick' : film ? 'film' : 'classic');
      go('draft');
      return;
    }
    if (it.id === 'myteam') {
      Audio.uiSelect();
      void draft.view().then((ok) => ok && go('draft'));
      return;
    }
    if (it.id === 'last') {
      Audio.uiSelect();
      viewRecord(null, 'menu');
      go('results');
      return;
    }
    if (it.screen) {
      Audio.uiSelect();
      go(it.screen);
    } else {
      Audio.uiError();
      showToast(`${it.label} arrives with ${it.arrives}.`);
    }
  };

  const toggleFilm = () => {
    if (ITEMS[focus]?.id !== 'play') return;
    Audio.uiTick();
    setFilm((f) => !f);
  };
  useMenuNav({ count: ITEMS.length, focus, setFocus: focusItem, onConfirm: activate, onLeft: toggleFilm, onRight: toggleFilm });

  return (
    <div className="menu-screen main-menu">
      <div className="menu-scrim" />
      <header className="brand">
        <span className="brand-mark">B</span>
        <span className="brand-word">Beat the Beasts</span>
      </header>
      <nav className="menu-list">
        {ITEMS.map((it, i) => (
          <MenuItem
            key={it.id}
            size={it.size}
            label={it.label}
            focused={i === focus}
            tag={it.arrives ? 'Locked' : it.id === 'play' ? (film ? 'Film Room' : 'Classic') : undefined}
            className={i > 0 && ITEMS[i - 1]!.size !== it.size ? 'group-start' : ''}
            onHover={() => focusItem(i)}
            onClick={() => activate(i)}
          />
        ))}
      </nav>
      <aside className="menu-detail" key={item.id}>
        <div className="detail-kicker">{item.arrives ? 'In development' : 'Available'}</div>
        <h2 className="detail-title">{item.label}</h2>
        <p className="detail-blurb">{item.blurb}</p>
        {item.id === 'last' && last ? (
          <div className="menu-last">
            <span className={`res-banner ${resultWord(last).tone}`}>{resultWord(last).word}</span>
            <span className="ml-score">
              Contenders {last.score.user} – {last.score.beasts} Beasts
            </span>
            <span className="ml-meta">
              {last.grade ? `${last.grade.grade} · ${last.grade.label}` : 'Not graded'} · {modeLabel(last.mode)}
            </span>
          </div>
        ) : null}
        {item.id === 'daily' && dailyOpen ? <DailyPreview /> : null}
      </aside>
      <Hints items={[{ kb: '↑↓', pad: 'D-Pad', label: 'Navigate' }, { kb: 'Enter', pad: 'A', label: 'Select' }]} />
    </div>
  );
}

function DailyPreview() {
  const d = useDailyPreview();
  return (
    <div className="daily-preview">
      <div className="daily-date">{d.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <div className="daily-threat" style={{ color: d.tier.c }}>
        <span className="threat-label">{d.tier.l}</span>
        <span className="threat-rating">Defense rating {d.rating}</span>
      </div>
      <ul className="daily-beasts">
        {d.beasts.map((b) => (
          <li key={b.n + b.t + b.d}>
            <span className="pos">{b.p}</span>
            <span className="name">{b.n}</span>
            <span className="era">
              {b.t} · {b.d}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
