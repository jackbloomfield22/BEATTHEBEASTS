// Historical nflverse team codes → legacy franchise codes.
//
// The legacy data uses FRANCHISE-CURRENT codes (TEN = Oilers/Titans, LV =
// Raiders in Oakland/LA/Las Vegas, LAR = Rams in LA/St. Louis, IND = Colts
// incl. Baltimore, LAC = Chargers incl. San Diego, ARI = Cardinals incl.
// Chicago/St. Louis/Phoenix, NE = Patriots incl. Boston, KC = Chiefs incl. the
// Dallas Texans, NYJ = Jets incl. the NY Titans, HOU = Texans only, BAL =
// Ravens only). nflverse uses different codes per dataset and per era, and
// several codes mean different franchises in different seasons.
//
// Every range below was checked against the downloaded data (the season span
// in which each code actually occurs, printed by build.ts into
// docs/AUGMENT_REPORT.md). Codes seen:
//
//   rosters 1960–2025  ARI 1994–2001,2016–   ARZ 2002–2015   PHO 1988–1993
//                      STL 1960–1987 (Cardinals) and 1995–2001 (Rams)
//                      SL 2002–2015 (Rams)    RAM 1960,1982–1994   LA 1961–1981,2016–
//                      CHR 1960 (the Los Angeles Chargers; checked: Jack Kemp, Ron Mix, Paul Lowe)
//                      SD 1961–2016   LAC 2017–   OAK 1960–1981,1995–2019   RAI 1982–1994   LV 2020–
//                      BAL 1960–1983 (Colts) and 1996–2001,2016– (Ravens)   BLT 2002–2015   IND 1984–
//                      HOU 1960–1996 (Oilers) and 2016– (Texans)   HST 2002–2015   TEN 1997–
//                      CLE 1960–1995,1999–2001,2016–   CLV 2002–2015
//                      BOS 1960–1970   NE 1971–   COW 1960–1962   DAL 1963–
//                      TEX 1960–1962 (Dallas Texans → KC)   KC 1963–   NYT 1960–1962   NYJ 1963–
//   stats 1999–2025    current codes throughout: LA (Rams incl. St. Louis), LAC, LV, HOU 2002–
//   games 1999–        OAK –2019, SD –2016, STL –2015 (Rams), LA 2016–, LAC 2017–, LV 2020–
//
// Note the 1996 Baltimore Ravens are the relocated Browns franchise legally,
// but the NFL (and the legacy data) treat the Browns' history as staying in
// Cleveland, so BAL from 1996 is BAL and CLE stays CLE.

export type LegacyFranchise =
  | 'ARI' | 'ATL' | 'BAL' | 'BUF' | 'CAR' | 'CHI' | 'CIN' | 'CLE' | 'DAL' | 'DEN' | 'DET' | 'GB'
  | 'HOU' | 'IND' | 'JAX' | 'KC' | 'LAC' | 'LAR' | 'LV' | 'MIA' | 'MIN' | 'NE' | 'NO' | 'NYG'
  | 'NYJ' | 'PHI' | 'PIT' | 'SEA' | 'SF' | 'TB' | 'TEN' | 'WAS';

export const LEGACY_FRANCHISES: readonly LegacyFranchise[] = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
  'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
];

interface Span {
  readonly from: number;
  readonly to: number;
  readonly franchise: LegacyFranchise;
}

const ALWAYS = (franchise: LegacyFranchise): Span[] => [{ from: 1900, to: 9999, franchise }];

/** nflverse code → season spans. Seasons outside every span are an error. */
const CODE_SPANS: Readonly<Record<string, readonly Span[]>> = {
  // Cardinals: Chicago (–1959), St. Louis (1960–1987), Phoenix (1988–1993), Arizona (1994–).
  ARI: ALWAYS('ARI'),
  ARZ: ALWAYS('ARI'),
  PHO: ALWAYS('ARI'),
  CRD: ALWAYS('ARI'),
  // STL is the Cardinals until they left after 1987, then the Rams from 1995.
  STL: [
    { from: 1900, to: 1987, franchise: 'ARI' },
    { from: 1995, to: 2015, franchise: 'LAR' },
  ],
  // Rams: LA (–1994), St. Louis (1995–2015), LA (2016–).
  SL: ALWAYS('LAR'),
  RAM: ALWAYS('LAR'),
  LAR: ALWAYS('LAR'),
  // "LA" is the Rams in every nflverse file checked (rosters 1961–1981 and 2016–,
  // stats 1999– where St. Louis years are normalized to LA, games 2016–).
  LA: ALWAYS('LAR'),
  // Chargers: LA (1960, code CHR), San Diego (1961–2016), LA (2017–).
  CHR: [{ from: 1960, to: 1960, franchise: 'LAC' }],
  SD: ALWAYS('LAC'),
  SDG: ALWAYS('LAC'),
  LAC: ALWAYS('LAC'),
  // Raiders: Oakland (1960–1981, 1995–2019), LA (1982–1994, code RAI), Las Vegas (2020–).
  OAK: ALWAYS('LV'),
  RAI: ALWAYS('LV'),
  LV: ALWAYS('LV'),
  LVR: ALWAYS('LV'),
  // BAL is the Colts until they left after 1983, then the Ravens from 1996.
  BAL: [
    { from: 1900, to: 1983, franchise: 'IND' },
    { from: 1996, to: 9999, franchise: 'BAL' },
  ],
  BLT: ALWAYS('BAL'),
  IND: ALWAYS('IND'),
  // HOU is the Oilers until they left after 1996, then the Texans from 2002.
  HOU: [
    { from: 1900, to: 1996, franchise: 'TEN' },
    { from: 2002, to: 9999, franchise: 'HOU' },
  ],
  HST: ALWAYS('HOU'),
  TEN: ALWAYS('TEN'),
  CLE: ALWAYS('CLE'),
  CLV: ALWAYS('CLE'),
  // Patriots: Boston (1960–1970).
  BOS: ALWAYS('NE'),
  NE: ALWAYS('NE'),
  // Cowboys: COW in the 1960–1962 rosters (Dallas also had the AFL Texans then).
  COW: ALWAYS('DAL'),
  DAL: [{ from: 1960, to: 9999, franchise: 'DAL' }],
  // Dallas Texans (AFL 1960–1962) became the Kansas City Chiefs.
  TEX: [{ from: 1960, to: 1962, franchise: 'KC' }],
  KC: ALWAYS('KC'),
  // New York Titans (AFL 1960–1962) became the Jets.
  NYT: ALWAYS('NYJ'),
  NYJ: ALWAYS('NYJ'),
  ATL: ALWAYS('ATL'),
  BUF: ALWAYS('BUF'),
  CAR: ALWAYS('CAR'),
  CHI: ALWAYS('CHI'),
  CIN: ALWAYS('CIN'),
  DEN: ALWAYS('DEN'),
  DET: ALWAYS('DET'),
  GB: ALWAYS('GB'),
  JAX: ALWAYS('JAX'),
  JAC: ALWAYS('JAX'),
  MIA: ALWAYS('MIA'),
  MIN: ALWAYS('MIN'),
  NO: ALWAYS('NO'),
  NYG: ALWAYS('NYG'),
  PHI: ALWAYS('PHI'),
  PIT: ALWAYS('PIT'),
  SEA: ALWAYS('SEA'),
  SF: ALWAYS('SF'),
  TB: ALWAYS('TB'),
  WAS: ALWAYS('WAS'),
};

/** Legacy franchise for an nflverse team code in a season, or null when the code/season pair is unknown. */
export function franchiseOf(code: string, season: number): LegacyFranchise | null {
  const spans = CODE_SPANS[code];
  if (!spans) return null;
  for (const s of spans) if (season >= s.from && season <= s.to) return s.franchise;
  return null;
}

/** Like franchiseOf, but throws so an unseen code fails the pipeline instead of dropping rows. */
export function franchiseOfStrict(code: string, season: number): LegacyFranchise {
  const f = franchiseOf(code, season);
  if (f === null) throw new Error(`Unknown nflverse team code ${JSON.stringify(code)} in ${season}`);
  return f;
}

/** Decade label for a season, e.g. 1985 → '1980s'. */
export function decadeOf(season: number): string {
  return `${Math.floor(season / 10) * 10}s`;
}

/** First and last season of a decade label, clipped to the data's last season. */
export function decadeSeasons(decade: string, lastSeason: number): { from: number; to: number } {
  const from = Number(decade.slice(0, 4));
  return { from, to: Math.min(from + 9, lastSeason) };
}
