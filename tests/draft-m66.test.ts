import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { candidates, createDraft, draftedTeam, draftPick, makeCatalog, type Candidate } from '@/game/draft';
import { depthChart, depthDiffers } from '@/game/depth';
import { honorStickers, unitPool, unitWord, UNIT_WORD_CUTS } from '@/game/draftView';
import { backFor, squadFor } from '@/game/rotation';
import { startSituation } from '@/game/situation';
import { layoutStickers } from '@/render/locker/textures';
import { TEXT_PEAK, wallInk } from '@/render/locker/videoWall';
import { PLAYS, practiceRosters, type SnapshotLike } from '@/sim';

// M6.6: the depth chart, the backfield rotation, the O-line's word and
// honors, every trait sticker on the stall, and the wall's type under the
// bloom threshold.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8'));
const numbers = JSON.parse(readFileSync('data/augment/jerseys.json', 'utf8')).numbers;
const honors = JSON.parse(readFileSync('data/augment/honors.json', 'utf8'));
const cat = makeCatalog(snap, numbers);

const pick = (s: ReturnType<typeof createDraft>, t: string, d: string, name: string) => {
  s.pair = { t, d };
  const c = Object.values(candidates(cat, s))
    .flat()
    .find((x) => x!.name === name) as Candidate;
  return draftPick(cat, s, c)!;
};

describe('the best man starts (Playtest 2)', () => {
  it('a back drafted second starts over a lesser back drafted first; the depth chart shows it', () => {
    const s = createDraft('classic', 3);
    const first = pick(s, 'SF', '1980s', 'Earl Cooper');
    const second = pick(s, 'DET', '1990s', 'Barry Sanders');
    expect([first.slot, second.slot]).toEqual(['RB', 'RB2']); // the stalls fill in pick order
    const d = depthChart(s.roster);
    expect(d.RB!.name).toBe('Barry Sanders');
    expect(d.RB!.slot).toBe('RB');
    expect(d.RB2!.name).toBe('Earl Cooper');
    expect(depthDiffers(s.roster)).toBe(true);
    // The draft's own roster (the locker room) is untouched.
    expect(s.roster.RB!.name).toBe('Earl Cooper');
  });

  it('receivers sort into WR1–WR3 by rating, and the sim gets the depth chart', () => {
    const s = createDraft('classic', 4);
    pick(s, 'SF', '1980s', 'Dwight Clark');
    pick(s, 'DAL', '1990s', 'Michael Irvin');
    pick(s, 'SF', '1980s', 'Jerry Rice');
    const d = depthChart(s.roster);
    expect(d.WR1!.name).toBe('Jerry Rice');
    expect(d.WR1!.ovr).toBeGreaterThanOrEqual(d.WR2!.ovr);
    expect(d.WR2!.ovr).toBeGreaterThanOrEqual(d.WR3!.ovr);
  });

  it('draftedTeam plays the depth chart', () => {
    const s = createDraft('quick', 5);
    const pickAll = (t: string, d: string, pos: string) => {
      s.pair = { t, d };
      return (candidates(cat, s)[pos as 'QB'] ?? []).filter((c) => c.slot).sort((a, b) => a.ovr - b.ovr)[0]!;
    };
    // Weakest first, so the draft order and the depth chart disagree.
    for (const [t, d, pos] of [['SF', '1980s', 'QB'], ['SF', '1980s', 'RB'], ['DET', '1990s', 'RB'], ['SF', '1980s', 'WR'], ['SF', '1990s', 'WR'], ['DAL', '1990s', 'WR'], ['SF', '1980s', 'TE'], ['SF', '1990s', 'TE'], ['DAL', '1990s', 'OL']] as const) {
      const c = pickAll(t, d, pos);
      draftPick(cat, s, c);
    }
    const team = draftedTeam(cat, s.roster);
    const ovr = (id: string) => cat.entry.get(id)!.ovr;
    expect(ovr(team.RB.id)).toBeGreaterThanOrEqual(ovr(team.RB2.id));
    expect(ovr(team.WR1.id)).toBeGreaterThanOrEqual(ovr(team.WR2.id));
    expect(ovr(team.WR2.id)).toBeGreaterThanOrEqual(ovr(team.WR3.id));
    expect(ovr(team.TE.id)).toBeGreaterThanOrEqual(ovr(team.TE2.id));
  });
});

describe("RB2's rotation", () => {
  const R = practiceRosters(snap as SnapshotLike);
  const sit = (o: Partial<ReturnType<typeof startSituation>> = {}) => ({ ...startSituation(0, 0), los: 35, down: 1, toGo: 10, ...o });
  const byId = (id: string) => PLAYS.find((p) => p.id === id)!;
  const screen = PLAYS.find((p) => p.type === 'screen' && (p.formation.personnel === '11' || p.formation.personnel === '10'))!;
  const run11 = PLAYS.find((p) => p.run && p.formation.personnel === '11' && !p.situ)!;
  const fb = PLAYS.find((p) => p.formation.personnel === '21')!;

  it('screens and passing downs are his; the fullback sets and the goal line stay the starter', () => {
    expect(backFor(screen, sit(), 1).back).toBe('RB2');
    expect(backFor(run11, sit({ down: 3, toGo: 7 }), 1).back).toBe('RB2');
    expect(backFor(fb, sit({ down: 3, toGo: 7 }), 3).back).toBe('RB');
    expect(backFor(run11, sit({ down: 2, toGo: 1, los: 98 }), 3).back).toBe('RB');
    expect(backFor(byId(run11.id), sit(), 1).back).toBe('RB');
  });

  it('a third of the early-down snaps: the change of pace', () => {
    const calls = Array.from({ length: 12 }, (_, i) => backFor(run11, sit({ down: 1 + (i % 2) }), i + 1).back);
    expect(calls.filter((b) => b === 'RB2')).toHaveLength(4);
  });

  it('the squad swaps the two backs only when RB2 has it', () => {
    const t = squadFor(R.team, screen, sit(), 1);
    expect(t.RB.id).toBe(R.team.RB2.id);
    expect(t.RB2.id).toBe(R.team.RB.id);
    expect(squadFor(R.team, run11, sit(), 1)).toBe(R.team);
  });
});

describe('the O-line in the draft (no numbers)', () => {
  const pool = unitPool(cat.unit.values());

  it('one word from the unit rating, by its rank in the pool, with the trace', () => {
    const sorted = [...pool].sort((a, b) => a - b);
    expect(unitWord(sorted[sorted.length - 1]!, pool).word).toBe('Elite');
    expect(unitWord(sorted[0]!, pool).word).toBe('Weak');
    const counts = { Elite: 0, Strong: 0, Solid: 0, Weak: 0 };
    for (const u of cat.unit.values()) counts[unitWord(u.ovr, pool).word]++;
    // The cuts' shares, give or take ties.
    expect(counts.Elite / pool.length).toBeGreaterThan(0.05);
    expect(counts.Elite / pool.length).toBeLessThan(0.15);
    expect(counts.Weak / pool.length).toBeGreaterThan(0.18);
    const r = unitWord(80, pool);
    expect(r.contributions.map((c) => c.label)).toEqual(['unit OVR', 'rated units in the pool', 'units rated below it', 'cut']);
    expect(UNIT_WORD_CUTS.map((c) => c.word)).toEqual(['Elite', 'Strong', 'Solid', 'Weak']);
  });

  it("the linemen's honors as stickers", () => {
    const id = 'ol-units:dallas-cowboys:DAL:1990s#LT';
    expect(honorStickers(id, honors.allPro, honors.proBowl)).toEqual([`${honors.allPro[id]}× All-Pro`, `${honors.proBowl[id]}× Pro Bowl`]);
    expect(honorStickers('nobody', honors.allPro, honors.proBowl)).toEqual([]);
  });
});

describe('the locker and the wall', () => {
  it('every sticker fits the cabinet: six at 512×180 (tag, four traits, All-Pro)', () => {
    const widths = (f: number) => [9, 13, 11, 14, 12, 10].map((chars) => chars * f * 0.5);
    const { boxes } = layoutStickers(widths, 512, 180);
    expect(boxes).toHaveLength(6);
    for (const b of boxes) {
      expect(b.x + b.w).toBeLessThanOrEqual(512);
      expect(b.y + b.h).toBeLessThanOrEqual(180);
    }
  });

  it('wall type stays under the bloom threshold after the wall brightness', () => {
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    for (const col of ['#ffffff', '#aaff00', 'rgba(255,255,255,0.75)', '#ff2a4d']) {
      const m = /(\d+),(\d+),(\d+)/.exec(wallInk(col, 2.2))!;
      const peak = Math.max(...[m[1], m[2], m[3]].map((x) => lin(Number(x) / 255))) * 2.2;
      expect(peak).toBeLessThanOrEqual(TEXT_PEAK + 0.01);
      expect(peak).toBeLessThan(0.75);
    }
  });
});
