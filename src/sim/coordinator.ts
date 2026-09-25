// The offensive coordinator behind the play call's "Suggested" tab (GDD
// §10.1): ranked play ids for the situation (down, distance, field
// position, the clock and the score) and the roster's strengths. Pure and
// deterministic: the same situation and roster give the same list.

import type { ContendersRoster } from './personnel';
import { PLAYS, type OffPlay, type PlayType } from './plays';
import type { SimPlayer } from './types';

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
export function suggestPlays(sit: OffSituation, team: ContendersRoster, n = 5): string[] {
  const st = strengths(team);
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
    else if (third && long) s += t === 'dropback' ? 3 : t === 'shot' ? 2 : t === 'screen' ? 1 : t === 'quick' ? 0.5 : t === 'run' ? (p.run?.scheme === 'draw' ? 1 : -2) : 0;
    else if (third) s += t === 'quick' ? 3 : t === 'dropback' ? 2.5 : t === 'screen' ? 1 : t === 'run' ? 0.5 : 0.5;
    else if (long) s += t === 'dropback' ? 2 : t === 'screen' ? 2 : t === 'quick' ? 1.5 : t === 'run' ? (p.run?.scheme === 'draw' ? 1.5 : 0.5) : 1;
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
    if (t === 'run') s += 2 * st.run - 0.5;
    if (Object.entries(p.assign).some(([k, a]) => k === 'TE' && a.kind === 'route' && a.read === 1)) s += 1.5 * st.te;
    if (p.formation.personnel === '21' || p.formation.personnel === '22') s += 1.2 * st.fb - 0.4;
    if (p.drop.boot) s += 1.2 * st.mobile;
    return s;
  };
  const ranked = PLAYS.map((p, i) => ({ p, s: score(p), i })).filter((r) => r.s > -50);
  // Greedy with variety: each pick costs the next play of the same type a point.
  const out: string[] = [];
  const used: Record<string, number> = {};
  while (out.length < n && ranked.length) {
    let best = 0;
    let bs = -Infinity;
    ranked.forEach((r, j) => {
      const v = r.s - (used[r.p.type] ?? 0) - r.i * 1e-4;
      if (v > bs) {
        bs = v;
        best = j;
      }
    });
    const [r] = ranked.splice(best, 1);
    out.push(r!.p.id);
    used[r!.p.type] = (used[r!.p.type] ?? 0) + 1;
  }
  return out;
}
