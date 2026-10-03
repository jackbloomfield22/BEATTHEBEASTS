import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeRng } from '@/engine/rng';
import { assembleRatedBeasts } from '@/game/beasts';
import { makeCatalog } from '@/game/draft';
import { applyBeastsDrive, beastsPossession, createMatch, type BeastsDrive, type Match } from '@/game/match';
import { MAX_TRIES, montageTeams, PRE_SNAP, stageDrive, TAIL } from '@/game/montage';
import { montageSpeed } from '@/game/montageSession';
import { ReplayPlayer } from '@/game/replay';
import { createPlay, practiceRosters, stepPlay, type SnapshotLike } from '@/sim';
import { hashPlay } from '@/sim/hash';

// M7, Playtest 1 #4: the Beasts' drive montage stages the drive's key play in
// the sim. The drive itself is the resolver's (match.ts) and must come out
// the same with or without the montage; the staged snap must agree with it
// and be the same snap for the same game seed.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike & { units: never[] };
const cat = makeCatalog(snap, {});
const user = practiceRosters(snap).team;
const userIds = [user.QB, user.RB, user.RB2, user.WR1, user.WR2, user.WR3, user.TE, user.TE2, ...user.OL].map((p) => p.id);
const SEED = 4242;
const beasts = assembleRatedBeasts(makeRng(SEED ^ 0x9e3779b9), (id) => cat.entry.get(id)?.ovr);
const onField = [...userIds, ...beasts.beasts.map((b) => b.id), ...beasts.subs.map((b) => b.id)];
const teams = montageTeams(cat, onField, SEED);

const drive = (p: Partial<BeastsDrive>): BeastsDrive => ({ result: 'Punt', points: 0, plays: 6, yards: 30, top: '3:10', nextStart: 20, start: 25, ...p });

describe('the montage elevens', () => {
  it('are drawn from the game seed, and nobody on the field for real plays in them', () => {
    expect(montageTeams(cat, onField, SEED)).toEqual(teams);
    expect(montageTeams(cat, onField, SEED + 1)).not.toEqual(teams);
    const persons = new Set(onField.map((id) => cat.entry.get(id)!.personId));
    const o = teams.offense;
    const d = teams.defense;
    const all = [o.QB, o.RB, o.RB2, o.WR1, o.WR2, o.WR3, o.TE, o.TE2, ...o.OL, ...Object.values(d.base), d.nickel, d.dime];
    for (const p of all) expect(persons.has(cat.entry.get(p.id)!.personId), p.name).toBe(false);
    // No one twice, and every man at his own position.
    expect(new Set(all.map((p) => cat.entry.get(p.id)!.personId)).size).toBe(all.length);
    expect([o.QB.pos, o.RB.pos, o.WR1.pos, o.TE.pos, o.OL[2].pos]).toEqual(['QB', 'RB', 'WR', 'TE', 'OL']);
    expect([d.base.LE.pos, d.base.LDT.pos, d.base.MLB.pos, d.base.LCB.pos, d.base.FS.pos, d.nickel.pos, d.dime.pos]).toEqual(['DE', 'DT', 'LB', 'CB', 'S', 'CB', 'S']);
  });
});

describe('the staged key play', () => {
  it('is the same snap for the same game seed, and another for another possession', () => {
    const d = drive({ result: 'TD', points: 7, plays: 9, yards: 75, nextStart: 25 });
    const a = stageDrive(d, teams, SEED, 2, 0)!;
    const b = stageDrive(d, teams, SEED, 2, 0)!;
    expect(a).not.toBeNull();
    expect(b.src.setup).toEqual(a.src.setup);
    expect(b.src.frames).toEqual(a.src.frames);
    const c = stageDrive(d, teams, SEED, 3, 0)!;
    expect(c.src.setup.seed).not.toBe(a.src.setup.seed);
  });

  it('agrees with the drive: the score, the pick where your drive starts, the stop, the longest gain', () => {
    const check = (d: BeastsDrive, round: number) => {
      const st = stageDrive(d, teams, SEED, round, 0);
      if (!st) return null;
      const s = createPlay(st.src.setup);
      for (const f of st.src.frames) stepPlay(s, f);
      const r = s.result!;
      // The offense is the sim's AI (the Beasts), set at the line before the snap, the whistle and the dead ball after it.
      expect(st.src.setup.user).toBe(false);
      expect(st.snapTick).toBeGreaterThanOrEqual(PRE_SNAP);
      expect(st.src.frames.length).toBe(st.whistleTick + TAIL);
      expect(st.keyTick).toBeGreaterThanOrEqual(st.snapTick);
      expect(st.keyTick).toBeLessThanOrEqual(st.whistleTick);
      return { st, r };
    };
    const td = check(drive({ result: 'TD', points: 7, plays: 10, yards: 80, start: 20, nextStart: 25 }), 1)!;
    expect(td.r.touchdown && td.r.offenseBall).toBe(true);
    expect(td.st.yards).toBeLessThanOrEqual(80);
    expect(td.st.label).toBe('Touchdown');
    const punt = check(drive({ result: 'Punt', plays: 5, yards: 18, start: 25, nextStart: 18 }), 2)!;
    expect(punt.r.offenseBall && !punt.r.touchdown).toBe(true);
    expect(punt.st.down).toBe(3);
    expect(punt.r.yards).toBeLessThanOrEqual(punt.st.toGo - 1);
    const downs = check(drive({ result: 'Downs', plays: 6, yards: 22, start: 25, nextStart: 53 }), 3)!;
    expect(downs.st.down).toBe(4);
    expect(Math.abs(downs.r.spot - 47)).toBeLessThanOrEqual(2);
    const fg = check(drive({ result: 'FG', points: 3, plays: 8, yards: 50, start: 22, nextStart: 25 }), 4)!;
    expect(fg.r.offenseBall && !fg.r.touchdown).toBe(true);
    expect(fg.r.yards).toBeGreaterThanOrEqual(8);
    expect(fg.r.yards).toBeLessThanOrEqual(40);
    // A turnover: found for most drives (tools/sim/montage.ts: ~80%); when it is, the ball comes down near your drive's start.
    let picks = 0;
    for (let round = 1; round <= 4; round++) {
      const t = check(drive({ result: 'Turnover', plays: 5, yards: 20, start: 25, nextStart: 48 }), 10 + round);
      if (!t) continue;
      picks++;
      expect(t.r.offenseBall).toBe(false);
      expect(t.r.touchdown).toBe(false);
      expect(Math.abs(t.r.spot - 52)).toBeLessThanOrEqual(10);
    }
    expect(picks).toBeGreaterThan(0);
    // A kneel-out has nothing to show: the card.
    expect(stageDrive(drive({ result: 'EndOfGame', plays: 2, yards: -2 }), teams, SEED, 5, 0)).toBeNull();
    expect(MAX_TRIES).toBeGreaterThan(0);
  });

  it('replays exactly through the replay player (the scene draws it the same way)', () => {
    const st = stageDrive(drive({ result: 'TD', points: 7, plays: 9, yards: 75, nextStart: 25 }), teams, SEED, 6, 0)!;
    const s = createPlay(st.src.setup);
    for (const f of st.src.frames) stepPlay(s, f);
    const p = new ReplayPlayer({ ...st.src, hash: hashPlay(s) }, PRE_SNAP - 6);
    expect(p.verified).toBe(true);
    expect(p.start).toBe(Math.max(0, p.snapTick - (PRE_SNAP - 6)));
    while (!p.atEnd) p.frame(1 / 30);
    expect(p.runner.hash()).toBe(hashPlay(s));
  });
});

describe('the drives themselves', () => {
  it('come out the same with or without the montage (it never touches the match)', () => {
    const play = (stage: boolean) => {
      const m: Match = createMatch({ drives: 6, quarterSecs: null, seed: SEED, beastsRating: beasts.rating.rating, diffAdj: 0, kickerRange: 56 });
      const out: BeastsDrive[] = [];
      for (let k = 0; k < 6; k++) {
        const d = beastsPossession(m);
        if (stage) stageDrive(d, teams, SEED, m.round, m.ot);
        out.push({ ...d });
        applyBeastsDrive(m, d);
        m.userDrives.push({ start: 25, plays: 5, yards: 10, result: 'Punt', points: 0, against: 0, next: 22 });
        m.round++;
        m.phase = 'meanwhile';
      }
      return { out, score: { ...m.score } };
    };
    expect(play(true)).toEqual(play(false));
  });
});

describe('the slow motion through a score or a pick', () => {
  it('eases down to 0.4× around the moment and back to full speed', () => {
    expect(montageSpeed(-60)).toBe(1);
    expect(montageSpeed(0)).toBeCloseTo(0.4);
    expect(montageSpeed(20)).toBeCloseTo(0.4);
    expect(montageSpeed(-19)).toBeGreaterThan(0.4);
    expect(montageSpeed(-19)).toBeLessThan(1);
    expect(montageSpeed(60)).toBe(1);
  });
});
