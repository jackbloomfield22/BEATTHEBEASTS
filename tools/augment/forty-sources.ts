// Commonly cited 40-yard times for players with no measured time, read by
// tools/augment/forty.ts → data/augment/forty_times.json (user-approved, PR #3
// round 2: "a sourced list of commonly cited 40-yard times for players who
// never had combine data, the same method as arm_strength.json").
//
// Rules:
// - Only times a citable source states for this player. `quote` is verbatim
//   from the article prose (whitespace, typographic quotes and dashes folded)
//   and must contain every time in `times`; forty.ts checks it against the
//   cached Wikipedia page and refuses to write the file otherwise.
// - Found by scanning the Wikipedia article of every target player (the top
//   50 by OVR at each position without a measured time) for 40-yard mentions;
//   every hit was read and kept only when it states a timed run of this player.
//   Left out: rumors ("rumored to have the fastest recorded 40", Darrell
//   Green's 4.09), times that are not 40s, and other players' times.
// - Two times or a range ("4.4 or 4.5", "between 4.45 and 4.71", "initially
//   timed at 4.8 ... later clocked at 4.55") count as their mean.
// - `timing` sets the hand-time correction in the engine
//   (src/engine/ratings/physical.ts fortyCorrection): 'hand' for reported and
//   workout times with no stated timing (+0.06 s, as for other commonly cited
//   times), 'pro day' for an electronic pro-day time (+0.05), 'combine' for a
//   Scouting Combine time (+0.03, as for Wikipedia combine tables).
// - Everything here is conf 'estimated'. The engine gives a cited time a
//   Speed confidence between a body prior and a measured time.

export type FortyTiming = 'hand' | 'pro day' | 'combine';

export interface FortyDef {
  /** Legacy/roster name. */
  readonly name: string;
  /** Person id (people.json / nflverse gsis or PFR id). */
  readonly personId: string;
  readonly page: string;
  readonly quote: string;
  readonly times: readonly number[];
  readonly timing: FortyTiming;
  /** One line on when and how the time was run. */
  readonly basis: string;
}

const d = (name: string, personId: string, page: string, times: number[], timing: FortyTiming, quote: string, basis: string): FortyDef => ({ name, personId, page, times, timing, quote, basis });

export const FORTY_SOURCES: readonly FortyDef[] = [
  // --- QB
  d('Lamar Jackson', '00-0034796', 'Lamar Jackson', [4.34], 'hand', 'Jackson reportedly clocked in a 4.34 40 yard dash time in 2017 at Louisville.', 'College (2017), reported; he did not run at the 2018 Combine.'),
  // --- RB
  d('Bo Jackson', 'JackBo00', 'Bo Jackson', [4.13], 'pro day', 'he actually ran a 4.13 electronic-timed 40-yard dash at a pro day at Auburn University', '1986 Auburn pro day, electronic, his own account.'),
  d('Curtis Martin', '00-0010442', 'Curtis Martin', [4.4], 'hand', 'Martin was highly touted for his speed-he ran a 4.4 in the 40-yard dash-and his slashing running style.', 'Pre-draft (1995).'),
  d('Tony Dorsett', 'DorsTo00', 'Tony Dorsett', [4.3], 'hand', 'at the age of 34, he reportedly could still run 40 yards in 4.3 seconds.', 'Reported at 34 (1988 Denver camp); his peak time was no slower.'),
  d('Mike Pruitt', 'PruiMi00', 'Mike Pruitt', [4.4], 'hand', 'having been clocked at 4.4 seconds over 40 yards and bench pressing 425 pounds.', 'College (Purdue).'),
  // --- WR
  d('Jerry Rice', '00-0013639', 'Jerry Rice', [4.45, 4.71], 'hand', 'Sources vary on his 40-yard dash time, which was measured between 4.45 and 4.71 seconds.', '1985 pre-draft; the source gives the range, the mean is used.'),
  d('Charlie Joiner', 'JoinCh00', 'Charlie Joiner', [4.5], 'hand', 'great speed (4.5 seconds in the 40-yard dash) and excellent hands.', '1969 draft review (Corpus Christi Times), quoted by the article.'),
  // --- TE
  d('Jackie Smith', 'SmitJa00', 'Jackie Smith', [4.6], 'hand', 'he could reportedly still run the 40-yard dash in 4.6 seconds.', 'Reported at 38 (1978 Dallas); his peak time was no slower.'),
  // --- DE
  d('Neil Smith', '00-0015267', 'Neil Smith (American football)', [4.55], 'hand', 'had a 7-foot-1½-inch arm span, and ran a 4.55 forty-yard dash.', 'Pre-draft measurables (1988).'),
  d('Cedrick Hardman', 'HardCe00', 'Cedrick Hardman', [4.6], 'hand', 'He is reported to have run the 40-yard dash in 4.6 seconds while being scouted at the Senior Bowl.', 'Senior Bowl scouting (1970).'),
  d('Charles Haley', '00-0006633', 'Charles Haley', [4.8, 4.55], 'hand', 'initially timed at 4.8 seconds in the 40-yard dash, although he was later clocked by a 49ers scout at 4.55 seconds.', 'Pre-draft (1986): two timings, the mean is used.'),
  d('Tommy Hart', 'HartTo00', 'Tommy Hart', [4.5], 'hand', 'Hart had run the 40-yard dash in 4.5 seconds.', '1968 training camp, repeated in the 1970 preseason.'),
  // --- DT
  d('Warren Sapp', '00-0014358', 'Warren Sapp', [4.69], 'hand', 'Sapp ran the fastest time in the 40-yard dash for a defensive tackle (4.69 sec).', 'Pre-draft (1995).'),
  d('Buck Buchanan', 'BuchBu00', 'Buck Buchanan', [4.9], 'hand', 'He also reportedly ran 4.9 in the 40-yard dash and 10.2 in the 100-yard dash at Grambling.', 'College (Grambling).'),
  // --- LB
  d('Isiah Robertson', 'RobeIs00', 'Isiah Robertson', [4.6], 'hand', 'having been timed at 4.6 seconds in the 40-yard dash.', 'Pro career, timed.'),
  d('London Fletcher', '00-0005322', 'London Fletcher', [4.38], 'combine', 'Fletcher attended the NFL Scouting Combine and ran a 4.38 in the 40-yard dash.', '1998 Scouting Combine (before the nflverse combine file, which starts in 2000).'),
  d('Mike Curtis', 'CurtMi00', 'Mike Curtis (American football)', [4.3], 'hand', 'Curtis once ran the forty-yard dash in 4.3 seconds.', 'Reported, no date or timing given.'),
  d('Bobby Bell', 'BellBo00', 'Bobby Bell', [4.4, 4.5], 'hand', 'he was also reported to have run a 4.4 or 4.5 40-yard dash.', 'Reported; two figures, the mean is used.'),
  // --- CB
  d('Roger Wehrli', 'WehrRo00', 'Roger Wehrli', [4.5], 'hand', 'he ran a 4.5 40-yard dash and vaulted into the first round.', 'Pre-draft (1969).'),
  d('Everson Walls', '00-0017104', 'Everson Walls', [4.72], 'hand', 'he ran the 40-yard dash in a disappointing 4.72 seconds during workouts.', 'Pre-draft workouts (1981).'),
  d('Mel Renfro', 'RenfMe00', 'Mel Renfro', [4.65], 'hand', 'The speedy Renfro (4.65 40-yd dash) became an exceptional threat to wide receivers', 'Reported, no date given.'),
  d('Albert Lewis', '00-0009836', 'Albert Lewis (American football)', [4.38], 'hand', 'at one point running a 4.38 in the 40-yard dash.', 'Reported, no date given.'),
];
