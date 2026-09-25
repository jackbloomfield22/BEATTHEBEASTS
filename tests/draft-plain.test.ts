// The draft shows no numbers (M6 follow-up): plain-language trait reasons,
// attribute highlights by name, and the pick list by position then last name.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMBOS, parseRanks, plainWhy, TRAIT_DEFS, UNIT_TRAITS } from '@/engine/ratings/traits';
import type { SnapshotEntry } from '@/engine/ratings/snapshot';
import { candidates, createDraft, makeCatalog, spin, validPairs, type Candidate, type UnitSnap } from '@/game/draft';
import { compareForList, highlights, lastName, LIST_POS_ORDER, plainTraits } from '@/game/draftView';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as { entries: SnapshotEntry[]; units: UnitSnap[] };
const numbers = JSON.parse(readFileSync('data/augment/jerseys.json', 'utf8')).numbers;
const cat = makeCatalog(snap, numbers);

describe('plain-language why lines', () => {
  const lines: { who: string; id: string; why: string; plain: string }[] = [];
  for (const e of snap.entries) for (const t of e.traits) lines.push({ who: `${e.name} (${e.pos})`, id: t.id, why: t.why, plain: plainWhy(e.pos, t) });
  for (const u of snap.units) for (const t of u.traits) lines.push({ who: u.id, id: t.id, why: t.why, plain: plainWhy('OL', t) });

  it('covers the whole catalog', () => {
    expect(lines.length).toBeGreaterThan(4000);
  });

  it('every trait of every player and unit gets a plain line with no digits', () => {
    for (const l of lines) {
      expect(l.plain, `${l.who} ${l.id}: ${l.why}`).not.toBe('');
      expect(l.plain, `${l.who} ${l.id}`).not.toMatch(/\d/);
    }
  });

  it('reads one rank per condition from the numeric line', () => {
    const conds = (id: string) => {
      const c = COMBOS.find((x) => x.id === id);
      const n = (p: string) => (TRAIT_DEFS.find((d) => d.id === p) ?? UNIT_TRAITS.find((d) => d.id === p))!.conds.length;
      return c ? n(c.parts[0]) + n(c.parts[1]) : n(id);
    };
    for (const l of lines) expect(parseRanks(l.why).length, `${l.who} ${l.id}: ${l.why}`).toBe(conds(l.id));
  });

  it('names the attribute and the level', () => {
    expect(plainWhy('TE', { id: 'sixth-lineman', why: 'Run Block 91 (top 3% of TEs)' })).toBe('elite run blocking for a tight end');
    expect(plainWhy('WR', { id: 'burner', why: 'Speed 96 (top 8% of WRs)' })).toBe('among the fastest receivers');
    expect(plainWhy('S', { id: 'enforcer', why: 'Hit Power 98 (best of 55 safeties) and Tackle 82 (top 21% of safeties)' })).toBe('the best hitting power of any safety and strong tackling for a safety');
    expect(plainWhy('QB', { id: 'sack-magnet', why: '9.7% sack rate (league 6.9%) (bottom 5% of QBs)' })).toBe('exceptionally sack-prone for a quarterback');
    expect(plainWhy('QB', { id: 'bomb-squad', why: 'Cannon (Throw Power 97 (top 1% of QBs)) + Deep Ball Artist (Deep Accuracy 92 (top 6% of QBs))' })).toBe(
      'Cannon: elite arm strength for a quarterback; Deep Ball Artist: among the best quarterbacks in deep accuracy',
    );
    expect(plainWhy('OL', { id: 'road-graders', why: 'Run block 80 (mean of the five) (top 12% of OL units)' })).toBe('very good run blocking for an offensive line');
  });
});

describe('the pick list order', () => {
  it('last names skip suffixes', () => {
    expect(lastName('Odell Beckham Jr.')).toBe('Beckham');
    expect(lastName('Marvin Harrison Jr')).toBe('Harrison');
    expect(lastName('Robert Griffin III')).toBe('Griffin');
    expect(lastName('Randy Moss')).toBe('Moss');
  });

  it('runs QB, RB, WR, TE, OL, then last name, whatever the ratings', () => {
    const c = (pos: string, name: string, ovr: number) => ({ pos, name, id: name, ovr }) as unknown as Candidate;
    const list = [c('OL', 'PIT 1970s line', 90), c('WR', 'Lynn Swann', 99), c('QB', 'Terry Bradshaw', 70), c('RB', 'Rocky Bleier', 60), c('RB', 'Franco Harris', 95), c('WR', 'John Stallworth', 50), c('TE', 'Bennie Cunningham', 40)];
    expect(list.sort(compareForList).map((x) => x.name)).toEqual(['Terry Bradshaw', 'Rocky Bleier', 'Franco Harris', 'John Stallworth', 'Lynn Swann', 'Bennie Cunningham', 'PIT 1970s line']);
  });

  it('holds for real pairs from the catalog', () => {
    const s = createDraft('classic', 11);
    for (const pair of validPairs(cat, s).slice(0, 60)) {
      const list = (Object.values(candidates(cat, s, pair)).flat() as Candidate[]).sort(compareForList);
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]!;
        const b = list[i]!;
        const pa = LIST_POS_ORDER.indexOf(a.pos as never);
        const pb = LIST_POS_ORDER.indexOf(b.pos as never);
        expect(pa <= pb, `${a.name} before ${b.name}`).toBe(true);
        if (pa === pb) expect(lastName(a.name).localeCompare(lastName(b.name), 'en', { sensitivity: 'base' }) <= 0, `${a.name} before ${b.name}`).toBe(true);
      }
    }
  });
});

describe('the Scouting card in the draft', () => {
  it('names the top three card attributes, highest first, ties in card order', () => {
    const qb = { kind: 'player' as const, pos: 'QB' as const, attrs: { shortAcc: 80, deepAcc: 90, throwPower: 90, decision: 70, pocketPresence: 85, scramble: 60 } };
    expect(highlights(qb)).toEqual(['Deep Accuracy', 'Throw Power', 'Pocket Presence']);
    const wr = { kind: 'player' as const, pos: 'WR' as const, attrs: { speed: 97, shortRoute: 80, deepRoute: 92, catching: 90, catchInTraffic: 70, rac: 60 } };
    expect(highlights(wr)).toEqual(['Speed', 'Deep Route Running', 'Catching']);
    expect(highlights({ kind: 'unit', pos: 'OL', attrs: { passBlock: 70, runBlock: 80 } })).toEqual(['Run Block', 'Pass Block']);
  });

  it('shows no digits for anyone a draft can offer', () => {
    const s = createDraft('classic', 3);
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      spin(cat, s);
      for (const c of Object.values(candidates(cat, s)).flat() as Candidate[]) {
        seen++;
        const h = highlights(c);
        expect(h.length).toBe(c.kind === 'unit' ? 2 : 3);
        for (const text of [...h, ...plainTraits(c).map((t) => t.why)]) expect(text, c.name).not.toMatch(/\d/);
      }
    }
    expect(seen).toBeGreaterThan(100);
  });
});
