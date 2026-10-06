import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, DEF_CALLS, PLAYS, practiceRosters, stepPlay, input, type PlayState, type SnapshotLike } from '@/sim';
import { BANK, canSay, Commentator, fill, FALLBACK, KINDS, slotsOf, VARIETY_WINDOW, type CallKind, type Slots } from '@/game/commentary';
import { broadcastSpot, callForBeasts, callForKick, callForPunt, callForSituation, callForSnap, driveStrip } from '@/game/broadcast';
import type { BeastsDrive, Match, UserDrive } from '@/game/match';

// Commentary (M7, GDD §11.7): the caption bank. Every slot is filled (legacy
// bug L8: "Intercepted by null!"), lines vary (no repeat inside the window),
// and the same seed and events say the same lines.

const BAD = /null|undefined|NaN|\{|\}|\s{2}|^\s|\s$/;
const FULL: Slots = { passer: 'Montana', receiver: 'Rice', runner: 'Craig', defender: 'Woodson', tackler: 'Butkus', rusher: 'White', hitter: 'Lott', yards: 34, loss: 7, toGo: 8, spot: 'BST 32', plays: 11, top: '5:12', clock: '1:48', need: 'a touchdown', timeouts: 2, net: 38, deficit: 7 };
const ROLES = ['passer', 'receiver', 'runner', 'defender', 'tackler', 'rusher', 'hitter'] as const;

/** Every tag any line asks for, so each line can be reached. */
function tagsFor(kind: CallKind): string[][] {
  return BANK.filter((l) => l.kind === kind).map((l) => (l.need ?? []).map((n) => (n.includes(':') ? `${n.split(':')[0]}:${n.split(':')[1]!.split('|')[0]}` : n.split('|')[0]!)));
}

describe('commentary: the bank', () => {
  it('fills every slot of every line, and says each event with nothing to name', () => {
    for (const l of BANK) {
      const t = fill(l.text, FULL);
      expect(t, l.id).not.toMatch(BAD);
      expect(t.charAt(0), l.id).toBe(t.charAt(0).toUpperCase());
    }
    const c = new Commentator(1);
    for (const k of KINDS) {
      // No names, no numbers, no tags: still a line, and still clean.
      const said = c.say(k, {});
      expect(said.text, k).not.toBe('');
      expect(said.text, k).not.toMatch(BAD);
      // Names that are missing in every way the sim can miss them.
      for (const v of [null, undefined, '', 'null', '  ']) {
        const s: Slots = {};
        for (const r of ROLES) (s as Record<string, unknown>)[r] = v;
        expect(c.say(k, s).text, `${k} ${String(v)}`).not.toMatch(BAD);
      }
    }
  });

  it('never prints null for a missing name (legacy L8): the fallback reads, capitalised at the start', () => {
    const c = new Commentator(2);
    const seen = new Set<string>();
    for (let k = 0; k < 40; k++) seen.add(c.say('int', { defender: null }).text);
    for (const t of seen) expect(t).not.toMatch(BAD);
    expect([...seen].some((t) => t.includes(FALLBACK.defender))).toBe(true);
    expect(fill('{defender} reads it all the way.', {})).toBe('The defense reads it all the way.');
    expect(fill('Fly... {receiver} is behind everybody!', {})).toBe('Fly... The receiver is behind everybody!');
    expect(fill('Picked off by {defender}!', { defender: 'null' })).toBe('Picked off by the defense!');
  });

  it('only says a number, a spot or a clock it has', () => {
    for (const l of BANK) {
      const needs = slotsOf(l.text).filter((s) => !(s in FALLBACK));
      if (needs.length) expect(canSay(l, {}), l.id).toBe(false);
      expect(canSay(l, FULL), l.id).toBe(true);
    }
    // NaN and Infinity aren't numbers to say.
    expect(canSay({ id: 'x', kind: 'pass', text: '{yards} yards' }, { yards: Number.NaN })).toBe(false);
  });

  it('agrees "a" and "an" with the number after it', () => {
    expect(fill('a {yards}-yard touchdown', { yards: 8 })).toBe('an 8-yard touchdown');
    expect(fill('a {yards}-yard touchdown', { yards: 11 })).toBe('an 11-yard touchdown');
    expect(fill('A {yards}-yard punt.', { yards: 83 })).toBe('An 83-yard punt.');
    expect(fill('a {yards}-yard touchdown', { yards: 34 })).toBe('a 34-yard touchdown');
    expect(fill('a {yards}-yard touchdown', { yards: 1 })).toBe('a 1-yard touchdown');
  });

  it('has a line that needs nothing for every event, and enough lines to vary the common ones', () => {
    for (const k of KINDS) expect(BANK.some((l) => l.kind === k && !l.need?.length && slotsOf(l.text).every((s) => s in FALLBACK)), k).toBe(true);
    for (const k of ['pass', 'run', 'incomplete', 'sack', 'passTD', 'rushTD', 'int', 'bigPass', 'bigRun'] as CallKind[]) expect(BANK.filter((l) => l.kind === k).length, k).toBeGreaterThanOrEqual(5);
    expect(new Set(BANK.map((l) => l.id)).size).toBe(BANK.length);
  });

  it('every line can be reached: its tags select it', () => {
    for (const k of KINDS) {
      for (const tags of tagsFor(k)) {
        const ids = new Set<string>();
        const c = new Commentator(7);
        for (let n = 0; n < 60; n++) ids.add(c.say(k, FULL, tags).id);
        const want = BANK.filter((l) => l.kind === k && (l.need ?? []).length === tags.length && (l.need ?? []).every((x, i) => x.split(':').pop()!.split('|').includes(tags[i]!.split(':').pop()!)));
        for (const w of want) expect(ids.has(w.id), `${w.id} with ${tags.join(',')}`).toBe(true);
      }
    }
  });
});

describe('commentary: variety and determinism', () => {
  it('never repeats a line inside the window', () => {
    for (const k of ['pass', 'run', 'incomplete', 'sack', 'passTD'] as CallKind[]) {
      const c = new Commentator(3);
      const said: string[] = [];
      const eligible = BANK.filter((l) => l.kind === k && !l.need?.length).length;
      for (let n = 0; n < 50; n++) said.push(c.say(k, FULL).id);
      // Within min(window, eligible) consecutive lines of one event, no line twice.
      const w = Math.min(VARIETY_WINDOW, eligible);
      for (let i = 0; i + w <= said.length; i++) expect(new Set(said.slice(i, i + w)).size, `${k} at ${i}`).toBe(w);
    }
  });

  it('a mixed game never repeats a line within the window', () => {
    const c = new Commentator(11);
    const kinds: CallKind[] = ['run', 'pass', 'incomplete', 'run', 'pass', 'sack', 'thirdLong', 'pass', 'bigRun', 'run', 'stuff', 'passTD', 'patGood', 'beastsFG', 'driveStart', 'pass', 'run'];
    const ids: string[] = [];
    for (let n = 0; n < 200; n++) ids.push(c.say(kinds[n % kinds.length]!, FULL).id);
    for (let i = 0; i < ids.length; i++) {
      const j = ids.indexOf(ids[i]!, i + 1);
      // A repeat comes back only when its event had nothing fresh left.
      if (j >= 0 && j - i < VARIETY_WINDOW) {
        const k = ids[i]!.split('.')[0] as CallKind;
        expect(BANK.filter((l) => l.kind === k && !l.need?.length).length, ids[i]).toBeLessThan(VARIETY_WINDOW);
      }
    }
  });

  it('prefers the line for the moment and the man: a trait or a situation line usually wins', () => {
    const c = new Commentator(5);
    let trait = 0;
    for (let n = 0; n < 40; n++) {
      const s = c.say('sack', FULL, ['rusher:speed-rusher']);
      if (s.trait) {
        trait++;
        expect(s.trait).toEqual({ role: 'rusher', id: 'speed-rusher' });
      }
    }
    expect(trait).toBeGreaterThan(8);
  });

  it('is deterministic: the same seed and events say the same lines, another seed does not', () => {
    const run = (seed: number) => {
      const c = new Commentator(seed);
      return Array.from({ length: 60 }, (_, n) => c.say((['pass', 'run', 'incomplete', 'sack'] as CallKind[])[n % 4]!, FULL, n % 3 ? ['firstDown'] : []).text);
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });
});

// Real snaps from the sim: whatever happens, the call has a kind, the line is clean, and a big play has its man.
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
function play(seed: number, playIdx: number, los: number, down = 1, toGo = 10): PlayState {
  const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: PLAYS[playIdx % PLAYS.length]!, def: DEF_CALLS[seed % DEF_CALLS.length]!, los, toGo, user: false, down });
  for (let k = 0; k < 60 * 25 && !s.result; k++) stepPlay(s, input({ snap: k === 0 }));
  return s;
}

describe('broadcast: reading a snap', () => {
  it('calls every kind of real snap cleanly, and names a big play’s man', () => {
    const c = new Commentator(9);
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 90; seed++) {
      const los = [25, 45, 70, 92][seed % 4]!;
      const down = [1, 2, 3, 4][seed % 4]!;
      const s = play(seed, seed * 7, los, down, down === 3 ? 8 : 10);
      if (!s.result) continue;
      const after = { user: s.result.touchdown && s.result.offenseBall ? 6 : 0, beasts: s.result.touchdown && !s.result.offenseBall ? 6 : 0 };
      const call = callForSnap(s, { before: { los, ballY: 0, down, toGo: down === 3 ? 8 : 10 }, outcome: null, score: { user: 0, beasts: 0 }, after, late: false, twoPoint: false });
      kinds.add(call.kind);
      const said = c.say(call.kind, call.slots, call.tags);
      expect(said.text, `${seed} ${call.kind}`).not.toMatch(BAD);
      if (s.result.touchdown || !s.result.offenseBall) expect(call.hero, `${seed} ${call.kind}`).not.toBeNull();
      if (call.hero) {
        expect(call.hero.player.name).toBeTruthy();
        expect(call.hero.tag).not.toMatch(BAD);
      }
      // The tags name only the men in the slots it filled.
      for (const t of call.tags) if (t.includes(':') && !t.startsWith('move:')) expect(call.slots[t.split(':')[0] as keyof Slots], t).toBeTruthy();
    }
    // A spread of plays: completions, runs and incompletions at least.
    expect(kinds.size).toBeGreaterThanOrEqual(5);
  });

  it('falls back when the sim has no name for a man (L8)', () => {
    const s = play(4, 3, 30);
    for (const a of s.agents) a.p = { ...a.p, name: '' };
    const call = callForSnap(s, { before: { los: 30, ballY: 0, down: 1, toGo: 10 }, outcome: null, score: { user: 0, beasts: 0 }, after: { user: 0, beasts: 0 }, late: false, twoPoint: false });
    const t = new Commentator(1).say(call.kind, call.slots, call.tags).text;
    expect(t).not.toMatch(BAD);
  });

  it('reads the Beasts’ possessions, kicks and punts', () => {
    const d = (p: Partial<BeastsDrive>): BeastsDrive => ({ result: 'TD', points: 7, plays: 9, yards: 75, top: '4:31', nextStart: 25, ...p });
    expect(callForBeasts(d({}), { user: 0, beasts: 0 }, false).tags).toContain('opening');
    expect(callForBeasts(d({}), { user: 7, beasts: 0 }, true).tags).toContain('answer');
    expect(callForBeasts(d({ result: 'Punt', points: 0, plays: 3 }), { user: 7, beasts: 0 }, true).tags).toContain('threeAndOut');
    const c = new Commentator(3);
    for (const r of ['TD', 'FG', 'Punt', 'Turnover', 'Downs', 'Safety', 'MissedFG', 'EndOfHalf', 'EndOfGame'] as BeastsDrive['result'][]) {
      const call = callForBeasts(d({ result: r, points: r === 'TD' ? 7 : r === 'FG' ? 3 : 0 }), { user: 3, beasts: 3 }, false);
      expect(c.say(call.kind, call.slots, call.tags).text, r).not.toMatch(BAD);
    }
    const fg = callForKick('FG', 47, { good: false, why: 'wideLeft', y: 0, z: 0, path: [], hang: 2 }, { mph: 14 }, { user: 0, beasts: 3 }, false);
    expect(fg.kind).toBe('fgMiss');
    expect(fg.tags).toEqual(expect.arrayContaining(['wideLeft', 'windy']));
    const good = callForKick('FG', 33, { good: true, why: 'good', y: 0, z: 0, path: [], hang: 2 }, { mph: 3 }, { user: 0, beasts: 0 }, true);
    expect(good.tags).toEqual(expect.arrayContaining(['takesLead', 'late']));
    const punt = callForPunt({ gross: 46, ret: 0, net: 46, how: 'fairCatch', hang: 4.4, beastsStart: 20 });
    expect(c.say(punt.kind, punt.slots, punt.tags).text).toMatch(/46/);
  });

  it('says a situation only when it is one, once a drive where it should', () => {
    const base = { driveStart: false, firstSnap: false, goingForIt: false, score: { user: 0, beasts: 0 }, twoMinute: null, saidThisDrive: new Set<CallKind>() };
    expect(callForSituation({ ...base, sit: { los: 40, ballY: 0, down: 2, toGo: 6 } })).toBeNull();
    expect(callForSituation({ ...base, sit: { los: 40, ballY: 0, down: 3, toGo: 9 } })?.kind).toBe('thirdLong');
    expect(callForSituation({ ...base, sit: { los: 40, ballY: 0, down: 3, toGo: 1 } })?.kind).toBe('thirdShort');
    expect(callForSituation({ ...base, goingForIt: true, sit: { los: 60, ballY: 0, down: 4, toGo: 2 } })?.kind).toBe('fourthDown');
    expect(callForSituation({ ...base, sit: { los: 93, ballY: 0, down: 1, toGo: 7 } })?.kind).toBe('goalToGo');
    expect(callForSituation({ ...base, saidThisDrive: new Set<CallKind>(['goalToGo']), sit: { los: 93, ballY: 0, down: 1, toGo: 7 } })).toBeNull();
    expect(callForSituation({ ...base, sit: { los: 84, ballY: 0, down: 1, toGo: 10 } })?.kind).toBe('redZone');
    expect(callForSituation({ ...base, driveStart: true, score: { user: 0, beasts: 7 }, sit: { los: 25, ballY: 0, down: 1, toGo: 10 } })).toMatchObject({ kind: 'driveStart', slots: { spot: 'CON 25', deficit: 7 } });
    expect(callForSituation({ ...base, twoMinute: { clock: '1:52', timeouts: 3 }, score: { user: 10, beasts: 14 }, sit: { los: 25, ballY: 0, down: 1, toGo: 10 } })).toMatchObject({ kind: 'twoMinute', slots: { need: 'a touchdown' } });
    expect(broadcastSpot(50)).toBe('50');
    expect(broadcastSpot(68)).toBe('BST 32');
  });
});

describe('broadcast: the drive strip', () => {
  const m = (b: Partial<BeastsDrive>[], u: Partial<UserDrive>[], phase: Match['phase'] = 'drive') =>
    ({
      beastsDrives: b.map((x) => ({ result: 'Punt', points: 0, plays: 4, yards: 20, top: '2:00', nextStart: 25, ...x })),
      userDrives: u.map((x) => ({ start: 25, plays: 6, yards: 40, result: 'Punt', points: 0, against: 0, ...x })),
      phase,
      ot: 0,
      cfg: { drives: 4, seed: 1, beastsRating: 80, diffAdj: 0, kickerRange: 56 },
    }) as unknown as Match;
  it('colours each possession by who scored, in order, with the one on now and those to come', () => {
    const st = driveStrip(m([{ result: 'TD', points: 7, seq: 0 }, { seq: 2 }], [{ result: 'TD', points: 7, seq: 1 }]));
    expect(st.pips.map((p) => `${p.team}:${p.tone}`)).toEqual(['bst:bst', 'con:con', 'bst:stop']);
    expect(st.now).toBe('con');
    expect(st.left).toBe(8 - 3 - 1);
    // A pick-six on your drive is their score.
    expect(driveStrip(m([{}], [{ result: 'Turnover', against: 7 }])).pips[1]).toMatchObject({ team: 'con', tone: 'bst', label: 'Pick-six' });
    // Older records (no order): Beasts first, then yours.
    expect(driveStrip(m([{ result: 'FG', points: 3 }, {}], [{}])).pips.map((p) => p.team)).toEqual(['bst', 'con', 'bst']);
  });
});
