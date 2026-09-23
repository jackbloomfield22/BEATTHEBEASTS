// Checks the estimated pre-1999 defensive stint totals
// (data/augment/estimated_def_stints_pre1999.json, method in
// tools/reference/estimated_def_notes.md). Offline: it reads only the JSON and
// the generated legacy data.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFENSE } from '@data/legacy';

interface DefEstimate {
  readonly name: string;
  readonly seasons: readonly [number, number];
  readonly sk?: number;
  readonly skUnofficial: boolean;
  readonly skOfficial?: number;
  readonly int?: number;
  readonly ff?: number;
  readonly fr?: number;
  readonly td?: number;
  readonly allPro1Seasons?: readonly number[];
  readonly proBowlSeasons?: readonly number[];
  readonly dpoySeasons?: readonly number[];
  readonly legacy: Record<string, number | boolean>;
  readonly verdict: string;
  readonly src: string;
  readonly conf: string;
  readonly certainty: string;
  readonly note: string;
}

const PATH = new URL('../data/augment/estimated_def_stints_pre1999.json', import.meta.url);
const raw = JSON.parse(readFileSync(PATH, 'utf8')) as Record<string, unknown>;
const entries = Object.entries(raw).filter(([k]) => !k.startsWith('_')) as [string, DefEstimate][];
const byId = new Map(DEFENSE.map((d) => [d.id, d]));
const PRE_2000 = ['1960s', '1970s', '1980s', '1990s'];
const VERDICTS = ['stint-ok', 'career-totals', 'decade-totals-across-teams', 'other-mismatch'];

const get = (id: string): DefEstimate => {
  const e = raw[id] as DefEstimate | undefined;
  if (!e) throw new Error(`missing estimate ${id}`);
  return e;
};

/** The verdict rule from the notes: within max(2, 20% of the estimate). */
const close = (legacy: number, est: number) => Math.abs(legacy - est) <= Math.max(2, 0.2 * est);

describe('estimated pre-1999 defensive stints', () => {
  it('covers nearly every 1960s-1990s defender', () => {
    const inScope = DEFENSE.filter((d) => PRE_2000.includes(d.d)).length;
    expect(entries.length).toBeGreaterThan(inScope - 10);
  });

  it('every key is a pre-2000 DEFENSE entry and the name and legacy stats match', () => {
    for (const [id, e] of entries) {
      const d = byId.get(id);
      expect(d, id).toBeDefined();
      expect(PRE_2000, id).toContain(d!.d);
      expect(e.name, id).toBe(d!.n);
      expect(e.legacy, id).toEqual(d!.s);
    }
  });

  it('every value is flagged as an estimate with a verdict', () => {
    for (const [id, e] of entries) {
      expect(e.src, id).toBe('estimate:knowledge');
      expect(e.conf, id).toBe('estimated');
      expect(['high', 'med', 'low'], id).toContain(e.certainty);
      expect(VERDICTS, id).toContain(e.verdict);
      expect(typeof e.note, id).toBe('string');
      expect(e.sk !== undefined || e.int !== undefined, `${id} has sk or int`).toBe(true);
    }
  });

  it('seasons fall inside the entry decade and stop at 1998', () => {
    for (const [id, e] of entries) {
      const start = Number(byId.get(id)!.d.slice(0, 4));
      const [first, last] = e.seasons;
      expect(Number.isInteger(first) && Number.isInteger(last), id).toBe(true);
      expect(first, id).toBeGreaterThanOrEqual(start);
      expect(last, id).toBeLessThanOrEqual(Math.min(start + 9, 1998));
      expect(first, id).toBeLessThanOrEqual(last);
    }
  });

  it('counting stats are in sane per-season ranges', () => {
    for (const [id, e] of entries) {
      const n = e.seasons[1] - e.seasons[0] + 1;
      for (const [field, cap] of [['sk', 30], ['int', 14], ['ff', 12], ['fr', 8], ['td', 5]] as const) {
        const v = e[field];
        if (v === undefined) continue;
        expect(v, `${id} ${field}`).toBeGreaterThanOrEqual(0);
        expect(v / n, `${id} ${field}/season`).toBeLessThanOrEqual(cap);
      }
      if (e.skOfficial !== undefined) expect(e.skOfficial, id).toBeLessThanOrEqual(e.sk!);
    }
  });

  it('skUnofficial is set exactly when the sack total includes a pre-1982 season', () => {
    for (const [id, e] of entries) {
      expect(e.skUnofficial, id).toBe(e.sk !== undefined && e.seasons[0] < 1982);
    }
  });

  it('honors fall inside the stint; AP DPOY only from 1971', () => {
    for (const [id, e] of entries) {
      const [first, last] = e.seasons;
      for (const list of [e.allPro1Seasons, e.proBowlSeasons, e.dpoySeasons]) {
        for (const y of list ?? []) {
          expect(y, id).toBeGreaterThanOrEqual(first);
          expect(y, id).toBeLessThanOrEqual(last);
        }
      }
      for (const y of e.dpoySeasons ?? []) expect(y, id).toBeGreaterThanOrEqual(1971);
      // All-Pro and Pro Bowl lists come as a pair so a missing list never reads as zero.
      expect(e.allPro1Seasons === undefined, id).toBe(e.proBowlSeasons === undefined);
    }
  });

  it('the verdict follows the documented rule', () => {
    for (const [id, e] of entries) {
      const checks: boolean[] = [];
      const lsk = e.legacy['sk'];
      if (e.sk !== undefined && typeof lsk === 'number') checks.push(close(lsk, e.sk));
      if (e.int !== undefined) checks.push(close(e.legacy['int'] as number, e.int));
      expect(checks.length, id).toBeGreaterThan(0);
      expect(e.verdict === 'stint-ok', id).toBe(checks.every(Boolean));
    }
  });

  it('spot values match well-known careers', () => {
    const deionDal = get('defense:deion-sanders:DAL:1990s');
    expect(deionDal.int!).toBeLessThanOrEqual(15);
    expect(deionDal.verdict).not.toBe('stint-ok');

    const deionAtl = get('defense:deion-sanders:ATL:1980s');
    expect(deionAtl.int).toBe(5);
    expect(deionAtl.seasons).toEqual([1989, 1989]);

    // Official 1982-89 (104) plus the researched 9.5 of 1981.
    const lt = get('defense:lawrence-taylor:NYG:1980s');
    expect(lt.sk!).toBeGreaterThanOrEqual(100);
    expect(lt.sk!).toBeLessThanOrEqual(125);
    expect(lt.skUnofficial).toBe(true);
    expect(lt.skOfficial).toBe(104);
    expect(lt.dpoySeasons).toEqual([1981, 1982, 1986]);

    // 1985-89 only: 13 + 18 + 21 + 18 + 11 = 81. His 1990-92 Eagles sacks
    // (43) belong to no legacy entry; the full 1985-92 Eagles total is 124.
    const reggiePhi = get('defense:reggie-white:PHI:1980s');
    expect(reggiePhi.sk!).toBeGreaterThanOrEqual(78);
    expect(reggiePhi.sk!).toBeLessThanOrEqual(84);
    expect(reggiePhi.skUnofficial).toBe(false);

    expect(get('defense:reggie-white:GB:1990s').verdict).toBe('decade-totals-across-teams');
    expect(get('defense:coy-bacon:CIN:1970s').verdict).toBe('career-totals');
    expect(get('defense:coy-bacon:CIN:1970s').sk!).toBeLessThan(35);
    expect(get('defense:bobby-boyd:IND:1960s').verdict).toBe('stint-ok');
  });
});
