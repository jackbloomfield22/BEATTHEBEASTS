import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/app/appStore';
import { useCharacterization, DEFAULT_SKIN } from '@/app/characterization';
import { DEFENSE, PLAYERS, SKIN_TONES } from '@data/legacy';
import { Audio } from '@/audio/audio';
import { useMenuNav } from '../nav';
import { Hints } from '../components/controls';

// Skin-tone editor (legacy CharacterizationEditor, rebuilt as a game menu and
// reachable from Settings). One row per person key (name, as in legacy; person
// ids replace names in milestone 2), covering every offensive player and every
// defender.

type Group = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'DEF';
const GROUPS: Group[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF'];

interface Person {
  key: string;
  positions: string[];
  stints: string[];
  group: Exclude<Group, 'ALL'>[];
}

function buildPeople(): Person[] {
  const map = new Map<string, Person>();
  const add = (n: string, p: string, t: string, d: string, g: Exclude<Group, 'ALL'>) => {
    const e = map.get(n) ?? { key: n, positions: [], stints: [], group: [] };
    if (!e.positions.includes(p)) e.positions.push(p);
    e.stints.push(`${t} ${d}`);
    if (!e.group.includes(g)) e.group.push(g);
    map.set(n, e);
  };
  for (const p of PLAYERS) add(p.n, p.p, p.t, p.d, p.p);
  for (const d of DEFENSE) add(d.n, d.p, d.t, d.d, 'DEF');
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function CharacterizationScreen() {
  const back = useApp((s) => s.back);
  const setShot = useApp((s) => s.setShot);
  const { file, dirty, save, setSkin, persist, importFile, refresh } = useCharacterization();
  const people = useMemo(() => buildPeople(), []);
  const [group, setGroup] = useState<Group>('ALL');
  const [query, setQuery] = useState('');
  const [unsetOnly, setUnsetOnly] = useState(false);
  const [focus, setFocus] = useState(0);
  const [searching, setSearching] = useState(false);
  const [keyPrompt, setKeyPrompt] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShot('characterization');
  }, [setShot]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => (group === 'ALL' || p.group.includes(group as Exclude<Group, 'ALL'>)) && (!unsetOnly || !file.entries[p.key]) && (!q || p.key.toLowerCase().includes(q)));
  }, [people, group, query, unsetOnly, file.entries]);

  const current = list[Math.min(focus, list.length - 1)];
  const setCount = Object.keys(file.entries).length;

  const assign = (skin: number | null) => {
    if (!current) return;
    Audio.uiTick();
    setSkin(current.key, skin);
  };

  useMenuNav({
    count: list.length,
    focus,
    setFocus,
    enabled: !searching && save.status !== 'needs-key',
    onBack: () => (dirty ? void persist().then(back) : back()),
    onLeft: () => current && assign(Math.max(0, (file.entries[current.key]?.skin ?? 3) - 1)),
    onRight: () => current && assign(Math.min(SKIN_TONES.length - 1, (file.entries[current.key]?.skin ?? 1) + 1)),
    onTabPrev: () => { setGroup((g) => GROUPS[(GROUPS.indexOf(g) + GROUPS.length - 1) % GROUPS.length]!); setFocus(0); Audio.uiTick(); },
    onTabNext: () => { setGroup((g) => GROUPS[(GROUPS.indexOf(g) + 1) % GROUPS.length]!); setFocus(0); Audio.uiTick(); },
    onAlt: () => { setUnsetOnly((u) => !u); setFocus(0); Audio.uiTick(); },
    wrap: false,
  });

  // Direct keys: 1-5 assign a tone, 0/Delete clears, / searches, Ctrl+S saves.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (searching || save.status === 'needs-key') return;
      if (/^Digit[1-5]$/.test(e.code)) assign(Number(e.code.slice(5)) - 1);
      else if (e.code === 'Digit0' || e.code === 'Delete') assign(null);
      else if (e.code === 'Slash') {
        e.preventDefault();
        setSearching(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      } else if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void persist();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  useEffect(() => {
    listRef.current?.querySelector('.is-focused')?.scrollIntoView({ block: 'nearest' });
  }, [focus, group, query]);

  useEffect(() => {
    if (save.status === 'needs-key') setTimeout(() => keyRef.current?.focus(), 0);
  }, [save.status]);

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'characterization.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importInput = useRef<HTMLInputElement>(null);

  const tone = current ? file.entries[current.key]?.skin : undefined;

  return (
    <div className="menu-screen char-screen">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">Skin Tones</h1>
        <div className="tabs">
          <span className="tab-key">Q</span>
          {GROUPS.map((g) => (
            <button key={g} className={`tab ${g === group ? 'is-active' : ''}`} onClick={() => { setGroup(g); setFocus(0); }} tabIndex={-1}>
              {g === 'ALL' ? 'All' : g === 'DEF' ? 'Defense' : g}
            </button>
          ))}
          <span className="tab-key">E</span>
        </div>
        <div className="char-count">
          <b>{setCount}</b> / {people.length} set{dirty ? <span className="unsaved"> · unsaved</span> : null}
        </div>
      </header>

      <div className="char-body">
        <div className="char-left">
          <div className={`search ${searching ? 'active' : ''}`} onClick={() => { setSearching(true); searchRef.current?.focus(); }}>
            <span className="search-icon">/</span>
            <input
              ref={searchRef}
              data-text-input="true"
              value={query}
              placeholder="Search players"
              spellCheck={false}
              onChange={(e) => { setQuery(e.target.value); setFocus(0); }}
              onBlur={() => setSearching(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (e.key === 'Escape') setQuery('');
                  searchRef.current?.blur();
                }
              }}
            />
            <span className={`unset-toggle ${unsetOnly ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); setUnsetOnly((u) => !u); setFocus(0); }}>
              Unset only
            </span>
          </div>
          <div className="char-list" ref={listRef}>
            {list.map((p, i) => {
              const s = file.entries[p.key]?.skin;
              return (
                <div key={p.key} className={`char-row ${i === focus ? 'is-focused' : ''}`} onMouseEnter={() => setFocus(i)}>
                  <span className="swatch" style={{ background: s !== undefined ? SKIN_TONES[s]!.hex : 'transparent', borderStyle: s !== undefined ? 'solid' : 'dashed' }} />
                  <span className="char-name">{p.key}</span>
                  <span className="char-pos">{p.positions.join(' · ')}</span>
                </div>
              );
            })}
            {list.length === 0 ? <div className="empty">No players match.</div> : null}
          </div>
        </div>

        <aside className="char-detail">
          {current ? (
            <>
              <div className="char-portrait" style={{ ['--skin' as string]: tone !== undefined ? SKIN_TONES[tone]!.hex : DEFAULT_SKIN }}>
                <svg viewBox="0 0 100 100" aria-hidden>
                  <ellipse cx="50" cy="44" rx="20" ry="24" className="face" />
                  <path d="M20 100 C 22 74, 38 68, 50 68 C 62 68, 78 74, 80 100 Z" className="neck" />
                  <path d="M26 40 C 26 16, 74 16, 74 40 L 74 50 C 70 46, 30 46, 26 50 Z" className="helmet" />
                </svg>
              </div>
              <h2 className="detail-title">{current.key}</h2>
              <div className="char-stints">{current.stints.join(' · ')}</div>
              <div className="tone-picker">
                {SKIN_TONES.map((t, i) => (
                  <button key={t.id} className={`tone ${tone === i ? 'is-active' : ''}`} style={{ background: t.hex }} onClick={() => { setSkin(current.key, i); Audio.uiTick(); }} tabIndex={-1}>
                    <span>{i + 1}</span>
                  </button>
                ))}
                <button className={`tone clear ${tone === undefined ? 'is-active' : ''}`} onClick={() => { setSkin(current.key, null); Audio.uiTick(); }} tabIndex={-1}>
                  <span>0</span>
                </button>
              </div>
              <p className="char-note">{tone === undefined ? 'Unset: plays with the default tone.' : SKIN_TONES[tone]!.label}</p>
            </>
          ) : null}
          <div className="char-actions">
            <button className="btn primary" onClick={() => void persist()} tabIndex={-1} disabled={save.status === 'saving'}>
              {save.status === 'saving' ? 'Saving…' : 'Save'}
            </button>
            <button className="btn" onClick={exportFile} tabIndex={-1}>Export</button>
            <button className="btn" onClick={() => importInput.current?.click()} tabIndex={-1}>Import</button>
            <input
              ref={importInput}
              type="file"
              accept="application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  importFile(JSON.parse(await f.text()));
                } catch {
                  Audio.uiError();
                }
                e.target.value = '';
              }}
            />
          </div>
          {save.message ? <p className={`save-msg ${save.status}`}>{save.message}</p> : null}
          {save.status === 'needs-key' ? (
            <form
              className="key-prompt"
              onSubmit={(e) => {
                e.preventDefault();
                void persist(keyPrompt);
              }}
            >
              <input ref={keyRef} data-text-input="true" type="password" value={keyPrompt} placeholder="Editor key" onChange={(e) => setKeyPrompt(e.target.value)} />
              <button className="btn primary" type="submit" tabIndex={-1}>Save</button>
            </form>
          ) : null}
        </aside>
      </div>
      <Hints
        items={[
          { kb: '1-5', pad: '← →', label: 'Set tone' },
          { kb: '0', pad: '—', label: 'Clear' },
          { kb: '/', pad: '—', label: 'Search' },
          { kb: 'R', pad: 'Y', label: 'Unset only' },
          { kb: 'Ctrl+S', pad: '—', label: 'Save' },
          { kb: 'Esc', pad: 'B', label: 'Save & back' },
        ]}
      />
    </div>
  );
}
