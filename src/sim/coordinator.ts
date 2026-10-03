// The offensive coordinator behind the play call's "Suggested" tab (GDD
// §10.1): ranked play ids for the situation (down, distance, field
// position, the clock and the score) and the roster's strengths. Pure and
// deterministic: the same situation and roster give the same list.

import { callOdds, type BeastsDefense } from './defense';
import { FILM } from './film';
import { offenseFor, playUnlocked, type ContendersRoster } from './personnel';
import { DRAWS, PLAYS, type OffPlay, type PlayType } from './plays';
import { holds } from './traits';
import type { OffSlot, SimPlayer } from './types';

export interface OffSituation {
  down: number;
  toGo: number;
  /** Line of scrimmage, yards from the offense's own goal line. */
  los: number;
  /** Seconds left in the half. */
  secondsLeft?: number;
  /** The offense's score minus the Beasts'. */
  scoreDiff?: number;
}

const has = (p: SimPlayer, ...traits: string[]): boolean => traits.some((t) => p.traits?.includes(t));
const at = (p: SimPlayer, k: string): number => p.attrs[k] ?? 50;

/**
 * What the roster does best, 0..1 each (a rating ~75 is 0, ~95 is 1):
 * - deep: a deep-threat receiver (speed and Deep Route, or the deep-threat
 *   traits) with a QB who can get it there (Deep Accuracy and Throw Power,
 *   or the deep-ball traits);
 * - quick: a QB's short accuracy and release;
 * - run: the back (Vision, Break Tackle, Elusiveness) behind the line's run blocking;
 * - te: a receiving tight end (routes and hands, the seam traits);
 * - fb: a fullback who can lead (his Pass Block stands in: backs carry no Run Block);
 * - mobile: the QB's legs (bootlegs).
 */
export function strengths(team: ContendersRoster): Record<'deep' | 'quick' | 'run' | 'te' | 'fb' | 'mobile', number> {
  const k = (x: number) => Math.max(0, Math.min(1, (x - 75) / 20));
  const wrs = [team.WR1, team.WR2, team.WR3];
  const deepWr = Math.max(...wrs.map((w) => k((at(w, 'speed') + at(w, 'deepRoute')) / 2) + (has(w, 'deep-threat', 'burner', 'vertical-nightmare', 'home-run-threat') ? 0.25 : 0)));
  const qb = team.QB;
  const arm = k((at(qb, 'deepAcc') + at(qb, 'throwPower')) / 2) + (has(qb, 'cannon', 'deep-ball-artist', 'bomb-squad') ? 0.25 : 0);
  const line = team.OL.reduce((a, o) => a + (at(o, 'rbPower') + at(o, 'rbFinesse')) / 2, 0) / 5;
  const rb = team.RB;
  return {
    deep: Math.min(1, deepWr) * Math.min(1, arm),
    quick: k((at(qb, 'shortAcc') + at(qb, 'release')) / 2),
    run: Math.min(1, 0.6 * k((at(rb, 'vision') + at(rb, 'breakTackle') + at(rb, 'elusiveness')) / 3) + 0.4 * k(line)),
    te: Math.min(1, k((at(team.TE, 'shortRoute') + at(team.TE, 'catching')) / 2) + (has(team.TE, 'seam-stretcher', 'move-te', 'matchup-nightmare') ? 0.2 : 0)),
    fb: Math.min(1, k(at(team.RB2, 'passBlock')) + (has(team.RB2, 'lead-blocker') ? 0.4 : 0)),
    mobile: k(at(qb, 'speed')),
  };
}

/** How long a play takes to develop: the drop's set time (runs: the mesh). */
const develop = (p: OffPlay): number => (p.run ? p.run.mesh : p.drop.set);

/** Plays that go deep (a shot, or play action with a post or go as the first read). */
function deepShot(p: OffPlay): boolean {
  if (p.type === 'shot') return true;
  if (p.type !== 'playAction') return false;
  return Object.values(p.assign).some((a) => a.kind === 'route' && a.read === 1 && (a.route === 'post' || a.route === 'go'));
}

/** Throws that go to the sideline and stop the clock (the two-minute drill). */
const SIDELINE = new Set(['doubles-quick-outs', 'doubles-curls', 'bunch-flood', 'doubles-smash', 'empty-quick', 'pistol-pa-boot']);

/**
 * Ranked play ids for the situation. Each play scores by what the down and
 * distance want (the conversion rates behind the NFL's play-calling shape:
 * runs and play action on early downs, quick game to move the chains on
 * third and medium, concepts that reach the sticks on third and long),
 * where the ball is (compressed routes in the red zone, the heavy set at the
 * goal line, nothing slow backed up), the clock, and the roster's strengths.
 */
/** The Suggested tab's length (Playtest 2: ten, ranked). */
export const SUGGESTED = 10;

export function suggestPlays(sit: OffSituation, team: ContendersRoster, n = SUGGESTED, beasts?: BeastsDefense): string[] {
  const st = strengths(team);
  // Efficiency King: the coordinator reads how each play matches up against what these Beasts call here (film.ts).
  const ek = beasts && holds(team.QB, 'efficiency-king') ? filmReader(sit) : null;
  const toGoal = 100 - sit.los;
  const late = (sit.secondsLeft ?? 999) <= 120 && (sit.scoreDiff ?? 0) <= 0;
  const redZone = toGoal <= 20;
  const goalLine = toGoal <= 3;
  const backedUp = sit.los <= 5;
  const short = sit.toGo <= 2;
  const long = sit.toGo >= 7;
  const third = sit.down >= 3;
  const score = (p: OffPlay): number => {
    const t: PlayType = p.type;
    let s = 0;
    // Situational calls only in their moment.
    if (p.situ === 'endOfHalf') return (sit.secondsLeft ?? 999) <= 8 && toGoal > 30 ? 100 : -100;
    if (p.situ === 'short') return sit.toGo <= 1 && (third || goalLine) ? 8 : -100;
    // Down and distance.
    if (sit.down === 1) s += t === 'run' ? 2 : t === 'playAction' ? 2 : t === 'quick' ? 1 : t === 'shot' ? 0.5 : 1;
    else if (short) s += t === 'run' ? 3 : t === 'quick' ? 2 : t === 'playAction' ? 1.5 : 0;
    else if (third && long) s += t === 'dropback' ? 3 : t === 'shot' ? 2 : t === 'screen' ? 1 : t === 'quick' ? 0.5 : t === 'run' ? (p.run && DRAWS.includes(p.run.scheme) ? 1 : -2) : 0;
    else if (third) s += t === 'quick' ? 3 : t === 'dropback' ? 2.5 : t === 'screen' ? 1 : t === 'run' ? 0.5 : 0.5;
    else if (long) s += t === 'dropback' ? 2 : t === 'screen' ? 2 : t === 'quick' ? 1.5 : t === 'run' ? (p.run && DRAWS.includes(p.run.scheme) ? 1.5 : 0.5) : 1;
    else s += t === 'run' ? 2 : t === 'playAction' ? 1.5 : 1.5;
    // Field position.
    if (goalLine) s += p.formation.personnel === '22' ? 3 : t === 'run' ? 1 : t === 'shot' ? -3 : 0;
    else if (redZone) s += deepShot(p) ? -2 : t === 'quick' ? 1.5 : 0;
    if (backedUp) s += develop(p) > 1.3 || deepShot(p) ? -3 : t === 'run' ? 1 : 0;
    // The clock: a two-minute offense throws, and to the sideline.
    if (late) s += t === 'run' ? -4 : SIDELINE.has(p.id) ? 2 : t === 'dropback' || t === 'quick' ? 1 : 0;
    // Personnel strengths.
    if (deepShot(p)) s += 3 * st.deep - 1;
    if (t === 'quick') s += 1.5 * st.quick;
    // A Designed Runner's own runs (the QB draw, the zone read) go on his legs, not the back's.
    if (t === 'run') s += 2 * (p.unlock === 'designed-runner' ? st.mobile : st.run) - 0.5;
    if (Object.entries(p.assign).some(([k, a]) => k === 'TE' && a.kind === 'route' && a.read === 1)) s += 1.5 * st.te;
    if (p.formation.personnel === '21' || p.formation.personnel === '22') s += 1.2 * st.fb - 0.4;
    if (p.drop.boot) s += 1.2 * st.mobile;
    // The traits that change who gets the ball (usage.ts personalize): a
    // Volume TE is the first read wherever he runs a route, so the plays
    // with him out on one are the ones to call (the trait catalog: "first
    // read on the coordinator AI's suggested plays").
    if (t !== 'run' && volumeTeOut(p, team)) s += VOLUME_TE;
    if (ek) s += EK_WEIGHT * ek(p);
    return s;
  };
  // Only this roster's book: a play a trait unlocks needs the man who holds it (personnel.ts playUnlocked).
  const ranked = PLAYS.map((p, i) => ({ p, s: score(p), i })).filter((r) => r.s > -50 && playUnlocked(r.p, team));
  // A mixed list (Playtest 2: "mixed runs and passes, ranked"): at least
  // MIX_SHARE of it runs and as much passes, except in the two-minute drill
  // (no runs) and on third and long (one: the draw). Where the quota needs
  // the last slots, only that kind is eligible; the order is still the score.
  const isRun = (p: OffPlay) => p.type === 'run';
  const minRun = late ? 0 : third && long ? 1 : Math.round(n * MIX_SHARE);
  const minPass = Math.round(n * MIX_SHARE);
  const runsAvail = ranked.filter((r) => isRun(r.p)).length;
  // Greedy with variety: each pick costs the next play of the same type a point.
  const out: string[] = [];
  const used: Record<string, number> = {};
  let runs = 0;
  const named = new Set<string>();
  while (out.length < n && ranked.length) {
    const left = n - out.length;
    const needRun = Math.min(runsAvail - runs, Math.max(0, minRun - runs));
    const needPass = Math.max(0, minPass - (out.length - runs));
    const only: boolean | null = needRun >= left ? true : needPass >= left ? false : null;
    let best = -1;
    let bs = -Infinity;
    ranked.forEach((r, j) => {
      if (only !== null && isRun(r.p) !== only) return;
      // The same concept from another formation reads as a repeat on the list: it costs more than another play of the type.
      const v = r.s - (used[r.p.type] ?? 0) - (named.has(r.p.name) ? 1.5 : 0) - r.i * 1e-4;
      if (v > bs) {
        bs = v;
        best = j;
      }
    });
    if (best < 0) break;
    const [r] = ranked.splice(best, 1);
    out.push(r!.p.id);
    if (isRun(r!.p)) runs++;
    named.add(r!.p.name);
    used[r!.p.type] = (used[r!.p.type] ?? 0) + 1;
  }
  return out;
}
/** The least share of a suggested list that runs (and that passes): 3 of 10, a coordinator's call sheet for a down rarely leans further. */
const MIX_SHARE = 0.3;

/** A Volume TE out on a route on this play: what that's worth to the call (a point and a half: about a down-and-distance preference, so he's in most of the passes on the list). */
const VOLUME_TE = 1.5;

function volumeTeOut(p: OffPlay, team: ContendersRoster): boolean {
  const off = offenseFor(p, team);
  return (['TE', 'SLOT', 'Z', 'X'] as OffSlot[]).some((k) => p.assign[k].kind === 'route' && off[k].pos === 'TE' && holds(off[k], 'volume-te'));
}

/**
 * Efficiency King (the trait catalog: "the coordinator AI's suggested play
 * for him is right 10% more often (it reads his best matchups)"). Reading
 * matchups man by man (a receiver's routes, hands and speed against the
 * coverage ratings of the man the Beasts' looks put on him) didn't predict
 * what works in this sim: across the book it ran against success
 * (correlation −0.29, tools/sim/coordfx.ts), because what decides a snap
 * here is how a concept matches up with the coverage called. So his
 * coordinator reads that: the film (film.ts, every play against every
 * Beasts call) gives the odds each play makes the yards this down and
 * distance needs (the standard success rate: 40% of the distance on 1st
 * down, 60% on 2nd, all of it on 3rd and 4th) against the calls these
 * Beasts make here (defense.ts callOdds), and the plays with the better odds
 * than the rest of the book rank higher.
 */
export function filmReader(sit: OffSituation): (p: OffPlay) => number {
  const odds = callOdds(sit);
  const need = sit.toGo * (sit.down <= 1 ? 0.4 : sit.down === 2 ? 0.6 : 1);
  const rate = (id: string): number | null => {
    const f = FILM[id];
    if (!f) return null;
    let p = 0;
    let w = 0;
    for (const [call, q] of Object.entries(odds)) {
      const ys = f[call];
      if (!ys || q <= 0) continue;
      p += q * (ys.filter((y) => y >= need).length / ys.length);
      w += q;
    }
    return w > 0 ? p / w : null;
  };
  const rates = PLAYS.map((p) => rate(p.id)).filter((x): x is number => x !== null);
  const mean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  return (p) => {
    const r = rate(p.id);
    return r === null ? 0 : r - mean;
  };
}
/** Points per unit of success odds over the book (ten points of success rate is a point: about a down-and-distance preference). Tuned with tools/sim/coordfx.ts. */
const EK_WEIGHT = 10;
