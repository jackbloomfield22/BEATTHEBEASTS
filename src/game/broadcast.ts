// The broadcast's reading of the game (GDD §11.4, §11.7): what the caption
// bar says and who gets a lower third. Pure: each builder turns a finished
// snap, a Beasts possession, a kick or a situation into a commentary event
// (src/game/commentary.ts: its kind, the names and numbers it can say, the
// situation and trait tags) and, for a big play, its hero: the man the
// lower third names. The game session (game.ts) feeds them and the overlay
// store (onAir.ts) holds what's on screen.

import type { PlayState, SimPlayer } from '@/sim';
import type { CallKind, Slots } from './commentary';
import { isTimed, type BeastsDrive, type Match, type PuntResult, type UserDrive } from './match';
import type { KickResult } from './kick';
import type { Situation } from './situation';

export type Team = 'con' | 'bst';

/** The man a big play's lower third names, and the tag over his name ("34-YD TD CATCH"). */
export interface Hero {
  player: SimPlayer;
  team: Team;
  tag: string;
  /** His slot in the line (the trait the commentary picked is matched against it). */
  role: keyof Slots;
}

export interface Call {
  kind: CallKind;
  slots: Slots;
  tags: string[];
  /** A big play's hero (null: the caption only). */
  hero: Hero | null;
  /** Whose moment it is: the caption's accent. */
  team: Team | null;
}

/** A spot as the broadcast says it: "CON 25", "50", "BST 32" (yards from the Contenders' goal line). */
export function broadcastSpot(los: number): string {
  const y = Math.round(los);
  return y === 50 ? '50' : y < 50 ? `CON ${y}` : `BST ${100 - y}`;
}

/** The context of a snap the session knows and the play doesn't. */
export interface SnapContext {
  before: Situation;
  /** The match's outcome for the snap (match.ts PlayOutcome). */
  outcome: string | null;
  score: { user: number; beasts: number };
  after: { user: number; beasts: number };
  /** The last round, the fourth quarter or overtime. */
  late: boolean;
  /** A two-point try (one play from the 3). */
  twoPoint: boolean;
}

/** Gains this long are big plays (a broadcast's "explosive" thresholds: 20+ through the air, 15+ on the ground). */
export const BIG_PASS = 20;
export const BIG_RUN = 15;

const lastName = (name: string): string => name.split(' ').slice(-1)[0] ?? name;

/** Score tags: who leads after it, and whether it's late and close. */
function scoreTags(before: { user: number; beasts: number }, after: { user: number; beasts: number }, late: boolean): string[] {
  const t: string[] = [];
  if (before.user <= before.beasts && after.user > after.beasts) t.push('takesLead');
  if (before.user !== before.beasts && after.user === after.beasts) t.push('tiesIt');
  if (late) t.push('late');
  if (Math.abs(after.user - after.beasts) <= 8 || Math.abs(before.user - before.beasts) <= 8) t.push('close');
  return t;
}

/**
 * A finished snap: the commentary's event and the lower third's hero.
 * Names are last names as a booth says them (a full name when two men on the
 * field share one); the hero keeps the whole player.
 */
export function callForSnap(s: PlayState, c: SnapContext): Call {
  const r = s.result!;
  const A = (i: number | undefined): SimPlayer | null => (i !== undefined && i >= 0 && s.agents[i] ? s.agents[i]!.p : null);
  const name = (i: number | undefined): string | null => {
    const p = A(i);
    if (!p?.name) return null;
    const l = lastName(p.name);
    return s.agents.filter((a) => lastName(a.p.name) === l).length > 1 ? p.name : l;
  };
  const last = (type: string) => [...s.events].reverse().find((e) => e.type === type);
  const first = (type: string) => s.events.find((e) => e.type === type);
  const thr = last('throw');
  const target = thr?.who?.[1] ?? (r.pass?.attempted ? r.pass.target : undefined);
  const carrier = s.carrier >= 0 ? s.carrier : undefined;
  const qb = s.qb;
  const yards = Math.round(r.offenseBall ? r.spot - c.before.los : 0);
  const air = Number(thr?.data?.air ?? 0);
  const caught = !!last('catch');
  const tags = new Set<string>(scoreTags(c.score, c.after, c.late));
  const roles: Partial<Record<keyof Slots, number>> = {};
  const slots: Slots = {};
  const put = (role: 'passer' | 'receiver' | 'runner' | 'defender' | 'tackler' | 'rusher' | 'hitter', i: number | undefined) => {
    if (i === undefined || i < 0) return;
    roles[role] = i;
    slots[role] = name(i);
    for (const t of A(i)?.traits ?? []) tags.add(`${role}:${t}`);
  };
  const tackleBy = last('tackle')?.who?.[0] ?? last('sack')?.who?.[0];
  // The situation.
  const b = c.before;
  if (b.down === 3) tags.add('thirdDown');
  if (b.down === 4) tags.add('fourthDown');
  if (b.los >= 95) tags.add('goalLine');
  if (b.los >= 80) tags.add('redZone');
  if (r.offenseBall && yards >= b.toGo - 1e-6 && !r.touchdown) tags.add('firstDown');
  if (r.offenseBall && b.down >= 3 && yards > 0 && yards < b.toGo && r.reason !== 'incomplete') tags.add('shortOfSticks');
  if (yards < 0) tags.add('loss');
  if (yards > 0) tags.add('gain');
  const type = s.setup.play.type;
  if (type === 'quick') tags.add('quick');
  if (type === 'screen') tags.add('screen');
  if (type === 'playAction') tags.add('playAction');
  if (air >= 20) tags.add('deep');
  if (caught && yards - air >= 10) tags.add('yac');
  if ((r.pass?.contest ?? 0) >= 0.5) tags.add('contested');
  const why = String(thr?.data?.why ?? '');
  if (why === 'pressure') tags.add('pressure');
  if (why === 'on the run') tags.add('onRun');
  const mech = String(thr?.data?.mech ?? '');
  if (mech === 'sail') tags.add('sail');
  if (mech === 'short') tags.add('short');
  if (carrier !== undefined) {
    if (s.events.some((e) => e.type === 'brokenTackle' && e.who?.[0] === carrier)) tags.add('brokenTackle');
    for (const e of s.events) if (e.type === 'move' && e.who?.[0] === carrier && e.data?.move) tags.add(`move:${String(e.data.move)}`);
    if (s.agents[carrier]?.slot === 'QB') tags.add('qb');
  }
  const done = (kind: CallKind, team: Team | null, hero: Hero | null): Call => {
    slots.yards ??= Math.abs(yards);
    return { kind, slots, tags: [...tags], hero, team };
  };
  const hero = (i: number | undefined, team: Team, tag: string, role: keyof Slots): Hero | null => {
    const p = A(i);
    return p ? { player: p, team, tag, role } : null;
  };

  // The two-point try: in or not.
  if (c.twoPoint) {
    if (r.offenseBall && r.touchdown) {
      put('runner', carrier);
      return done('twoPointGood', 'con', hero(carrier, 'con', 'Two-point try', 'runner'));
    }
    put('tackler', tackleBy);
    return done('twoPointFailed', 'bst', null);
  }
  // Turnovers.
  if (!r.offenseBall) {
    const pick = last('interception');
    if (pick) {
      put('defender', pick.who?.[0]);
      put('passer', qb);
      put('receiver', target);
      if (r.touchdown) return done('pickSix', 'bst', hero(pick.who?.[0], 'bst', 'Pick-six', 'defender'));
      return done('int', 'bst', hero(pick.who?.[0], 'bst', 'Interception', 'defender'));
    }
    const strip = s.events.find((e) => e.type === 'fumble' && e.data?.sack);
    const rec = last('recovery');
    if (strip) {
      tags.add('lost');
      put('rusher', strip.who?.[1]);
      put('passer', qb);
      return done('stripSack', 'bst', hero(strip.who?.[1], 'bst', 'Strip sack', 'rusher'));
    }
    const fum = last('fumble');
    put('runner', fum?.who?.[0] ?? carrier);
    put('hitter', fum?.who?.[1]);
    put('defender', rec?.who?.[0]);
    if (r.touchdown) tags.add('returnTD');
    const forcer = fum?.who?.[1];
    return done('fumble', 'bst', forcer !== undefined ? hero(forcer, 'bst', 'Forced fumble', 'hitter') : hero(rec?.who?.[0], 'bst', 'Fumble recovery', 'defender'));
  }
  if (r.touchdown) {
    const dist = Math.round(100 - b.los);
    slots.yards = dist;
    if (dist >= 20) tags.add('long');
    if (caught) {
      put('passer', qb);
      put('receiver', carrier);
      return done('passTD', 'con', hero(carrier, 'con', `${dist}-yd TD catch`, 'receiver'));
    }
    put('runner', carrier);
    return done('rushTD', 'con', hero(carrier, 'con', `${dist}-yd TD run`, 'runner'));
  }
  if (r.reason === 'safety') {
    put('runner', carrier);
    put('tackler', tackleBy);
    return done('safety', 'bst', hero(tackleBy, 'bst', 'Safety', 'tackler'));
  }
  if (r.sack) {
    const sackBy = first('sack')?.who?.[0] ?? tackleBy;
    put('rusher', sackBy);
    put('passer', qb);
    slots.loss = Math.max(0, -yards);
    if (s.events.some((e) => e.type === 'fumble' && e.data?.sack)) return done('stripSack', 'con', null);
    const loss = Math.max(0, -yards);
    return done('sack', 'bst', hero(sackBy, 'bst', loss ? `Sack · −${loss} yd` : 'Sack', 'rusher'));
  }
  if (r.reason === 'incomplete') {
    put('passer', qb);
    put('receiver', target);
    const kind: CallKind = c.outcome === 'downs' ? 'downs' : 'incomplete';
    if (s.ball.target === -3) return done(c.outcome === 'downs' ? 'downs' : 'throwAway', null, null);
    const oob = last('catchOutOfBounds');
    if (oob) {
      put('receiver', oob.who?.[0]);
      return done(c.outcome === 'downs' ? 'downs' : 'catchOOB', null, null);
    }
    const drop = last('drop');
    if (drop) {
      put('receiver', drop.who?.[0]);
      if (drop.data?.why === 'contact') tags.add('contact');
      return done(c.outcome === 'downs' ? 'downs' : 'drop', null, null);
    }
    const defl = last('deflection');
    if (defl) {
      put('defender', defl.who?.[0]);
      return done(c.outcome === 'downs' ? 'downs' : defl.data?.batted ? 'batted' : 'breakup', 'bst', null);
    }
    return done(kind, null, null);
  }
  // A gain (or a loss) with the ball in hand.
  put('tackler', tackleBy);
  const big = r.bigHit;
  if (big) put('hitter', big.by);
  if (caught) {
    put('passer', qb);
    put('receiver', carrier);
    const rb = carrier !== undefined && (s.agents[carrier]!.slot === 'RB' || s.agents[carrier]!.slot === 'TE');
    if (rb && air <= 5) tags.add('checkdown');
  } else put('runner', carrier);
  if (c.outcome === 'downs') return done('downs', 'bst', null);
  if (big && yards < BIG_PASS) return done('bigHit', 'bst', hero(big.by, 'bst', 'Big hit', 'hitter'));
  if (caught) {
    if (yards >= BIG_PASS) return done('bigPass', 'con', hero(carrier, 'con', `${yards}-yd catch`, 'receiver'));
    return done('pass', null, null);
  }
  const scramble = s.agents[carrier ?? -1]?.slot === 'QB' && !s.setup.play.run;
  if (scramble) {
    // (The scramble line names the quarterback as the runner.)
    return done('scramble', yards >= BIG_RUN ? 'con' : null, yards >= BIG_RUN ? hero(carrier, 'con', `${yards}-yd scramble`, 'runner') : null);
  }
  if (yards <= 0) return done('stuff', 'bst', null);
  if (yards >= BIG_RUN) return done('bigRun', 'con', hero(carrier, 'con', `${yards}-yd run`, 'runner'));
  return done('run', null, null);
}

/** A Beasts possession (the Meanwhile cut). `before`: the score before it; `userScoredLast`: your last drive scored. */
export function callForBeasts(d: BeastsDrive, before: { user: number; beasts: number }, userScoredLast: boolean): Call {
  const kind: CallKind = { TD: 'beastsTD', FG: 'beastsFG', Punt: 'beastsPunt', Turnover: 'beastsTurnover', Downs: 'beastsDowns', Safety: 'beastsSafety', MissedFG: 'beastsMissedFG', EndOfHalf: 'beastsHalf', EndOfGame: 'beastsGame' }[d.result] as CallKind;
  const tags: string[] = [];
  if (before.user === 0 && before.beasts === 0 && d.points > 0) tags.push('opening');
  if (userScoredLast && d.points > 0) tags.push('answer');
  if (d.twoPoint?.good) tags.push('twoGood');
  if (d.result === 'Punt' && d.plays <= 3) tags.push('threeAndOut');
  if (before.beasts + d.points > before.user + (d.result === 'Safety' ? 2 : 0)) tags.push('beastsLead');
  return { kind, slots: { plays: d.plays, yards: Math.max(0, Math.round(d.yards)), top: d.top }, tags, hero: null, team: d.points > 0 ? 'bst' : 'con' };
}

/** A PAT or a field goal, struck. */
export function callForKick(kind: 'PAT' | 'FG', distance: number, res: KickResult, wind: { mph: number }, before: { user: number; beasts: number }, late: boolean): Call {
  const pts = kind === 'PAT' ? 1 : 3;
  const after = res.good ? { ...before, user: before.user + pts } : before;
  const tags = [...scoreTags(before, after, late), ...(wind.mph >= 12 ? ['windy'] : [])];
  if (res.why === 'wideLeft') tags.push('wideLeft');
  if (res.why === 'wideRight') tags.push('wideRight');
  if (res.why === 'short') tags.push('shortKick');
  if (res.why === 'doink') tags.push('doink');
  const k: CallKind = kind === 'PAT' ? (res.good ? 'patGood' : 'patMiss') : res.good ? 'fgGood' : 'fgMiss';
  return { kind: k, slots: { yards: Math.round(distance) }, tags, hero: null, team: res.good ? 'con' : 'bst' };
}

/** A punt, down. */
export function callForPunt(p: PuntResult): Call {
  const tag = { returned: 'returned', fairCatch: 'fairCatch', outOfBounds: 'puntOut', touchback: 'touchback', downed: 'downed' }[p.how];
  return { kind: 'punt', slots: { yards: p.gross, net: p.net }, tags: [tag], hero: null, team: null };
}

/** What the caller knows about the clock and the drive before a snap. */
export interface SituationContext {
  sit: Situation;
  /** The drive's first snap. */
  driveStart: boolean;
  /** The game's first snap. */
  firstSnap: boolean;
  /** Going for it on fourth down (the decision was made). */
  goingForIt: boolean;
  score: { user: number; beasts: number };
  /** A live clock in the last two minutes of a half: its text and the timeouts. */
  twoMinute: { clock: string; timeouts: number } | null;
  /** Lines already said this drive (each said once a drive). */
  saidThisDrive: ReadonlySet<CallKind>;
}

/**
 * Before the snap: a line only when the situation is worth one (restraint:
 * most snaps say nothing until the whistle). In order: the two-minute drill,
 * fourth down, goal to go, third down, the red zone, the drive's start.
 */
export function callForSituation(c: SituationContext): Call | null {
  const s = c.sit;
  const diff = c.score.beasts - c.score.user;
  const toGo = Math.max(1, Math.round(s.toGo));
  const spot = broadcastSpot(s.los);
  const once = (k: CallKind) => !c.saidThisDrive.has(k);
  const need = diff <= 0 ? null : diff <= 3 ? 'a field goal' : diff <= 8 ? 'a touchdown' : 'more than one score';
  if (c.twoMinute && diff >= 0 && once('twoMinute')) return { kind: 'twoMinute', slots: { clock: c.twoMinute.clock, timeouts: c.twoMinute.timeouts, need }, tags: need ? ['trailing'] : [], hero: null, team: null };
  if (s.down === 4 && c.goingForIt) return { kind: 'fourthDown', slots: { toGo }, tags: [], hero: null, team: null };
  if (s.los + s.toGo >= 100 && (s.down === 1 ? once('goalToGo') : s.down >= 3)) return { kind: 'goalToGo', slots: { spot }, tags: s.down === 1 ? ['down1'] : [], hero: null, team: null };
  if (s.down === 3 && toGo >= 7) return { kind: 'thirdLong', slots: { toGo }, tags: [], hero: null, team: null };
  if (s.down === 3 && toGo <= 2) return { kind: 'thirdShort', slots: { toGo }, tags: [], hero: null, team: null };
  if (s.los >= 80 && s.los + s.toGo < 100 && once('redZone') && !c.driveStart) return { kind: 'redZone', slots: {}, tags: [], hero: null, team: null };
  if (c.driveStart) {
    const tags = [...(c.firstSnap ? ['firstSnap'] : []), ...(s.los >= 50 ? ['shortField'] : []), ...(s.los <= 10 ? ['backedUp'] : []), ...(diff > 0 ? ['trailing'] : [])];
    return { kind: 'driveStart', slots: { spot, deficit: diff > 0 ? diff : null }, tags, hero: null, team: null };
  }
  return null;
}

/** One possession on the drive strip: whose, and how it went (lime for your scores, crimson for theirs, dim for stops). */
export interface Pip {
  team: Team;
  tone: 'con' | 'bst' | 'stop';
  /** "TD", "Punt": the strip's tooltip and its accessible name. */
  label: string;
}

const RESULT_WORD: Record<string, string> = { TD: 'TD', FG: 'FG', MissedFG: 'Missed FG', Punt: 'Punt', Turnover: 'Turnover', Downs: 'Downs', Safety: 'Safety', EndOfHalf: 'End of half', EndOfGame: 'End of game', TwoPoint: 'Two-point try' };

function pipOfUser(d: UserDrive): Pip {
  // (A pick-six or a safety on your drive is their score.)
  const tone = d.against > 0 ? 'bst' : d.points > 0 ? 'con' : 'stop';
  return { team: 'con', tone, label: d.against > 0 && d.result === 'Turnover' ? 'Pick-six' : (RESULT_WORD[d.result] ?? d.result) };
}

function pipOfBeasts(d: BeastsDrive): Pip {
  const tone = d.points > 0 ? 'bst' : d.result === 'Safety' ? 'con' : 'stop';
  return { team: 'bst', tone, label: RESULT_WORD[d.result] ?? d.result };
}

/**
 * The drive strip (legacy's progress strip, revived): every possession so far
 * in order, the one on now, and in Quick Play's drive count the ones still to
 * come (a timed game doesn't know how many). Possessions carry their order
 * (match.ts seq); a record from before it falls back to Beasts first, then yours.
 */
export function driveStrip(m: Pick<Match, 'beastsDrives' | 'userDrives' | 'phase' | 'ot' | 'cfg'>): { pips: Pip[]; now: Team | null; left: number } {
  const all: { seq: number; pip: Pip }[] = [
    ...m.beastsDrives.map((d, i) => ({ seq: d.seq ?? i * 2, pip: pipOfBeasts(d) })),
    ...m.userDrives.map((d, i) => ({ seq: d.seq ?? i * 2 + 1, pip: pipOfUser(d) })),
  ].sort((a, b) => a.seq - b.seq);
  const pips = all.map((x) => x.pip);
  const now: Team | null = m.phase === 'final' ? null : m.phase === 'meanwhile' ? 'bst' : 'con';
  const left = isTimed(m as Match) || m.ot || m.phase === 'final' ? 0 : Math.max(0, m.cfg.drives * 2 - pips.length - (now ? 1 : 0));
  return { pips, now, left };
}
