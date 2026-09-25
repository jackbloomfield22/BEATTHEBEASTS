import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SLOT_ORDER } from '@data/legacy/constants';
import { getDailyChallenge } from '@/engine/legacy/daily';
import {
  autoAllowed,
  autoDraft,
  candidates,
  createDraft,
  draftedTeam,
  draftPick,
  isComplete,
  makeCatalog,
  roundOf,
  skipEra,
  skipTeam,
  spin,
  type Candidate,
  type DraftState,
} from '@/game/draft';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8'));
const numbers = JSON.parse(readFileSync('data/augment/jerseys.json', 'utf8')).numbers;
const cat = makeCatalog(snap, numbers);

/** Take the highest-rated eligible candidate this round offers. */
function takeBest(s: DraftState): Candidate {
  const all = Object.values(candidates(cat, s)).flat().filter((c) => c!.slot) as Candidate[];
  return all.sort((a, b) => b.ovr - a.ovr)[0]!;
}

function draftAll(s: DraftState): void {
  for (let r = 0; r < 9 && !isComplete(s); r++) {
    spin(cat, s);
    const c = takeBest(s);
    expect(c, `round ${r} offers nobody for an open slot (${s.pair?.t} ${s.pair?.d})`).toBeTruthy();
    draftPick(cat, s, c);
  }
}

describe('draft (GDD §6): the legacy rules on the new ratings', () => {
  it('nine rounds fill the nine slots; RB then RB2, WR1 then WR2 then WR3, TE then TE2', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = createDraft('classic', seed);
      draftAll(s);
      expect(isComplete(s)).toBe(true);
      expect(roundOf(s)).toBe(9);
      if (s.roster.RB2) expect(s.roster.RB!.round).toBeLessThan(s.roster.RB2.round);
      if (s.roster.WR3) expect(s.roster.WR2!.round).toBeLessThan(s.roster.WR3.round);
      expect(s.roster.OL!.linemen).toHaveLength(5);
    }
  });

  it('no person twice (ids, not names), and no two players share a number', () => {
    for (const seed of [11, 12, 13, 14]) {
      const s = createDraft('classic', seed);
      draftAll(s);
      const people = Object.values(s.roster).flatMap((p) => p!.personIds);
      expect(new Set(people).size).toBe(people.length);
      const nums = Object.values(s.roster).flatMap((p) => (p!.linemen ? p!.linemen.map((l) => l.num) : [p!.num]));
      expect(new Set(nums).size).toBe(nums.length);
    }
    // The same man on another team: Joe Montana (SF 1980s) blocks Joe Montana (KC 1990s).
    const s = createDraft('classic', 7);
    s.pair = { t: 'SF', d: '1980s' };
    draftPick(cat, s, candidates(cat, s).QB!.find((c) => c.name === 'Joe Montana')!);
    s.pair = { t: 'KC', d: '1990s' };
    expect((candidates(cat, s).QB ?? []).some((c) => c.name === 'Joe Montana')).toBe(false);
  });

  it('rows data/corrections.json excludes are never offered (Anthony Munoz is a tackle, not a TE)', () => {
    const s = createDraft('classic', 1);
    s.pair = { t: 'CIN', d: '1980s' };
    const c = candidates(cat, s);
    expect((c.TE ?? []).some((x) => x.name === 'Anthony Munoz')).toBe(false);
    expect(c.OL?.length).toBeGreaterThan(0);
  });

  it('once a 1970s player is drafted, no more 1970s rolls', () => {
    const s = createDraft('classic', 21);
    s.pair = { t: 'PIT', d: '1970s' };
    draftPick(cat, s, candidates(cat, s).QB!.find((c) => c.name === 'Terry Bradshaw')!);
    for (let i = 0; i < 200; i++) expect(spin(cat, s)!.d).not.toBe('1970s');
  });

  it('one Team Skip (keeps the decade) and one Era Skip (keeps the team)', () => {
    const s = createDraft('classic', 31);
    const first = spin(cat, s)!;
    expect(skipTeam(cat, s)).toBe(true);
    expect(s.pair!.d).toBe(first.d);
    expect(skipTeam(cat, s)).toBe(false);
    const before = s.pair!;
    expect(skipEra(cat, s)).toBe(true);
    expect(s.pair!.t).toBe(before.t);
    expect(skipEra(cat, s)).toBe(false);
  });

  it("the Daily plays the date's fixed sequence, with no skips and no Auto-Draft", () => {
    const key = '2026-09-25';
    const legacy = getDailyChallenge(key).sequence;
    const s = createDraft('daily', 99, key);
    expect(skipTeam(cat, s)).toBe(false);
    expect(autoAllowed(s)).toBe(false);
    expect(autoDraft(cat, s)).toEqual([]);
    for (let r = 0; r < 9; r++) {
      const pair = spin(cat, s)!;
      const live = Object.values(candidates(cat, s)).flat().some((c) => c!.slot);
      if (live) expect(pair).toEqual(legacy[r]);
      draftPick(cat, s, takeBest(s));
    }
    expect(isComplete(s)).toBe(true);
  });

  it('Auto-Draft fills the open slots and keeps the picks already made', () => {
    const s = createDraft('classic', 41);
    for (let r = 0; r < 3; r++) {
      spin(cat, s);
      draftPick(cat, s, takeBest(s));
    }
    const kept = { ...s.roster };
    spin(cat, s);
    autoDraft(cat, s);
    expect(isComplete(s)).toBe(true);
    for (const k of Object.keys(kept) as (keyof typeof kept)[]) expect(s.roster[k]!.id).toBe(kept[k]!.id);
    // Quick Play: the whole roster at once.
    const q = createDraft('quick', 42);
    autoDraft(cat, q);
    expect(isComplete(q)).toBe(true);
  });

  it('the same seed drafts the same team (replayable)', () => {
    const a = createDraft('quick', 77);
    const b = createDraft('quick', 77);
    autoDraft(cat, a);
    autoDraft(cat, b);
    expect(SLOT_ORDER.map((k) => a.roster[k]!.id)).toEqual(SLOT_ORDER.map((k) => b.roster[k]!.id));
  });

  it('the drafted team goes into the sim with his number', () => {
    const s = createDraft('quick', 5);
    autoDraft(cat, s);
    const t = draftedTeam(cat, s.roster);
    expect(t.QB.num).toBe(s.roster.QB!.num);
    expect(t.OL.map((l) => l.pos)).toEqual(['OL', 'OL', 'OL', 'OL', 'OL']);
    expect(t.WR3.pos).toBe('WR');
  });

  it('real numbers where the data has them (Montana 16 in San Francisco, Rice 80)', () => {
    const s = createDraft('classic', 8);
    s.pair = { t: 'SF', d: '1980s' };
    const qb = draftPick(cat, s, candidates(cat, s).QB!.find((c) => c.name === 'Joe Montana')!)!;
    s.pair = { t: 'SF', d: '1980s' };
    const wr = draftPick(cat, s, candidates(cat, s).WR!.find((c) => c.name === 'Jerry Rice')!)!;
    expect([qb.num, qb.numEstimated, wr.num]).toEqual([16, false, 80]);
  });
});
