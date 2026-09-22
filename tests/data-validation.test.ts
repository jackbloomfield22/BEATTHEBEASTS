// Pins the legacy data validation findings (docs/DATA_VALIDATION.md). If the
// legacy data or the checks change, these fail, so new drift is caught.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildReport, REPORT_PATH } from '../tools/reports/validate-data';

const { result, markdown } = buildReport();
const who = (e: { n: string; p: string; t: string; d: string }) => `${e.n}|${e.p}|${e.t}|${e.d}`;

describe('legacy data validation', () => {
  it('finds exactly the known schema-mismatch set', () => {
    expect(result.majoritySchemas).toEqual({ QB: ['i', 'r', 'ry', 't', 'y'], RB: ['c', 'r', 't', 'y'], WR: ['c', 'p', 't', 'y'], TE: ['b', 't', 'y'] });
    expect(result.schemaMismatches.map((m) => `${who(m)} carries ${m.carries.join('/')}`).sort()).toEqual([
      'Anthony Miller|WR|DAL|1990s carries TE',
      'Carl Garrett|RB|LV|1970s carries WR',
      'Larry Centers|RB|WAS|1990s carries TE',
      'Ron Howard|TE|DAL|1970s carries WR',
    ]);
  });

  it('flags the 2020s WR catch % values and the RB YPC outlier', () => {
    const [over100, over80, rbYpc] = result.impossible;
    expect(over80!.entries.map((e) => e.n).sort()).toEqual([
      'Amon-Ra St. Brown', 'Chris Olave', 'George Pickens', "Ja'Marr Chase", 'Jaxon Smith-Njigba', 'Puka Nacua', 'Zay Flowers',
    ]);
    expect(over80!.entries.every((e) => e.d === '2020s')).toBe(true);
    expect(over100!.entries.map((e) => e.n).sort()).toEqual(['Amon-Ra St. Brown', "Ja'Marr Chase", 'Jaxon Smith-Njigba', 'Puka Nacua']);
    expect(rbYpc!.entries.map(who)).toEqual(['Carl Garrett|RB|LV|1970s']);
    for (const f of result.impossible.slice(3)) expect(f.entries, f.what).toEqual([]);
  });

  it('duplicates, aliases and filler rows', () => {
    const [pl, de, olu, du] = result.duplicateNaturalKeys;
    expect(pl!.entries).toEqual([]);
    expect(de!.entries).toEqual([]);
    expect(du!.entries).toEqual([]);
    expect(olu!.entries.map((e) => `${e.n}|${e.t}|${e.d}`)).toEqual(['Tennessee Titans|TEN|1990s', 'Tennessee Oilers/Titans|TEN|1990s']);
    expect(result.keyListAliases.entries.map((e) => e.detail)).toContain('Jimbo Covert · Jim Covert (surname Covert)');
    expect(result.defenderFillerRows.map((r) => r.n).sort()).toEqual(['Andy Russell', 'Greg Lloyd', 'Kenny Easley', 'Wally Chambers']);
    expect(result.sameNameManyEntries.find((h) => h.n === 'Mike Williams')?.entries.length).toBe(6);
    expect(result.homonymsAcrossPositions.map((h) => h.n)).toEqual(expect.arrayContaining(['Alex Smith', 'Larry Brown', 'James Jones']));
  });

  it('ea − imp is a fixed offset per position and decade', () => {
    for (const byDec of Object.values(result.eaOffsets)) for (const cell of Object.values(byDec)) expect(Object.keys(cell).length).toBe(1);
    expect(result.eaOffsets.QB!['1970s']).toEqual({ '+4': 75 });
    expect(result.eaOffsets.WR!['2020s']).toEqual({ '-1': 164 });
  });

  it('imp evenness matches the planning audit', () => {
    const p = result.impStats.find((s) => s.dataset === 'PLAYERS')!;
    expect(p.max).toBe(97);
    expect((100 * p.even) / p.n).toBeCloseTo(59.6, 1);
  });

  it('docs/DATA_VALIDATION.md is up to date', () => {
    expect(readFileSync(REPORT_PATH, 'utf8')).toBe(markdown);
  });
});
