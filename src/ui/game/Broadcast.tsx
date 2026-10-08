import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { urlFlags } from '@/app/platform';
import { useSettings } from '@/app/settings';
import { broadcastSpot, driveStrip, type Team } from '@/game/broadcast';
import { useCelebration } from '@/game/celebration';
import { game, useGame } from '@/game/game';
import { clockText, type Match } from '@/game/match';
import { useMontage } from '@/game/montageSession';
import { useOnAir, type LowerUi } from '@/game/onAir';
import { usePractice } from '@/game/practice';
import { useReplay } from '@/game/replaySession';
import '../styles/broadcast.css';

// The broadcast package (M7, GDD §11.4 and §11.7): one visual language for
// everything the "network" puts over the game.
//   the score bug, top centre: CON and BST with their scores, the ball by
//     the team that has it, your timeouts, the quarter, the game clock, the
//     play clock, and down and distance with the spot;
//   the drive strip under it (legacy's progress strip): one pip a
//     possession, lime for your scores, crimson for theirs, dim for stops;
//   the lower third, bottom left: a big play's man (number, name, position,
//     team and decade, a trait) over the play's line;
//   the caption bar in the same place when there's a line and no man to
//     name: the situation before the snap, the call after the whistle;
//   the wind flag on kicks.
// React renders on events only (a whistle, a line, the clock's whole
// seconds); nothing here runs per frame. The HUD scale setting sizes all of
// it; the caption size setting sizes the line (Off hides it).

const Q_WORD = ['1st', '2nd', '3rd', '4th'];

/** The overlay's root style: the HUD scale setting. */
export function useHudScale(): CSSProperties {
  const s = useSettings((x) => x.settings.display.hudScale);
  return { ['--hud-scale' as string]: String(s) };
}

/** A small football, the possession marker. */
function Ball() {
  return (
    <svg className="sb-ball" viewBox="0 0 24 14" aria-label="Possession">
      <ellipse cx="12" cy="7" rx="11" ry="6.2" />
      <path d="M7 7h10M9 5.4v3.2M11.3 5.4v3.2M13.6 5.4v3.2M15.9 5.4v3.2" />
    </svg>
  );
}

type KeyPlay = { down: number; toGo: number; los: number } | null;

/** Down and distance as the bug says it ("3rd & 4", "1st & Goal", "2-pt try"), and whether it's a big down. `key`: the montage's key play (its los from the Beasts' goal line). */
function downCell(m: Match, key: KeyPlay): { text: string; spot: string | null; tone: 'big' | 'beasts' | 'plain' | 'dim' } {
  if (m.phase === 'final') return { text: 'Final', spot: null, tone: 'dim' };
  if (m.phase === 'meanwhile' && key) return { text: `${Q_WORD[key.down - 1] ?? `${key.down}th`} & ${key.los + key.toGo >= 100 ? 'Goal' : Math.max(1, Math.round(key.toGo))}`, spot: broadcastSpot(100 - key.los), tone: 'beasts' };
  if (m.phase === 'meanwhile') return { text: 'Beasts ball', spot: null, tone: 'beasts' };
  if (m.phase === 'twoPoint') return { text: '2-pt try', spot: broadcastSpot(m.sit.los), tone: 'big' };
  if (m.phase === 'try') return { text: 'Extra point', spot: null, tone: 'plain' };
  if (m.phase === 'kick' && m.kick) return { text: m.kick.kind === 'PUNT' ? 'Punt' : m.kick.kind === 'PAT' ? 'Extra point' : `FG ${Math.round(m.kick.distance)} yd`, spot: broadcastSpot(m.sit.los), tone: 'plain' };
  const s = m.sit;
  const goal = s.los + s.toGo >= 100;
  const text = `${Q_WORD[s.down - 1] ?? `${s.down}th`} & ${goal ? 'Goal' : Math.max(1, Math.round(s.toGo))}`;
  return { text, spot: broadcastSpot(s.los), tone: s.down >= 3 ? 'big' : 'plain' };
}

/**
 * The score bug: a single bar. The scores bump when the Beasts' drive puts
 * its points up (the result graphic) before the match scores it.
 */
export function ScoreBug() {
  useGame((s) => s.v);
  const after = useMontage((s) => (s.shot === 'result' ? s.info?.after : null));
  // The montage's key play: its down, distance and spot while it's on screen.
  const keyPlay = useMontage((s) => (s.shot === 'play' ? (s.info?.play ?? null) : null));
  const m = game.match;
  if (!m) return null;
  const score = after ?? m.score;
  const final = m.phase === 'final';
  const pc = m.playClock;
  const running = m.clock.live && m.lastWhistle === 'runs' && pc !== null;
  const q = final ? (m.ot ? `F/${m.ot > 1 ? `${m.ot}OT` : 'OT'}` : 'Final') : m.ot ? (m.ot > 1 ? `${m.ot}OT` : 'OT') : (Q_WORD[m.clock.quarter - 1] ?? 'OT');
  const showTime = !final && !m.ot;
  const has: Team | null = final ? null : m.phase === 'meanwhile' ? 'bst' : 'con';
  const down = downCell(m, keyPlay);
  const tos = m.clock.live && !final ? m.clock.timeouts : -1;
  return (
    <div className="bc sb">
      <div className="sb-bar">
        <div className={`sb-team con ${has === 'con' ? 'has' : ''}`}>
          <span className="sb-abbr">CON</span>
          <span className={`sb-pts ${after && after.user !== m.score.user ? 'bump' : ''}`}>{score.user}</span>
          {has === 'con' ? <Ball /> : <i className="sb-ball-space" />}
          {tos >= 0 ? (
            <span className="sb-tos" title={`${tos} timeouts`}>
              {[0, 1, 2].map((i) => (
                <i key={i} className={i < tos ? 'on' : ''} />
              ))}
            </span>
          ) : null}
        </div>
        <div className={`sb-team bst ${has === 'bst' ? 'has' : ''}`}>
          <span className="sb-abbr">BST</span>
          <span className={`sb-pts ${after && after.beasts !== m.score.beasts ? 'bump' : ''}`}>{score.beasts}</span>
          {has === 'bst' ? <Ball /> : <i className="sb-ball-space" />}
        </div>
        <div className="sb-clock">
          <span className="sb-q">{q}</span>
          {showTime ? <span className={`sb-time ${running ? 'running' : ''}`}>{clockText(m.clock.secs)}</span> : null}
          {pc !== null && !final ? (
            <span className={`sb-pc ${pc <= 5 ? 'hot' : pc <= 10 ? 'warn' : ''}`} title="Play clock">
              :{String(Math.max(0, pc)).padStart(2, '0')}
            </span>
          ) : null}
        </div>
        <div className={`sb-down ${down.tone}`}>
          <span className="sb-dd">{down.text}</span>
          {down.spot ? <span className="sb-spot">{down.spot}</span> : null}
        </div>
      </div>
      <DriveStrip m={m} />
    </div>
  );
}

/** One pip a possession, in order; the one on now outlined in its team's colour; Quick Play's to come, faint. */
function DriveStrip({ m }: { m: Match }) {
  const st = driveStrip(m);
  // (Nothing played yet: no strip, rather than one lonely pip.)
  if (!st.pips.length) return null;
  return (
    <div className="sb-strip" aria-label="Drives">
      {st.pips.map((p, i) => (
        <i key={i} className={`pip t-${p.tone} by-${p.team}`} title={`${p.team === 'con' ? 'Contenders' : 'Beasts'}: ${p.label}`} />
      ))}
      {st.now ? <i className={`pip now by-${st.now}`} title={st.now === 'con' ? 'Your drive' : "The Beasts' drive"} /> : null}
      {Array.from({ length: st.left }, (_, i) => (
        <i key={`l${i}`} className="pip left" />
      ))}
    </div>
  );
}

// ---- Lower thirds and the caption bar --------------------------------------------------

/** How long a line or a lower third stays up (the capture harness and recordings hold them). */
const HOLD = urlFlags.shot !== null || urlFlags.video ? 3_600_000 : 0;
const LOWER_MS = 6500;
const LINE_MS = 6000;
const PRE_MS = 4800;

/** Up for `ms` once `key` is new and `ready` (a touchdown's waits for the celebration). */
function useUp(key: number | undefined, ms: number, ready = true): boolean {
  const [up, setUp] = useState<{ key: number; done: boolean } | null>(null);
  // A new key that's ready starts its time (state adjusted while rendering, React's pattern for state that follows a prop).
  if (key && ready && up?.key !== key) setUp({ key, done: false });
  useEffect(() => {
    if (!up || up.done) return;
    const k = up.key;
    const t = setTimeout(() => setUp((u) => (u?.key === k ? { key: k, done: true } : u)), HOLD || ms);
    return () => clearTimeout(t);
  }, [up, ms]);
  return !!key && up?.key === key && !up.done;
}

/**
 * A lower third: the shared plate (tag, a coloured block, a title, a meta
 * line) and the line under it. The player's lower third, the Meanwhile card
 * and the Beasts' drive's result are all this.
 */
export function LowerPlate({ team, tag, block, blockSmall, title, meta, line, foot, className }: { team: Team | 'neutral'; tag?: string | null; block?: ReactNode; blockSmall?: boolean; title: ReactNode; meta?: ReactNode; line?: string | null; foot?: ReactNode; className?: string }) {
  const size = useSettings((s) => s.settings.accessibility.captionSize);
  return (
    <div className={`bc lt ${team} ${className ?? ''}`}>
      {tag ? <div className="lt-tag">{tag}</div> : null}
      <div className="lt-plate">
        {block !== undefined ? <div className={`lt-block ${blockSmall ? 'small' : ''}`}>{block}</div> : null}
        <div className="lt-id">
          <div className="lt-title">{title}</div>
          {meta ? <div className="lt-meta">{meta}</div> : null}
        </div>
      </div>
      {line && size !== 'off' ? <div className={`lt-line cap-${size}`}>{line}</div> : null}
      {foot ? <div className="lt-foot">{foot}</div> : null}
    </div>
  );
}

function PlayerLower({ l }: { l: LowerUi }) {
  return (
    <LowerPlate
      team={l.team}
      tag={l.tag}
      block={l.num}
      title={l.name}
      meta={
        <>
          <span>{l.pos}</span>
          {l.stint ? <span className="lt-stint">{l.stint}</span> : null}
          {l.trait ? <span className="lt-trait">{l.trait}</span> : null}
        </>
      }
      line={l.line}
      key={l.key}
    />
  );
}

/**
 * Bottom left, between snaps: the big play's lower third (a touchdown's waits
 * for the celebration prompt to be answered, then rides with the
 * celebration), else the caption bar's line. A line before the snap goes
 * when the ball is snapped; nothing is up during a live play or a replay.
 */
export function OnAirLayer() {
  const caption = useOnAir((s) => s.caption);
  const lower = useOnAir((s) => s.lower);
  const pstage = usePractice((s) => s.stage);
  const replayOpen = useReplay((s) => s.open);
  const celeb = useCelebration((s) => s.phase);
  const size = useSettings((s) => s.settings.accessibility.captionSize);
  // A touchdown's lower third comes up with the celebration (after the prompt), or as it's skipped.
  const lowerUp = useUp(lower?.key, LOWER_MS, !lower?.td || celeb === 'play' || celeb === 'done');
  const lineUp = useUp(caption?.key, caption?.pre ? PRE_MS : LINE_MS);
  const style = useHudScale();
  if (replayOpen || pstage === 'live' || pstage === 'paused') return null;
  // The celebration's prompt owns the bottom of the screen while it's up.
  if (celeb === 'choose') return null;
  const showLower = lower && lowerUp;
  // (A big play's line is in its lower third.)
  const showLine = caption && lineUp && size !== 'off' && lower?.key !== caption.key;
  return (
    <div className="onair" style={style}>
      {showLower ? <PlayerLower l={lower} /> : null}
      {showLine ? (
        <div className={`bc cap ${caption.team ?? 'neutral'} cap-${size}`} key={caption.key}>
          {caption.text}
        </div>
      ) : null}
    </div>
  );
}

// ---- The wind flag ---------------------------------------------------------------------

/** "Into your face", "at your back", "left to right", relative to the kick (0 = blowing toward the posts you attack). */
export function windWords(w: { mph: number; dir: number }): string {
  if (w.mph <= 1) return 'Calm';
  const c = Math.cos(w.dir);
  const sn = Math.sin(w.dir);
  const along = c > 0.5 ? 'at your back' : c < -0.5 ? 'in your face' : '';
  const across = sn > 0.5 ? 'right to left' : sn < -0.5 ? 'left to right' : '';
  return [along, across].filter(Boolean).join(', ') || 'across';
}

/**
 * The wind flag on kicks: a pennant on a dial, pointing where the wind blows
 * (up is toward the posts), longer and stiffer the harder it blows, with the
 * speed and the words.
 */
export function WindFlag({ wind }: { wind: { mph: number; dir: number } }) {
  const deg = (-wind.dir * 180) / Math.PI;
  // A limp flag at 0, full length at 20 mph and up.
  const len = 6 + Math.min(1, wind.mph / 20) * 12;
  const droop = Math.max(0, 1 - wind.mph / 12) * 5;
  return (
    <div className="bc wind">
      <svg className="wind-dial" viewBox="-24 -24 48 48" aria-hidden="true">
        <circle r="21" className="wd-ring" />
        <path d="M0 -21 v5" className="wd-north" />
        {wind.mph > 1 ? (
          <g transform={`rotate(${deg})`}>
            <path d={`M0 2 L-4.2 -1 Q-2 ${-len / 2} ${droop} ${-len - 2} Q2 ${-len / 2} 4.2 -1 Z`} className="wd-flag" />
          </g>
        ) : (
          <circle r="2.4" className="wd-calm" />
        )}
      </svg>
      <div className="wind-txt">
        <span className="wind-k">Wind</span>
        <span className="wind-mph">{wind.mph > 1 ? `${wind.mph} mph` : 'Calm'}</span>
        {wind.mph > 1 ? <span className="wind-w">{windWords(wind)}</span> : null}
      </div>
    </div>
  );
}
