// A finished game as the results screen, the Locker Room's "Last Game" panel
// and History show it (GDD §14). The record is built the moment the match
// is over and holds everything those screens draw, so an old game opens
// without the live match: the score and grade, the box score, both teams'
// drives, the key matchups, the Daily's perfect team, and the play of the
// game with enough of its setup (and your inputs) for the replay system to
// run it again. Pure: the game session stamps the time and saves it.

import { SLOT_ORDER } from '@data/legacy/constants';
import adapterFile from '@data/ratings/adapter.v1.json';
import { adaptDefenders, adaptOffense, unitAttrs, type AdapterFile, type AttrLookup } from '@/engine/legacy/adapter';
import { buildMatchups } from '@/engine/legacy/sim';
import type { Roster as LegacyRoster, RosterEntry } from '@/engine/legacy/types';
import type { DefCall, Difficulty, InputFrame } from '@/sim';
import type { RatedBeasts } from './beasts';
import type { Catalog, DraftMode, Roster } from './draft';
import { clockLabel, matchGrade, type BeastsDrive, type GameLength, type Grade, type Match, type UserDrive } from './match';
import type { GameBox, PlayLog } from './stats';

/** Bump when a stored record's shape changes (History drops records it can't read). */
export const RECORD_VERSION = 1;

export interface Matchup {
  slot: string;
  rec: string;
  def: string;
  line: string;
  verdict: 'REC WON' | 'DEF WON' | 'EVEN';
}

/** What the replay system needs to run a snap again: the sim's setup (the rosters come from the record's ids) and your inputs, run-length encoded. */
export interface ReplayCapsule {
  seed: number;
  playId: string;
  def: DefCall;
  los: number;
  ballY: number;
  toGo: number;
  down: number;
  difficulty?: Difficulty;
  tapMax?: number;
  flip?: boolean;
  fatigue?: Record<string, number>;
  /** [count, frame] runs: the InputFrame the sim got each tick. */
  frames: [number, InputFrame][];
}

export interface PlayOfGame extends PlayLog {
  /** Flagged for the replay system (M7): it plays this back from the capsule. */
  replay: { flagged: true; capsule: ReplayCapsule | null };
}

export interface GameRecord {
  v: typeof RECORD_VERSION;
  id: string;
  /** Epoch ms the game ended. */
  finishedAt: number;
  mode: DraftMode;
  dailyKey: string | null;
  seed: number;
  drives: GameLength;
  difficulty: Difficulty;
  /** Played to the final whistle, or left from the pause menu before it. */
  end: 'final' | 'left';
  ot: number;
  /** The clock when it ended: "FINAL", "FINAL/OT", or where you left it ("Q3 7:30"). */
  clock: string;
  score: { user: number; beasts: number };
  /** Null when you left early (there's no margin to grade). */
  grade: { grade: Grade; label: string } | null;
  /** Your eleven, and the Beasts', in lineup order, for the headers and the replay. */
  offense: { slot: string; id: string; name: string; num: number; pos: string }[];
  beasts: { slot: string; id: string; name: string; num: number; pos: string }[];
  /** The receiver the Beasts' top corner drew (legacy's WR1 by ability): the coverage snapshot follows him. */
  bestReceiver: string | null;
  box: GameBox;
  userDrives: UserDrive[];
  beastsDrives: BeastsDrive[];
  playOfGame: PlayOfGame | null;
  matchups: Matchup[];
  /** The Daily: the perfect team and your picks against it. */
  perfect: { slot: string; pick: string | null; mine: string | null; same: boolean }[] | null;
}

export interface RecordMeta {
  id: string;
  finishedAt: number;
  mode: DraftMode;
  dailyKey: string | null;
  difficulty: Difficulty;
  end: 'final' | 'left';
  offense: GameRecord['offense'];
  beasts: GameRecord['beasts'];
  matchups: Matchup[];
  perfect: GameRecord['perfect'];
}

/** The record of a game (the match as it stands: over, or left). */
export function buildRecord(m: Match, box: GameBox, meta: RecordMeta, plays: PlayLog[], pog: { index: number; capsule: ReplayCapsule | null } | null): GameRecord {
  const final = m.phase === 'final' && meta.end === 'final';
  const margin = m.score.user - m.score.beasts;
  // Drives still open when you left: close them on the chart as they stood.
  const userDrives = m.userDrives.map((d) => ({ ...d }));
  if (!final && m.drive && m.drive.plays > 0) userDrives.push({ ...m.drive, result: 'EndOfGame' });
  const p = pog && pog.index >= 0 ? plays[pog.index] : undefined;
  return {
    v: RECORD_VERSION,
    id: meta.id,
    finishedAt: meta.finishedAt,
    mode: meta.mode,
    dailyKey: meta.dailyKey,
    seed: m.cfg.seed,
    drives: m.cfg.drives,
    difficulty: meta.difficulty,
    end: final ? 'final' : 'left',
    ot: m.ot,
    clock: final ? clockLabel(m) : clockLabel({ ...m, phase: m.phase === 'final' ? 'drive' : m.phase }),
    score: { ...m.score },
    grade: final ? matchGrade(margin, m.cfg.drives) : null,
    offense: meta.offense,
    beasts: meta.beasts,
    bestReceiver: meta.matchups[0]?.rec ?? meta.offense.find((o) => o.slot === 'X')?.name ?? null,
    box: structuredClone(box),
    userDrives,
    beastsDrives: m.beastsDrives.map((d) => ({ ...d })),
    playOfGame: p ? { ...p, replay: { flagged: true, capsule: pog!.capsule } } : null,
    matchups: meta.matchups,
    perfect: meta.perfect,
  };
}

/** Run-length encode a play's input frames (most ticks repeat the last). */
export function encodeFrames(frames: readonly InputFrame[]): [number, InputFrame][] {
  const out: [number, InputFrame][] = [];
  let prev = '';
  for (const f of frames) {
    const k = JSON.stringify(f);
    if (k === prev) out[out.length - 1]![0]++;
    else {
      out.push([1, JSON.parse(k) as InputFrame]);
      prev = k;
    }
  }
  return out;
}

export function decodeFrames(runs: readonly [number, InputFrame][]): InputFrame[] {
  const out: InputFrame[] = [];
  for (const [n, f] of runs) for (let i = 0; i < n; i++) out.push(f);
  return out;
}

/** A stored record this build can read. */
export function isReadableRecord(x: unknown): x is GameRecord {
  const r = x as GameRecord | null;
  return !!r && typeof r === 'object' && r.v === RECORD_VERSION && typeof r.id === 'string' && !!r.box && !!r.score;
}

// ---- Key matchups ----------------------------------------------------------------------

/**
 * Legacy buildMatchups on the new ratings (the adapter), the pairings
 * legacy draws (WR1 on the top corner and so on). The verdict is how those
 * targets went in this game when that defender was nearest the ball, or by
 * yards per target overall: 8+ the receiver won, under 4 the defense won.
 */
export function keyMatchups(cat: Catalog, roster: Roster, beasts: RatedBeasts, box: GameBox): Matchup[] {
  if (SLOT_ORDER.some((k) => !roster[k])) return [];
  try {
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
    const off = adaptOffense(legacy as unknown as LegacyRoster, attrsOf, adapterFile as unknown as AdapterFile);
    const defs = adaptDefenders(beasts.beasts, attrsOf, adapterFile as unknown as AdapterFile);
    const M = buildMatchups(off, defs);
    return M.cov.map((c) => {
      const rec = box.rec[c.rec.name];
      const vs = box.covered[c.rec.name]?.[c.defender.n];
      const tgt = vs?.tgt ?? rec?.tgt ?? 0;
      const yds = vs?.yds ?? rec?.yds ?? 0;
      const ypt = tgt ? yds / tgt : null;
      const edge = (c.rec.sep + c.rec.big) / 2 - c.defender.cover;
      const verdict: Matchup['verdict'] = ypt === null ? (edge > 4 ? 'REC WON' : edge < -4 ? 'DEF WON' : 'EVEN') : ypt >= 8 ? 'REC WON' : ypt < 4 ? 'DEF WON' : 'EVEN';
      return { slot: c.slot, rec: c.rec.name, def: c.defender.n, line: tgt ? `${tgt} tgt, ${Math.round(yds)} yd` : 'not targeted', verdict };
    });
  } catch {
    return [];
  }
}
