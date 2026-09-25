import { useEffect, useMemo, useState } from 'react';
import { SLOT_ORDER } from '@data/legacy/constants';
import adapterFile from '@data/ratings/adapter.v1.json';
import { useApp } from '@/app/appStore';
import { useDraft } from '@/app/draftStore';
import { Audio } from '@/audio/audio';
import { adaptDefenders, adaptOffense, unitAttrs, type AdapterFile, type AttrLookup } from '@/engine/legacy/adapter';
import { gradeQB, gradeRec, gradeRush, scoreToGrade, gradeColor } from '@/engine/legacy/grades';
import { buildMatchups } from '@/engine/legacy/sim';
import type { Roster as LegacyRoster, RosterEntry } from '@/engine/legacy/types';
import { game, useGame, type GameBox } from '@/game/game';
import { matchGrade } from '@/game/match';
import type { Catalog, Roster } from '@/game/draft';
import type { RatedBeasts } from '@/game/beasts';
import { useMenuNav } from '../nav';
import { Hints, MenuItem } from '../components/controls';
import '../styles/results.css';

// The results screen (GDD §14): the final score counting up, win or loss
// and the dominance grade, the box score with legacy's per-player grades
// (yardage scaled to the game's length) and the big hits, the key matchups
// (legacy buildMatchups on the new ratings through the adapter; the verdict
// from how those targets actually went), the drive strip, and for the Daily
// the perfect-team comparison.

export function ResultsScreen() {
  const go = useApp((s) => s.go);
  const m = game.match;
  const box = useGame((s) => s.box);
  const d = useDraft();
  const [shown, setShown] = useState({ u: 0, b: 0 });
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    if (!m) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1400);
      const e = 1 - Math.pow(1 - k, 3);
      setShown({ u: Math.round(m.score.user * e), b: Math.round(m.score.beasts * e) });
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [m]);
  const matchups = useMemo(() => (d.cat && d.draft && d.beasts ? keyMatchups(d.cat, d.draft.roster, d.beasts, box) : []), [d.cat, d.draft, d.beasts, box]);
  const items = [
    { label: 'Locker Room', run: () => void useDraft.getState().view().then(() => go('draft')) },
    { label: 'Draft again', run: () => void useDraft.getState().begin(d.mode === 'daily' ? 'classic' : d.mode).then(() => go('draft')) },
    { label: 'Main menu', run: () => go('main') },
  ];
  const pick = (i: number) => {
    Audio.uiSelect();
    game.leave();
    items[i]!.run();
  };
  useMenuNav({ count: items.length, focus, setFocus, onConfirm: pick });
  if (!m) return <div className="practice-loading">No game.</div>;
  const margin = m.score.user - m.score.beasts;
  const won = margin > 0;
  const g = matchGrade(margin, m.cfg.drives);
  const scale = 10 / m.cfg.drives; // legacy grades read a 10-drive game's yardage
  const perfect = d.daily?.perfect ?? null;
  return (
    <div className="menu-screen results">
      <div className="menu-scrim strong" />
      <header className="res-head">
        <div className={`res-banner ${won ? 'win' : 'loss'}`}>{won ? 'Victory' : 'Defeat'}</div>
        <div className="res-score">
          <span className="us">Contenders {shown.u}</span>
          <span className="dash">–</span>
          <span className="them">{shown.b} Beasts</span>
        </div>
        <div className="res-grade">
          <span className="grade">{g.grade}</span>
          <span className="label">{g.label}</span>
          {m.ot ? <span className="ot">{m.ot > 1 ? `${m.ot} overtimes` : 'Overtime'}</span> : null}
        </div>
      </header>
      <div className="res-body">
        <section className="res-box">
          <h3>Box score</h3>
          <table>
            <thead>
              <tr>
                <th>Passing</th>
                <th>C/A</th>
                <th>Yds</th>
                <th>TD</th>
                <th>Int</th>
                <th>Sk</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{box.pass.name}</td>
                <td>
                  {box.pass.cmp}/{box.pass.att}
                </td>
                <td>{Math.round(box.pass.yds)}</td>
                <td>{box.pass.td}</td>
                <td>{box.pass.int}</td>
                <td>{box.pass.sacks}</td>
                <GradeCell s={gradeQB({ ...box.pass, yds: box.pass.yds * scale })} />
              </tr>
            </tbody>
            <thead>
              <tr>
                <th>Rushing</th>
                <th>Car</th>
                <th>Yds</th>
                <th>TD</th>
                <th>Long</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.values(box.rush).map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.car}</td>
                  <td>{Math.round(r.yds)}</td>
                  <td>{r.td}</td>
                  <td>{Math.round(r.long)}</td>
                  <td />
                  <GradeCell s={gradeRush({ ...r, yds: r.yds * scale })} />
                </tr>
              ))}
            </tbody>
            <thead>
              <tr>
                <th>Receiving</th>
                <th>Rec/Tgt</th>
                <th>Yds</th>
                <th>TD</th>
                <th>Long</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.values(box.rec).map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>
                    {r.rec}/{r.tgt}
                  </td>
                  <td>{Math.round(r.yds)}</td>
                  <td>{r.td}</td>
                  <td>{Math.round(r.long)}</td>
                  <td />
                  <GradeCell s={gradeRec({ ...r, yds: r.yds * scale })} />
                </tr>
              ))}
            </tbody>
          </table>
          <div className="res-team">
            <span>{box.plays} plays</span>
            <span>{Math.round(box.yards)} yd</span>
            <span>{box.firstDowns} first downs</span>
            <span>{box.sacks} sacks taken</span>
            <span>{box.turnovers} turnovers</span>
            <span className="hits">{box.bigHits} big hits taken</span>
          </div>
        </section>
        <section className="res-side">
          <h3>Key matchups</h3>
          <ul className="res-matchups">
            {matchups.map((x) => (
              <li key={x.rec}>
                <span className="slot">{x.slot}</span>
                <span className="who">
                  {x.rec} <em>vs</em> {x.def}
                </span>
                <span className="line">{x.line}</span>
                <span className={`verdict v-${x.verdict.split(' ')[0]!.toLowerCase()}`}>{x.verdict}</span>
              </li>
            ))}
          </ul>
          <h3>Drives</h3>
          <ol className="res-drives">
            {m.userDrives.map((u, i) => (
              <li key={i}>
                <span className="b">{m.beastsDrives[i]?.result ?? ''}</span>
                <span className={`u r-${u.result}`}>{u.result === 'TD' ? `TD ${u.points > 6 ? `+${u.points - 6}` : ''}` : u.result}</span>
              </li>
            ))}
          </ol>
          {perfect ? (
            <>
              <h3>The perfect team</h3>
              <ul className="res-perfect">
                {perfect.map((p) => {
                  const mine = d.draft?.roster[p.slot];
                  const same = mine && p.pick && mine.id === p.pick.id;
                  return (
                    <li key={p.slot} className={same ? 'same' : ''}>
                      <span className="slot">{p.slot}</span>
                      <span>{p.pick ? p.pick.name : '—'}</span>
                      <span className="you">{same ? '✓ you' : (mine?.name ?? '')}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>
      </div>
      <nav className="res-actions">
        {items.map((it, i) => (
          <MenuItem key={it.label} size="md" label={it.label} focused={focus === i} onHover={() => setFocus(i)} onClick={() => pick(i)} />
        ))}
      </nav>
      <Hints items={[{ kb: '↑↓', pad: 'D-Pad', label: 'Choose' }, { kb: 'Enter', pad: 'A', label: 'Select' }]} />
    </div>
  );
}

function GradeCell({ s }: { s: number }) {
  const g = scoreToGrade(s);
  return (
    <td className="grade-cell" style={{ color: gradeColor(g) }}>
      {g}
    </td>
  );
}

interface Matchup {
  slot: string;
  rec: string;
  def: string;
  line: string;
  verdict: 'REC WON' | 'DEF WON' | 'EVEN';
}

/**
 * Legacy buildMatchups on the new ratings (the adapter), the pairings
 * legacy draws (WR1 on the top corner and so on). The verdict is how those
 * targets went in this game when that defender was nearest the ball, or by
 * yards per target overall: 8+ the receiver won, under 4 the defense won.
 */
function keyMatchups(cat: Catalog, roster: Roster, beasts: RatedBeasts, box: GameBox): Matchup[] {
  if (SLOT_ORDER.some((k) => !roster[k])) return [];
  const attrs = new Map<string, Record<string, number>>();
  const legacy = {} as Record<string, RosterEntry>;
  for (const k of SLOT_ORDER) {
    const p = roster[k]!;
    const a = p.linemen ? unitAttrs(p.id, (id) => cat.entry.get(id)?.attrs) : cat.entry.get(p.id)?.attrs;
    if (a) attrs.set(`${p.name}|${p.team}|${p.decade}`, a);
    legacy[k] = { n: p.name, t: p.team, d: p.decade, p: p.pos, imp: p.imp, s: {} };
  }
  for (const b of beasts.beasts) {
    const a = cat.entry.get(b.id)?.attrs;
    if (a) attrs.set(`${b.n}|${b.t}|${b.d}`, a);
  }
  const attrsOf: AttrLookup = (e) => attrs.get(`${e.n}|${e.t}|${e.d}`);
  try {
    const off = adaptOffense(legacy as unknown as LegacyRoster, attrsOf, adapterFile as unknown as AdapterFile);
    const defs = adaptDefenders(beasts.beasts, attrsOf, adapterFile as unknown as AdapterFile);
    const M = buildMatchups(off, defs);
    return M.cov.map((c) => {
      const rec = box.rec[c.rec.name];
      const vs = box.covered[c.rec.name]?.[c.defender.n];
      const tgt = vs?.tgt ?? rec?.tgt ?? 0;
      const yds = vs?.yds ?? rec?.yds ?? 0;
      const ypt = tgt ? yds / tgt : null;
      const verdict: Matchup['verdict'] = ypt === null ? (c.rec.sep + c.rec.big) / 2 - c.defender.cover > 4 ? 'REC WON' : (c.rec.sep + c.rec.big) / 2 - c.defender.cover < -4 ? 'DEF WON' : 'EVEN' : ypt >= 8 ? 'REC WON' : ypt < 4 ? 'DEF WON' : 'EVEN';
      return { slot: c.slot, rec: c.rec.name, def: c.defender.n, line: tgt ? `${tgt} tgt, ${Math.round(yds)} yd` : 'not targeted', verdict };
    });
  } catch {
    return [];
  }
}
