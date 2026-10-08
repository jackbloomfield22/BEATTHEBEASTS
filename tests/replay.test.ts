import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, DEF_CALLS, defenseFor, input, offenseFor, playById, PLAYS, practiceRosters, TICK, type InputFrame, type PlayState, type SnapshotLike } from '@/sim';
import { hashPlay } from '@/sim/hash';
import { SimRunner } from '@/game/runner';
import { capsuleOf, captureSource, directorSpeed, FAST, KEY_LEAD, KEY_TAIL, keyMoment, PLAIN_LEAD, PLAIN_TAIL, quickWindow, ReplayPlayer, sourceOf, LEAD_TICKS } from '@/game/replay';
import type { ReplayCapsule } from '@/game/record';

// M7 instant replay: a play rebuilt from its capsule (the setup, the eleven
// on each side and the recorded inputs) reproduces the original exactly:
// the same final state hash, whichever way the replay was scrubbed to get
// there. The key moments that flag a replay come from the play's events.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const R = practiceRosters(snap);

/** A user who snaps, drifts, throws to icon `icon` at `at` ticks, then runs upfield juking. */
function script(icon: number, at: number) {
  return (s: PlayState): InputFrame => {
    const t = s.tick;
    if (s.phase === 'carrier') return input({ move: { x: 1, y: t % 90 < 45 ? 0.25 : -0.25 }, jukeL: t % 50 === 0 });
    return input({ snap: t === 20, move: t > 50 && t < 80 ? { x: -0.4, y: 0.2 } : { x: 0, y: 0 }, throwHeld: t >= at && t < at + 5 ? icon : 0, aim: { x: 0.2, y: 0 } });
  };
}

/** Play it as the session does: through a SimRunner, to the whistle and 2 s of the dead ball. */
function playOut(playId: string, defIdx: number, seed: number, opts: { icon?: number; at?: number; game?: boolean; los?: number } = {}) {
  const play = playById(playId);
  const def = DEF_CALLS[defIdx % DEF_CALLS.length]!;
  const state = createPlay({
    seed,
    offense: offenseFor(play, R.team),
    defense: defenseFor(def, R.beasts),
    play,
    def,
    los: opts.los ?? 32,
    ballY: -3,
    toGo: 10,
    user: true,
    down: 2,
    // A game's extras: difficulty, the touch-pass hold, fatigue, fresh legs, chemistry.
    ...(opts.game ? { difficulty: 'legend' as const, tapMax: 0.2, fatigue: { RB: 0.2, X: 0.1 }, legs: { RB: 1.03 }, chem: { X: 0.37, TE: 0.07 } } : {}),
  });
  const run = new SimRunner(state);
  const sc = script(opts.icon ?? 1, opts.at ?? 95);
  let after = -1;
  for (let k = 0; k < 60 * 30 && (after < 0 || k < after); k++) {
    run.step(sc(state));
    if (state.result && after < 0) after = k + 120;
  }
  return run;
}

/** Step a replay to its end through the scrub path (as the scene's catch-up does). */
function toEnd(p: ReplayPlayer) {
  p.seek(p.end);
  while (p.seeking) p.stepTicks(7);
  return p;
}

describe('instant replay: determinism', () => {
  it('a play rebuilt from its live source ends on the original state hash', () => {
    const run = playOut('trips-stick', 1, 77);
    const src = captureSource(run.state, run.frames);
    expect(src.hash).toBe(run.hash());
    const p = new ReplayPlayer(src);
    expect(p.verified).toBe(true);
    expect(p.hash).toBe(run.hash());
    toEnd(p);
    expect(hashPlay(p.runner.state)).toBe(run.hash());
    expect(p.runner.state.tick).toBe(run.state.tick);
  });

  it('a capsule (stored as JSON, as History keeps it) replays exactly, with every game extra', () => {
    for (const [id, d, seed, icon] of [
      ['trips-four-verts', 2, 9, 1],
      ['trips-stick', 0, 4242, 2],
      [PLAYS.find((p) => p.run)!.id, 3, 31, 1],
    ] as const) {
      const run = playOut(id, d, seed, { icon, game: true });
      const cap = JSON.parse(JSON.stringify(capsuleOf(run.state, run.frames))) as ReplayCapsule;
      expect(cap.hash).toBe(run.hash());
      const src = sourceOf(cap)!;
      expect(src).not.toBeNull();
      const p = new ReplayPlayer(src);
      expect(p.verified, id).toBe(true);
      expect(hashPlay(toEnd(p).runner.state), id).toBe(run.hash());
    }
  });

  it('scrubbing back and forth, playing in slow motion and stepping frames ends on the same state', () => {
    const run = playOut('trips-four-verts', 4, 123, { icon: 2, at: 110 });
    const p = new ReplayPlayer(captureSource(run.state, run.frames));
    // Play a while at half speed, frame by frame from the renderer's dt.
    p.cycleSpeed();
    for (let f = 0; f < 120; f++) p.frame(1 / 60);
    const mid = p.tick;
    expect(mid).toBeGreaterThan(p.start);
    p.scrub(-60);
    expect(p.tick).toBe(p.start); // rebuilt at the window's start, then stepped back up to the target
    while (p.seeking) p.stepTicks(3);
    expect(p.tick).toBe(Math.max(p.start, mid - 60));
    p.stepFrame(1);
    while (p.seeking) p.stepTicks(1);
    p.stepFrame(-1);
    while (p.seeking) p.stepTicks(5);
    p.toKey();
    while (p.seeking) p.stepTicks(4);
    p.toStart();
    expect(hashPlay(toEnd(p).runner.state)).toBe(run.hash());
  });

  it('refuses a replay that does not reach the recorded hash (a record from another build)', () => {
    const run = playOut('trips-stick', 2, 5);
    const cap = capsuleOf(run.state, run.frames);
    const p = new ReplayPlayer({ ...sourceOf(cap)!, hash: (cap.hash! + 1) | 0 });
    expect(p.verified).toBe(false);
    // A capsule from before M7 (no players) can't be replayed at all.
    expect(sourceOf({ ...cap, players: undefined })).toBeNull();
  });

  it('opens a beat before the snap and never steps past the last recorded input', () => {
    const run = playOut('trips-stick', 1, 12);
    const p = new ReplayPlayer(captureSource(run.state, run.frames));
    expect(p.snapTick).toBe(21);
    expect(p.start).toBe(Math.max(0, p.snapTick - LEAD_TICKS));
    for (let f = 0; f < 60 * 40; f++) p.frame(1 / 30);
    expect(p.tick).toBe(p.end);
    expect(p.playing).toBe(false);
    expect(hashPlay(p.runner.state)).toBe(run.hash());
  });

  it('rebuilds quickly: the whole play re-simulates in well under a frame budget per seek', () => {
    const run = playOut('trips-four-verts', 1, 3);
    const p = new ReplayPlayer(captureSource(run.state, run.frames));
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) toEnd(p).toStart();
    const per = (performance.now() - t0) / 10;
    // Logged for docs/m7/REPLAY.md; the bound is loose (CI machines vary).
    console.log(`replay: ${p.end} ticks re-simulated in ${per.toFixed(1)} ms`);
    expect(per).toBeLessThan(250);
  });
});

describe('instant replay: key moments', () => {
  /**
   * A play that ends in each flag: first the cases known to (play/seed/spot,
   * found with this script), then across the book if the sim has moved on.
   */
  const KNOWN: Record<string, string[]> = {
    touchdown: ['trips-stick/2/85', 'trips-stick/17/85', 'trips-stick/20/85'],
    turnover: ['trips-stick/8/32', 'trips-stick/28/32', 'ace-te-seam/19/32', 'heavy-dive/10/32'],
    bigHit: ['doubles-slants/3/85', 'doubles-smash/19/32', 'doubles-smash/23/32'],
  };
  const probe = (id: string, seed: number, los: number) => playOut(id, seed, seed * 13, { icon: 1 + (seed % 3), at: 80 + (seed % 5) * 10, los });
  function find(kind: string) {
    const known = KNOWN[kind]!.map((c) => c.split('/')).map(([id, seed, los]) => [id!, Number(seed), Number(los)] as const);
    const wide = PLAYS.flatMap((p) => Array.from({ length: 39 }, (_, k) => [[p.id, k + 1, 85] as const, [p.id, k + 1, 32] as const]).flat());
    for (const [id, seed, los] of [...known, ...wide]) {
      const run = probe(id, seed, los);
      const k = keyMoment(run.state);
      if (k?.kind === kind) return { run, k };
    }
    return null;
  }

  it('flags a big hit at the hardest hit, on the man who took it', () => {
    const f = find('bigHit');
    expect(f).not.toBeNull();
    const { run, k } = f!;
    const hit = run.state.events.find((e) => Math.round(e.t / TICK) === k.tick && (e.type === 'hit' || e.type === 'tackle') && e.data?.big);
    expect(hit).toBeDefined();
    expect(k.who).toBe(hit!.who![1]);
    const p = new ReplayPlayer(captureSource(run.state, run.frames));
    expect(p.key).toEqual(k);
  });

  it('flags a touchdown or a turnover when the play ends in one', () => {
    for (const kind of ['touchdown', 'turnover'] as const) {
      const f = find(kind);
      expect(f, kind).not.toBeNull();
      if (!f) continue;
      const r = f.run.state.result!;
      if (kind === 'touchdown') expect(r.touchdown && r.offenseBall).toBe(true);
      else expect(r.offenseBall).toBe(false);
      expect(f.k.tick).toBeGreaterThan(0);
      expect(f.k.tick).toBeLessThanOrEqual(f.run.state.tick);
    }
  });

  it('the quick replay: a flagged play around its moment in ~4 s (under 1.5 s held at FAST), any other the snap to the whistle; it ends on its own', () => {
    const f = find('touchdown')!;
    const p = new ReplayPlayer(captureSource(f.run.state, f.run.frames));
    const w = quickWindow(p);
    expect(w.from).toBe(p.key!.tick - KEY_LEAD);
    expect(w.to).toBe(Math.min(p.end, p.key!.tick + KEY_TAIL));
    // Played as the session plays it: seek to the window, the director's touch of slow motion, frame by frame to its end.
    const secs = (boost: number) => {
      const q = new ReplayPlayer(captureSource(f.run.state, f.run.frames));
      q.seek(w.from);
      while (q.seeking) q.stepTicks(12);
      q.director = true;
      q.boost = boost;
      let t = 0;
      while (q.tick < w.to && !q.atEnd) {
        q.frame(1 / 60);
        t += 1 / 60;
      }
      return t;
    };
    const normal = secs(1);
    expect(normal).toBeGreaterThan(3);
    expect(normal).toBeLessThan(5);
    expect(secs(FAST)).toBeLessThan(normal / 2.5);
    // A play with nothing flagged: from just before the snap to just after the whistle.
    const run = playOut('trips-stick', 1, 12);
    const plain = new ReplayPlayer(captureSource(run.state, run.frames));
    if (!plain.key) expect(quickWindow(plain)).toEqual({ from: Math.max(plain.start, plain.snapTick - PLAIN_LEAD), to: Math.min(plain.end, plain.whistleTick + PLAIN_TAIL) });
  });

  it('slows through the key moment and is back to full speed either side', () => {
    expect(directorSpeed(-120)).toBe(1);
    expect(directorSpeed(0)).toBeCloseTo(0.35);
    expect(directorSpeed(20)).toBeCloseTo(0.35);
    expect(directorSpeed(200)).toBe(1);
    // Eased: no jump anywhere along it.
    for (let d = -100; d < 150; d++) expect(Math.abs(directorSpeed(d + 1) - directorSpeed(d))).toBeLessThan(0.08);
  });
});
