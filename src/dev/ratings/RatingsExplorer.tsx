import { useEffect, useMemo, useRef, useState } from 'react';
import { rateAll } from '@/engine/ratings/engine';
import { TRAIT_LABELS } from '@/engine/ratings/traits';
import type { AttributeResult, RatedEntry, RatedPos, RatingInputs } from '@/engine/ratings/types';
import { ContributionBars, CONF_LABEL } from '@/ui/scouting/ContributionBars';
import { ScoutingPanel } from '@/ui/scouting/ScoutingPanel';
import inputsUrl from '@data/ratings/inputs.v1.json?url';
import { attrKeys, attrLabel, attrNote, buildModel, CARD_ATTRS, DECADES, pct, POSITIONS, toCsv, valueOf, type Model } from './model';
import './explorer.css';

// Ratings Explorer (BRIEF "Tools for reviewing ratings"; TECH_PLAN §7):
// search any stint, see every attribute with its contribution breakdown, the
// real stats and era baseline behind it, percentiles all-time and within the
// era, compare two players, filter/sort the pool by any attribute, export CSV.
// Ratings are computed live from data/ratings/inputs.v1.json, so what you see
// is exactly what the engine produces.

interface Applied {
  id: string;
  name: string;
  op: string;
  field?: string;
  old?: unknown;
  new?: unknown;
  reason: string;
}

type SortKey = string;

const ROW_H = 30;

export function RatingsExplorer() {
  const [model, setModel] = useState<Model | null>(null);
  const [applied, setApplied] = useState<Applied[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<RatedPos | 'ALL'>('ALL');
  const [decade, setDecade] = useState<string>('ALL');
  const [lowOnly, setLowOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'ovr', dir: -1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(inputsUrl)
      .then((r) => r.json() as Promise<{ inputs: RatingInputs[]; applied: Applied[] }>)
      .then((d) => {
        if (!alive) return;
        const run = rateAll(d.inputs);
        setModel(buildModel(run));
        setApplied(d.applied);
        const fromHash = decodeURIComponent(location.hash.split('?id=')[1] ?? '');
        setSelected(fromHash && run.entries.some((e) => e.id === fromHash) ? fromHash : (run.entries.find((e) => e.id === 'players:jerry-rice:SF:1980s')?.id ?? run.entries[0]!.id));
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const columns = useMemo(() => (pos === 'ALL' ? [] : attrKeys(pos)), [pos]);

  const list = useMemo(() => {
    if (!model) return [];
    const q = query.trim().toLowerCase();
    const out = model.run.entries.filter(
      (e) =>
        (pos === 'ALL' || e.pos === pos) &&
        (decade === 'ALL' || e.decade === decade) &&
        (!lowOnly || e.ovr.conf === 'low') &&
        (!q || e.name.toLowerCase().includes(q) || e.team.toLowerCase() === q || e.id.includes(q)),
    );
    const k = sort.key;
    const get = (e: RatedEntry): number | string => (k === 'name' || k === 'team' || k === 'decade' || k === 'pos' ? e[k] : (valueOf(e, k) ?? -1));
    out.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      return (typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)) * sort.dir;
    });
    return out;
  }, [model, query, pos, decade, lowOnly, sort]);

  if (error) return <div className="rx-root rx-center">Could not load ratings: {error}. Run <code>npm run ratings</code>.</div>;
  if (!model) return <div className="rx-root rx-center">Rating {`>`}4,000 stints…</div>;

  const sel = selected ? model.byId.get(selected) : undefined;
  const cmp = compare ? model.byId.get(compare) : undefined;

  const exportCsv = () => {
    const blob = new Blob([toCsv(list)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ratings-${pos}-${decade}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' || key === 'team' ? 1 : -1 }));
  const th = (key: SortKey, label: string, cls = '') => (
    <button className={`rx-th ${cls} ${sort.key === key ? 'is-sorted' : ''}`} onClick={() => sortBy(key)} title={`Sort by ${label}`}>
      {label}
      {sort.key === key ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
    </button>
  );

  return (
    <div className="rx-root">
      <header className="rx-head">
        <div className="rx-brand">
          <span className="rx-mark">BTB</span>
          <div>
            <div className="rx-title">Ratings Explorer</div>
            <div className="rx-sub">
              {model.run.entries.length.toLocaleString()} rated stints · {applied.length} corrections applied · computed live from data/ratings/inputs.v1.json
            </div>
          </div>
        </div>
        <div className="rx-head-actions">
          <button className="rx-btn" onClick={exportCsv}>
            Export CSV ({list.length.toLocaleString()})
          </button>
          <a className="rx-btn" href="#/">
            Back to game
          </a>
        </div>
      </header>

      <div className={`rx-body ${cmp ? 'is-compare' : ''}`}>
        <section className="rx-pool">
          <div className="rx-filters">
            <input className="rx-search" placeholder="Search player, team code or id…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            <div className="rx-chips">
              {(['ALL', ...POSITIONS] as const).map((p) => (
                <button key={p} className={`rx-chip ${pos === p ? 'is-on' : ''}`} onClick={() => setPos(p)}>
                  {p === 'ALL' ? 'All' : p}
                </button>
              ))}
            </div>
            <div className="rx-chips">
              {['ALL', ...DECADES].map((d) => (
                <button key={d} className={`rx-chip ${decade === d ? 'is-on' : ''}`} onClick={() => setDecade(d)}>
                  {d === 'ALL' ? 'All eras' : d}
                </button>
              ))}
              <button className={`rx-chip ${lowOnly ? 'is-on' : ''}`} onClick={() => setLowOnly((x) => !x)} title="Only players whose OVR confidence is low">
                Low confidence
              </button>
            </div>
          </div>
          <PoolTable
            list={list}
            columns={columns}
            pos={pos}
            th={th}
            selected={selected}
            compare={compare}
            onSelect={(id) => {
              setSelected(id);
              history.replaceState(null, '', `#/dev/ratings?id=${encodeURIComponent(id)}`);
            }}
            onCompare={(id) => setCompare((c) => (c === id ? null : id))}
          />
        </section>

        <section className={`rx-detail ${cmp ? 'is-compare' : ''}`}>
          {cmp && sel && (
            <div className="rx-compare-bar">
              <span>
                Comparing <b>{sel.name}</b> ({sel.team} {sel.decade}) with <b>{cmp.name}</b> ({cmp.team} {cmp.decade})
              </span>
              <button className="rx-btn" onClick={() => setCompare(null)}>
                Close compare
              </button>
            </div>
          )}
          {sel ? <PlayerCard model={model} e={sel} other={cmp} /> : <div className="rx-center">Select a player.</div>}
          {cmp && sel && <PlayerCard model={model} e={cmp} other={sel} />}
        </section>
      </div>
    </div>
  );
}

function PoolTable(props: {
  list: RatedEntry[];
  columns: string[];
  pos: RatedPos | 'ALL';
  th: (key: string, label: string, cls?: string) => React.ReactNode;
  selected: string | null;
  compare: string | null;
  onSelect: (id: string) => void;
  onCompare: (id: string) => void;
}) {
  const { list, columns, pos, th } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(800);
  // Header row height (the scroll container holds the sticky header too).
  const HEAD = 34;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const first = Math.max(0, Math.floor((scroll - HEAD) / ROW_H) - 10);
  const last = Math.min(list.length, Math.ceil((scroll + height) / ROW_H) + 10);
  const gridCols = `minmax(11rem, 1.6fr) 3rem 3.2rem 3.6rem 3rem 3.4rem ${columns.map(() => '3.4rem').join(' ')} 2.2rem`;
  return (
    <div className="rx-table" ref={ref} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
      <div className="rx-tr rx-thead" style={{ gridTemplateColumns: gridCols }}>
        {th('name', 'Player', 'is-left')}
        {th('pos', 'Pos')}
        {th('team', 'Team')}
        {th('decade', 'Era')}
        {th('imp', 'imp')}
        {th('ovr', 'OVR')}
        {columns.map((k) => (
          <span key={k}>{th(k, shortLabel(pos as RatedPos, k))}</span>
        ))}
        <span className="rx-th" title="Pin for side-by-side compare">⇄</span>
      </div>
      <div className="rx-tbody">
        <div style={{ height: list.length * ROW_H, position: 'relative' }}>
          {list.slice(first, last).map((e, i) => (
            <div
              key={e.id}
              className={`rx-tr ${props.selected === e.id ? 'is-selected' : ''} ${props.compare === e.id ? 'is-compare' : ''}`}
              style={{ gridTemplateColumns: gridCols, top: (first + i) * ROW_H, height: ROW_H }}
              onClick={() => props.onSelect(e.id)}
            >
              <span className="rx-td is-left rx-name">{e.name}</span>
              <span className="rx-td">{e.pos}</span>
              <span className="rx-td">{e.team}</span>
              <span className="rx-td">{e.decade}</span>
              <span className="rx-td rx-dim">{e.imp}</span>
              <span className="rx-td">
                <Val v={e.ovr.value} conf={e.ovr.conf} />
              </span>
              {columns.map((k) => (
                <span key={k} className="rx-td">
                  {e.attrs[k] ? <Val v={e.attrs[k]!.value} conf={e.attrs[k]!.conf} /> : '–'}
                </span>
              ))}
              <button
                className="rx-td rx-pin"
                onClick={(ev) => {
                  ev.stopPropagation();
                  props.onCompare(e.id);
                }}
                title="Compare with the selected player"
              >
                {props.compare === e.id ? '●' : '○'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function shortLabel(pos: RatedPos, k: string): string {
  const l = attrLabel(pos, k);
  const words = l.split(' ');
  return words.length > 1 ? words.map((w) => w[0]).join('') : l.slice(0, 5);
}

function Val({ v, conf }: { v: number; conf: AttributeResult['conf'] }) {
  const tier = v >= 90 ? 't90' : v >= 80 ? 't80' : v >= 70 ? 't70' : v >= 60 ? 't60' : 't50';
  return (
    <span className={`rx-val rx-${tier}`} title={`${v.toFixed(1)} · ${conf} confidence`}>
      {Math.round(v)}
      {conf === 'low' && <sup>•</sup>}
    </span>
  );
}

const STAT_LABELS: Record<string, string> = {
  passYdsPerGame: 'Pass yds/g',
  passTdPerGame: 'Pass TD/g',
  intPerGame: 'INT/g',
  passerRating: 'Passer rating',
  cmpPct: 'Comp %',
  ypa: 'Yds/att',
  tdPct: 'TD %',
  intPct: 'INT %',
  sackPct: 'Sack %',
  attPerGame: 'Att/g',
  qbRushYdsPerGame: 'Rush yds/g',
  rushYdsPerGame: 'Rush yds/g',
  ypc: 'Yds/carry',
  carriesPerGame: 'Carries/g',
  rushTdPerGame: 'Rush TD/g',
  fumblesPerTouch: 'Fumbles/touch',
  recYdsPerGame: 'Rec yds/g',
  recPerGame: 'Rec/g',
  yardsPerRec: 'Yds/rec',
  yardsPerTarget: 'Yds/target',
  catchPct: 'Catch %',
  tdPerGame: 'TD/g',
  blockGrade: 'Block grade (legacy)',
  sacksPerGame: 'Sacks/g',
  defIntPerGame: 'INT/g',
  ffPerGame: 'FF/g',
  frPerGame: 'FR/g',
  defTdPerGame: 'Def TD/g',
  pdPerGame: 'PD/g',
  tacklesPerGame: 'Tackles/g',
};

const BASE_LABELS: [keyof RatingInputs['baseline'], string][] = [
  ['cmpPct', 'Comp %'],
  ['ypa', 'Yds/att'],
  ['tdPct', 'TD %'],
  ['intPct', 'INT %'],
  ['sackPct', 'Sack %'],
  ['passerRating', 'Passer rating'],
  ['ypc', 'Yds/carry'],
  ['passYdsPerTeamGame', 'Pass yds/team-g'],
  ['rushYdsPerTeamGame', 'Rush yds/team-g'],
  ['sacksPerTeamGame', 'Sacks/team-g'],
  ['intPerTeamGame', 'INT/team-g'],
  ['yardsPerReception', 'Yds/rec'],
  ['catchRate', 'Catch rate'],
  ['yardsPerTarget', 'Yds/target'],
];

function PlayerCard({ model, e, other }: { model: Model; e: RatedEntry; other?: RatedEntry }) {
  const [open, setOpen] = useState<string | null>('ovr');
  const keys = ['ovr', ...attrKeys(e.pos)];
  const card = new Set(CARD_ATTRS[e.pos]);
  const inp = e.inputs;
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  return (
    <div className="rx-card">
      <div className="rx-card-head">
        <div>
          <div className="rx-kicker">
            {e.pos} · {e.team} · {e.decade}
            {inp.olUnit ? ` · ${inp.olUnit.slot}${inp.olUnit.generated ? ' (generated)' : ''}` : ''}
          </div>
          <h2 className="rx-name-big">{e.name}</h2>
          <div className="rx-meta">
            {inp.seasons.v.length ? `${inp.seasons.v[0]}–${inp.seasons.v[inp.seasons.v.length - 1]}` : ''} · {inp.games.v} games ({inp.games.conf}) · {inp.heightIn ? `${Math.floor(inp.heightIn.v / 12)}'${inp.heightIn.v % 12}"` : '?'} {inp.weightLb ? `${inp.weightLb.v} lb` : ''}
            {inp.age ? ` · age ${inp.age.v.toFixed(1)}` : ''} · legacy imp {e.imp}
          </div>
          <div className="rx-traits">
            {e.traits.length ? (
              e.traits.map((t) => (
                <span key={t.id} className="rx-trait" title={t.reasons.join('\n')}>
                  {TRAIT_LABELS[t.id]}
                </span>
              ))
            ) : (
              <span className="rx-dim">No traits</span>
            )}
          </div>
        </div>
        <div className="rx-ovr">
          <div className="rx-ovr-num">{Math.round(e.ovr.value)}</div>
          <div className="rx-ovr-lbl">OVR · {e.ovr.conf}</div>
        </div>
      </div>

      <div className="rx-attrs">
        <div className="rx-attr-head">
          <span>Attribute</span>
          <span>Value</span>
          <span title="Percentile among all players at the position">All-time</span>
          <span title="Percentile among players at the position in this decade">Era</span>
          <span>Conf</span>
          {other && <span>vs {other.name.split(' ').slice(-1)[0]}</span>}
        </div>
        {keys.map((k) => {
          const r = k === 'ovr' ? e.ovr : e.attrs[k];
          if (!r) return null;
          const all = pct(model.sorted.get(`${e.pos}|${k}`), r.value);
          const era = pct(model.sorted.get(`${e.pos}|${e.decade}|${k}`), r.value);
          const ov = other ? (k === 'ovr' ? other.ovr.value : other.attrs[k]?.value) : undefined;
          const isOpen = open === k;
          return (
            <div key={k} className={`rx-attr ${isOpen ? 'is-open' : ''}`}>
              <button className="rx-attr-row" onClick={() => setOpen(isOpen ? null : k)} title={k === 'ovr' ? 'Weighted blend of the position attributes' : attrNote(e.pos, k)}>
                <span className={`rx-attr-name ${card.has(k) ? 'is-card' : ''}`}>{k === 'ovr' ? 'Overall' : attrLabel(e.pos, k)}</span>
                <span className="rx-attr-val">
                  <span className="rx-attr-bar">
                    <span style={{ width: `${r.value}%` }} />
                  </span>
                  <Val v={r.value} conf={r.conf} />
                </span>
                <span className="rx-dim">{all.toFixed(0)}</span>
                <span className="rx-dim">{era.toFixed(0)}</span>
                <span className={`rx-conf rx-conf-${r.conf}`}>{r.conf}</span>
                {other && <span className={ov === undefined ? 'rx-dim' : r.value - ov >= 0 ? 'rx-pos' : 'rx-neg'}>{ov === undefined ? '–' : `${r.value - ov >= 0 ? '+' : ''}${(r.value - ov).toFixed(0)}`}</span>}
              </button>
              {isOpen && (
                <div className="rx-attr-detail">
                  {k !== 'ovr' && attrNote(e.pos, k) && <p className="rx-note">{attrNote(e.pos, k)}</p>}
                  <ContributionBars result={r} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rx-inputs">
        <h3>In-game Scouting panel (preview)</h3>
        <ScoutingPanel e={e} />
        <h3>Real stats behind it</h3>
        <table className="rx-kv">
          <tbody>
            {Object.entries(inp.stats)
              .filter(([k]) => k !== 'sacksOfficial')
              .map(([k, s]) => {
                const v = s as { v: number; src: string; conf: string; games?: number };
                return (
                  <tr key={k}>
                    <td>{STAT_LABELS[k] ?? k}</td>
                    <td className="rx-num">{fmt(v.v)}</td>
                    <td>
                      <span className={`rx-conf rx-conf-${v.conf}`}>{CONF_LABEL[v.conf]}</span>
                    </td>
                    <td className="rx-src">
                      {v.src}
                      {v.games ? ` · over ${Math.round(v.games)} games` : ''}
                    </td>
                  </tr>
                );
              })}
            {inp.stats.sacksOfficial === false && (
              <tr>
                <td colSpan={4} className="rx-dim">
                  Sacks before 1982 are unofficial (researched), so they count at estimated confidence.
                </td>
              </tr>
            )}
            {inp.accolades && (
              <tr>
                <td>Honors</td>
                <td className="rx-num" colSpan={1}>
                  {inp.accolades.allPro1}× AP1 · {inp.accolades.allPro2}× AP2 · {inp.accolades.proBowl}× PB{inp.accolades.mvp ? ` · ${inp.accolades.mvp}× MVP` : ''}
                  {inp.accolades.poy ? ` · ${inp.accolades.poy}× POY` : ''} in {inp.accolades.seasons} seasons
                </td>
                <td>
                  <span className={`rx-conf rx-conf-${inp.accolades.conf}`}>{inp.accolades.conf}</span>
                </td>
                <td className="rx-src">{inp.accolades.src}</td>
              </tr>
            )}
            {Object.entries(inp.measurables).map(([k, m]) => (
              <tr key={k}>
                <td>{k === 'forty' ? '40-yard dash' : k}</td>
                <td className="rx-num">{m!.v}</td>
                <td>
                  <span className={`rx-conf rx-conf-${m!.conf}`}>{m!.conf}</span>
                </td>
                <td className="rx-src">{m!.src}</td>
              </tr>
            ))}
            {inp.olUnit && (
              <tr>
                <td>Unit (legacy)</td>
                <td className="rx-num" colSpan={2}>
                  {inp.olUnit.rushYdsPerGame} rush yds/g · {inp.olUnit.sacksAllowedPerGame} sacks/g · pb {inp.olUnit.passBlockGrade} · {inp.olUnit.proBowlLinemen} PB linemen
                </td>
                <td className="rx-src">{inp.olUnit.unitId}</td>
              </tr>
            )}
          </tbody>
        </table>
        <h3>Era baseline used ({inp.baseline.src.replace('era_baselines:', '')}, {inp.baseline.conf})</h3>
        <div className="rx-baseline">
          {BASE_LABELS.filter(([k]) => typeof inp.baseline[k] === 'number').map(([k, l]) => (
            <span key={k}>
              <span className="rx-dim">{l}</span> {fmt(inp.baseline[k] as number)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
