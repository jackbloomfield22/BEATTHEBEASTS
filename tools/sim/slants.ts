// The slant exploit (Playtest 2: "backing up and throwing is always open"):
// the player calls a slant, throws it on time or backs the QB away from the
// rush first and throws it late, against every coverage on the call sheet.
// Reports, per call, completion %, interceptions and breakups, yards per
// attempt, yards after the catch, separation at the catch and as the ball
// leaves (what the player sees when he lets it go).
//   node tools/run-ts.mjs tools/sim/slants.ts [repsPerPlay=67] [--hot] [--pick] [--how]
//     [--lbs=WLB,MLB,SLB] [--at=ticks --ontime] [--json=out.json]
// --hot: slants hot-routed onto three other plays (instead of the Slants
// concept); --pick: the player throws to whichever slant looks most open;
// --how: what decided each throw; --lbs: other linebackers in the Beasts
// (the ratings check). docs/m66/SLANTS.md has the figures;
// tests/slants.test.ts holds the squeeze at a small sample.
import { readFileSync, writeFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, findStint, input, playById, practiceRosters, simPlayer, stepPlay, type DefCall, type InputFrame, type OffPlay, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import type { RouteName } from '../../src/sim/plays.ts';
import { dist } from '../../src/sim/vec.ts';

/** The ball on the left hash, the middle and the right hash in turn (outcomes.ts HASHES). */
const HASHES = [3.08, 0, -3.08];

/** How the player plays it. */
export interface SlantScript {
  id: string;
  /** Ticks after the snap the throw key goes down (a 4-tick tap: the driven ball). */
  at: number;
  /** Ticks after the snap he starts holding the arrow back (the QB retreats), until the throw; omit for a normal drop. */
  backFrom?: number;
}

/** On time: the three-step drop, the key down as he sets (0.8 s) and the ball out on the break (~1.2 s after the snap, with the windup). */
export const ON_TIME: SlantScript = { id: 'on-time', at: 48 };
/** The exploit: back away from the rush for 1.5–2.5 s, then throw it. */
export const LATE: SlantScript[] = [
  { id: 'late-1.5', at: 24 + 90, backFrom: 24 },
  { id: 'late-2.0', at: 24 + 120, backFrom: 24 },
  { id: 'late-2.5', at: 24 + 150, backFrom: 24 },
];

/** A slant to throw: the play, the receiver's icon, and a hot route to call at the line (if it isn't his route already). */
export interface SlantCall {
  play: string;
  icons: number[];
  hot?: RouteName;
  /** The player's eyes: at the throw he picks whichever of `icons` is most open (the nearest defender farthest from him), as a player does. */
  pick?: boolean;
}

/** The called slants: the Slants concept, every slant in it in turn. */
export const CALLED: SlantCall = { play: 'doubles-slants', icons: [1, 2, 3] };
/** The same, the player throwing to whichever slant looks most open. */
export const PICKED: SlantCall = { play: 'doubles-slants', icons: [1, 2, 3], pick: true };
/** Hot-routed slants on other plays (the receiver's icon on that play). */
export const HOT: SlantCall[] = [
  { play: 'doubles-quick-outs', icons: [1, 2], hot: 'slant' },
  { play: 'trips-four-verts', icons: [4, 3], hot: 'slant' },
  { play: 'doubles-curls', icons: [1, 2], hot: 'slant' },
];

export interface SlantSample {
  def: string;
  play: string;
  icon: number;
  thrown: boolean;
  sack: boolean;
  complete: boolean;
  int: boolean;
  /** Broken up: a defender got a hand to it (a deflection) and it wasn't caught. */
  pbu: boolean;
  yards: number;
  yac: number;
  /** Nearest defender to the ball when it reached him (yd; 99 when it never did). */
  sep: number;
  /** Snap to release (s). */
  ttt: number;
  /** What the player saw: the nearest defender to his man (yd) when the ball left the QB's hand. */
  sepRelease: number;
  /** What decided it: caught, picked, broken up at the receiver's hands, a defender's hand first, dropped, or thrown where nobody got it. */
  how: 'catch' | 'int' | 'pbu' | 'tip' | 'drop' | 'miss' | 'none';
  /** The ball: driven or touch (air put under it), and its hang time (s). */
  kind: string;
  hang: number;
}

const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));

function nearest(s: PlayState): number {
  const c = s.agents[s.carrier]!;
  let d = Infinity;
  for (const i of s.def) if (!s.agents[i]!.down) d = Math.min(d, dist(s.agents[i]!.pos, c.pos));
  return d;
}

/** Of these icons, the receiver with the most room (his nearest defender farthest away). */
function mostOpen(s: PlayState, icons: number[]): number {
  let best = icons[0]!;
  let bs = -1;
  for (const k of icons) {
    const r = s.agents[s.icons[k - 1]!]!;
    let near = Infinity;
    for (const i of s.def) if (!s.agents[i]!.down) near = Math.min(near, dist(s.agents[i]!.pos, r.pos));
    if (near > bs) {
      bs = near;
      best = k;
    }
  }
  return best;
}

/** The player's input: hot route and snap, the drop (or the retreat), the tap, then upfield after the catch. */
export function slantInput(sc: SlantScript, icon: number, hot?: RouteName, pick?: number[]) {
  let chosen = icon;
  return (s: PlayState): InputFrame => {
    if (s.phase === 'presnap') return input({ snap: true, hotRoute: hot ? { icon, route: hot } : null });
    const t = since(s);
    if (s.phase === 'air') return input({});
    if (s.phase === 'carrier') return input({ move: { x: 1, y: 0 }, sprint: nearest(s) >= 2.6 });
    const back = sc.backFrom !== undefined && t >= sc.backFrom && t < sc.at;
    if (pick && t === sc.at) chosen = mostOpen(s, pick);
    return input({ move: back ? { x: -1, y: 0 } : { x: 0, y: 0 }, throwHeld: t >= sc.at && t < sc.at + 4 ? chosen : 0 });
  };
}

/** One snap: the k-th rep of a slant against a call. */
export function slantRep(rosters: ReturnType<typeof practiceRosters>, call: SlantCall, def: DefCall, sc: SlantScript, k: number): SlantSample {
  const play: OffPlay = playById(call.play);
  const icon = call.icons[k % call.icons.length]!;
  const sd = sidesFor(rosters, play, def);
  const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: Math.floor(k / 3) % 2 === 1, toGo: 10, user: true });
  const script = slantInput(sc, icon, call.hot, call.pick ? call.icons : undefined);
  let releaseT = -1;
  let deflected = false;
  let kind = '';
  let hang = NaN;
  let sepRelease = NaN;
  for (let t = 0; t < 60 * 30 && !s.result; t++) {
    stepPlay(s, script(s));
    if (releaseT < 0 && s.ball.mode === 'air') {
      releaseT = s.t - s.snapT;
      kind = s.ball.kind ?? '';
      hang = s.ball.arrive - s.ball.releaseT;
      const r = s.agents[s.ball.target]!;
      sepRelease = Math.min(...s.def.map((i) => (s.agents[i]!.down ? 99 : dist(s.agents[i]!.pos, r.pos))));
    }
  }
  for (const e of s.events) if (e.type === 'deflection') deflected = true;
  const r = s.result!;
  const thrown = !!r.pass?.attempted;
  const complete = thrown && r.pass!.complete && !r.pass!.intercepted;
  const catchX = s.events.find((e) => e.type === 'catch')?.at?.x;
  const air = complete && catchX !== undefined ? catchX - s.setup.los : 0;
  const first = s.events.find((e) => e.type === 'catch' || e.type === 'deflection' || e.type === 'drop' || e.type === 'interception');
  const reached = r.pass?.sep !== undefined;
  const how: SlantSample['how'] = !thrown ? 'none' : complete ? 'catch' : r.pass!.intercepted ? 'int' : !first ? 'miss' : first.type === 'drop' ? 'drop' : reached ? 'pbu' : 'tip';
  return {
    kind,
    hang,
    how,
    def: def.id,
    play: call.play,
    icon,
    thrown,
    sack: r.sack,
    complete,
    int: thrown && r.pass!.intercepted,
    pbu: thrown && !complete && !r.pass!.intercepted && deflected,
    yards: thrown && !r.pass!.intercepted ? r.yards : 0,
    yac: complete ? r.yards - air : 0,
    sep: r.pass?.sep ?? 99,
    ttt: releaseT,
    sepRelease,
  };
}

export interface SlantCell {
  n: number;
  thrown: number;
  sacks: number;
  cmp: number;
  intPbu: number;
  int: number;
  ypa: number;
  yac: number;
  sep: number;
  ttt: number;
  /** Nearest defender to the target as the ball leaves (yd), and the share with 3+ yd (what reads as open). */
  sepRel: number;
  openRel: number;
}

export function summarize(xs: SlantSample[]): SlantCell {
  const th = xs.filter((x) => x.thrown);
  const c = th.filter((x) => x.complete);
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  return {
    n: xs.length,
    thrown: th.length,
    sacks: xs.filter((x) => x.sack).length / xs.length,
    cmp: c.length / Math.max(1, th.length),
    intPbu: th.filter((x) => x.int || x.pbu).length / Math.max(1, th.length),
    int: th.filter((x) => x.int).length / Math.max(1, th.length),
    ypa: avg(th.map((x) => x.yards)),
    yac: avg(c.map((x) => x.yac)),
    sep: avg(th.filter((x) => x.sep < 50).map((x) => Math.min(x.sep, 10))),
    ttt: avg(th.map((x) => x.ttt)),
    sepRel: avg(th.map((x) => Math.min(x.sepRelease, 10))),
    openRel: th.filter((x) => x.sepRelease >= 3).length / Math.max(1, th.length),
  };
}

export function runCell(rosters: ReturnType<typeof practiceRosters>, calls: SlantCall[], def: DefCall, sc: SlantScript, n: number): SlantSample[] {
  const out: SlantSample[] = [];
  for (const call of calls) for (let k = 0; k < n; k++) out.push(slantRep(rosters, call, def, sc, k));
  return out;
}

export const fmt = (c: SlantCell): string =>
  `cmp ${(100 * c.cmp).toFixed(0).padStart(3)}% int+pbu ${(100 * c.intPbu).toFixed(0).padStart(3)}% (int ${(100 * c.int).toFixed(0).padStart(2)}%) ypa ${c.ypa.toFixed(1).padStart(5)} yac ${c.yac.toFixed(1).padStart(5)} sep ${c.sep.toFixed(2)} at release ${c.sepRel.toFixed(2)} (3+ yd ${(100 * c.openRel).toFixed(0)}%) ttt ${c.ttt.toFixed(2)} sack ${(100 * c.sacks).toFixed(0).padStart(2)}%`;

/**
 * The Beasts with other linebackers (WLB, MLB, SLB in that order, each his
 * best stint at LB): the ratings check, a coverage linebacker against one
 * who isn't, the same plays and seeds.
 */
export function withLinebackers(rosters: ReturnType<typeof practiceRosters>, snap: SnapshotLike, names: [string, string, string]): ReturnType<typeof practiceRosters> {
  const base = { ...rosters.beasts.base };
  const defense = { ...rosters.defense };
  (['WLB', 'MLB', 'SLB'] as const).forEach((slot, j) => {
    const e = findStint(snap, names[j]!, 'LB');
    if (!e) throw new Error(`slants: ${names[j]} (LB) not in the snapshot`);
    base[slot] = simPlayer(e, base[slot].num);
    defense[slot] = base[slot];
  });
  return { ...rosters, defense, beasts: { ...rosters.beasts, base } };
}

const MAN = new Set(['cover1', 'cover2man', 'cover1blitz', 'cover1off']);
export const isMan = (d: DefCall): boolean => MAN.has(d.id);

if (process.argv[1]?.includes('slants')) {
  const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
  const lbs = process.argv.find((a) => a.startsWith('--lbs='))?.slice(6).split(',') as [string, string, string] | undefined;
  const rosters = lbs ? withLinebackers(practiceRosters(snap), snap, lbs) : practiceRosters(snap);
  const N = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 67);
  const calls = process.argv.includes('--hot') ? HOT : process.argv.includes('--pick') ? [PICKED] : [CALLED];
  const json = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
  const onAt = process.argv.find((a) => a.startsWith('--at='));
  const scripts = [onAt ? { id: 'on-time', at: Number(onAt.slice(5)) } : ON_TIME, ...(process.argv.includes('--ontime') ? [] : LATE)];
  const all: Record<string, Record<string, SlantCell>> = {};
  const pooled: Record<string, { zone: SlantSample[]; man: SlantSample[] }> = {};
  for (const sc of scripts) pooled[sc.id] = { zone: [], man: [] };
  for (const def of DEF_CALLS) {
    all[def.id] = {};
    for (const sc of scripts) {
      const xs = runCell(rosters, calls, def, sc, N);
      all[def.id]![sc.id] = summarize(xs);
      pooled[sc.id]![isMan(def) ? 'man' : 'zone'].push(...xs);
      console.log(`${def.id.padEnd(12)} ${sc.id.padEnd(9)} n ${String(xs.length).padStart(4)} ${fmt(all[def.id]![sc.id]!)}`);
    }
  }
  console.log('');
  if (process.argv.includes('--how'))
    for (const sc of scripts)
      for (const k of ['zone', 'man'] as const) {
        const xs = pooled[sc.id]![k].filter((x) => x.thrown);
        const c: Record<string, number> = {};
        for (const x of xs) c[x.how] = (c[x.how] ?? 0) + 1;
        const touch = xs.filter((x) => x.kind === 'touch');
        const tc = touch.filter((x) => x.complete).length / Math.max(1, touch.length);
        const dc = xs.filter((x) => x.kind !== 'touch' && x.complete).length / Math.max(1, xs.length - touch.length);
        console.log(`HOW ${k.padEnd(5)} ${sc.id.padEnd(9)} ${Object.entries(c).map(([h, n]) => `${h} ${((100 * n) / xs.length).toFixed(0)}%`).join('  ')} | touch ${((100 * touch.length) / xs.length).toFixed(0)}% cmp ${(100 * tc).toFixed(0)}% driven cmp ${(100 * dc).toFixed(0)}% hang ${(xs.reduce((a, x) => a + x.hang, 0) / xs.length).toFixed(2)}`);
      }
  for (const sc of scripts) for (const k of ['zone', 'man'] as const) console.log(`ALL ${k.padEnd(5)} ${sc.id.padEnd(9)} n ${String(pooled[sc.id]![k].length).padStart(4)} ${fmt(summarize(pooled[sc.id]![k]))}`);
  if (json) writeFileSync(json, JSON.stringify(all, null, 1));
}
