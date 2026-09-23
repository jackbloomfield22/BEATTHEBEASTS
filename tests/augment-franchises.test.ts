// Franchise mapping for historical nflverse team codes (tools/augment/franchises.ts).
// Pure function tests; no data files needed.

import { describe, expect, it } from 'vitest';
import { decadeOf, decadeSeasons, franchiseOf, franchiseOfStrict, LEGACY_FRANCHISES } from '../tools/augment/franchises';

describe('franchiseOf', () => {
  it.each([
    // Raiders: Oakland, Los Angeles (RAI), Las Vegas.
    ['OAK', 1975, 'LV'],
    ['RAI', 1985, 'LV'],
    ['OAK', 2010, 'LV'],
    ['LV', 2021, 'LV'],
    // Oilers → Titans; Texans only from 2002.
    ['HOU', 1965, 'TEN'],
    ['HOU', 1996, 'TEN'],
    ['TEN', 1999, 'TEN'],
    ['HOU', 2005, 'HOU'],
    ['HST', 2010, 'HOU'],
    ['HOU', 2020, 'HOU'],
    // Colts in Baltimore; Ravens only from 1996.
    ['BAL', 1970, 'IND'],
    ['BAL', 1983, 'IND'],
    ['IND', 1984, 'IND'],
    ['BAL', 2000, 'BAL'],
    ['BLT', 2008, 'BAL'],
    // STL is the Cardinals to 1987 and the Rams from 1995.
    ['STL', 1960, 'ARI'],
    ['STL', 1987, 'ARI'],
    ['PHO', 1990, 'ARI'],
    ['ARZ', 2008, 'ARI'],
    ['STL', 1999, 'LAR'],
    ['SL', 2010, 'LAR'],
    // Rams in LA (LA 1961–1981, RAM 1982–1994) and the stats files' LA for every year.
    ['RAM', 1960, 'LAR'],
    ['LA', 1975, 'LAR'],
    ['RAM', 1990, 'LAR'],
    ['LA', 2003, 'LAR'],
    ['LA', 2020, 'LAR'],
    // Chargers: LA 1960 (CHR), San Diego, LA.
    ['CHR', 1960, 'LAC'],
    ['SD', 1990, 'LAC'],
    ['LAC', 2018, 'LAC'],
    // AFL originals and renamings.
    ['BOS', 1965, 'NE'],
    ['TEX', 1961, 'KC'],
    ['NYT', 1961, 'NYJ'],
    ['COW', 1961, 'DAL'],
    ['DAL', 1963, 'DAL'],
    ['CLV', 2005, 'CLE'],
  ] as const)('%s %i → %s', (code, season, want) => {
    expect(franchiseOf(code, season)).toBe(want);
  });

  it('returns null where a code means no franchise that season', () => {
    expect(franchiseOf('STL', 1990)).toBeNull(); // between the Cardinals leaving and the Rams arriving
    expect(franchiseOf('HOU', 1999)).toBeNull(); // between the Oilers and the Texans
    expect(franchiseOf('BAL', 1990)).toBeNull(); // between the Colts and the Ravens
    expect(franchiseOf('CHR', 1961)).toBeNull();
    expect(franchiseOf('TEX', 1963)).toBeNull();
    expect(franchiseOf('XYZ', 2000)).toBeNull();
    expect(() => franchiseOfStrict('XYZ', 2000)).toThrow();
  });

  it('only ever maps to legacy franchise codes', () => {
    const codes = ['ARI', 'ARZ', 'PHO', 'STL', 'SL', 'RAM', 'LA', 'CHR', 'SD', 'LAC', 'OAK', 'RAI', 'LV', 'BAL', 'BLT', 'IND', 'HOU', 'HST', 'TEN', 'CLE', 'CLV', 'BOS', 'NE', 'COW', 'DAL', 'TEX', 'KC', 'NYT', 'NYJ'];
    for (const c of codes) {
      for (let y = 1960; y <= 2025; y++) {
        const f = franchiseOf(c, y);
        if (f !== null) expect(LEGACY_FRANCHISES).toContain(f);
      }
    }
  });
});

describe('decades', () => {
  it('labels seasons and clips the last decade', () => {
    expect(decadeOf(1979)).toBe('1970s');
    expect(decadeOf(1980)).toBe('1980s');
    expect(decadeSeasons('1980s', 2025)).toEqual({ from: 1980, to: 1989 });
    expect(decadeSeasons('2020s', 2025)).toEqual({ from: 2020, to: 2025 });
  });
});
