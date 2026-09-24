// The brief's calibration anchors (BRIEF "Validation: prove the ratings are
// right"). Bands are position-relative. When a formula puts an anchor
// outside its band, the formula is the suspect, but the user asked us to flag
// an anchor we think is wrong rather than bend a formula to fit it: see
// `review` notes, which RATINGS_REPORT.md prints next to the result.

export type Check = (
  | { attr: string; op: '>=' | '<'; value: number }
  /** Percentile within the position pool (0 = worst, 100 = best). */
  | { attr: string; op: 'pct<='; value: number }
  /** Rank within the position pool (1 = best). */
  | { attr: string; op: 'rank<='; value: number }
  /** Body measure, top N of the position pool. */
  | { attr: 'heightIn'; op: 'rank<='; value: number }
) & {
  /** Stints the check applies to (default: every stint of the anchor). */
  only?: string[];
};

export interface Anchor {
  /** Legacy entry ids the check applies to (every listed stint must pass). */
  ids: string[];
  label: string;
  checks: Check[];
  /** Why the anchor is flagged for the user's review (it fails, or a note on it). */
  review?: string;
  /** A band the user approved changing: the old band, the new one and why (ratings follow-up). */
  approved?: string;
}

const ge = (attr: string, value: number): Check => ({ attr, op: '>=', value });
const lt = (attr: string, value: number): Check => ({ attr, op: '<', value });
const bottom10 = (attr: string): Check => ({ attr, op: 'pct<=', value: 10 });
const top = (attr: string, n: number): Check => ({ attr, op: 'rank<=', value: n });
/** The check for the listed stints only. */
const on = (c: Check, ...only: string[]): Check => ({ ...c, only });

// Ratings follow-up (user decision): "accept every band change I proposed
// for the flagged anchors". Each `approved` note gives the old band, the new
// one and where it came from in the flag's own proposal. Near misses ("94,
// want 95") take the value the flag named. Anchors whose flag proposed no
// band (Favre) or that still fail at the proposed band keep `review`.
const FU = 'User-approved band change (ratings follow-up).';

export const ANCHORS: Anchor[] = [
  { ids: ['players:joe-montana:SF:1980s'], label: 'Joe Montana (1980s SF)', checks: [ge('shortAcc', 95), ge('midAcc', 95), ge('underPressure', 95), lt('throwPower', 88)] },
  { ids: ['players:dan-marino:MIA:1980s'], label: 'Dan Marino (1980s MIA)', checks: [ge('release', 97), ge('throwPower', 95), bottom10('scramble')], approved: `User-approved band change (ratings follow-up, round 2). Release 99 → 97+: his 99 came from sack rate (the lowest of his era), which the approved sack-rate split moved into Pocket Presence, where he is 99; the anchor stays on Release. Throw Power 95+ passes on the air yards and sourced arm grade approved earlier ("cannon" from pro-era descriptions); bottom-10% Scramble passes.` },
  { ids: ['players:peyton-manning:IND:2000s'], label: 'Peyton Manning (2000s IND)', checks: [ge('awareness', 97), { attr: 'scramble', op: 'pct<=', value: 16 }], approved: `${FU} Scramble bottom 10% → bottom 16% ("Scramble lands at the 13th–16th percentile; everyone below him is a backup with near-zero rushing. I'd accept Scramble"). The 97+ band moved from Decision Making to Awareness earlier (user decision after the M2 review).` },
  { ids: ['players:tom-brady:NE:2010s'], label: 'Tom Brady (2010s NE)', checks: [ge('decision', 97), ge('shortAcc', 95), ge('midAcc', 95), bottom10('speed')] },
  { ids: ['players:patrick-mahomes:KC:2010s', 'players:patrick-mahomes:KC:2020s'], label: 'Patrick Mahomes (KC)', checks: [ge('throwOnRun', 97), on(ge('throwPower', 95), 'players:patrick-mahomes:KC:2010s'), on(ge('throwPower', 90), 'players:patrick-mahomes:KC:2020s')], approved: `${FU} Throw Power 95+ → 90+ for the 2020s stint only (his 2020s yards per completion and intended air yards are close to league average, a shorter passing game; the data describe where he throws, not the arm). The 2010s stint keeps 95+.` },
  { ids: ['players:brett-favre:GB:1990s'], label: 'Brett Favre (1990s GB)', checks: [ge('throwPower', 97), lt('decision', 90)], review: 'Throw Power 84 (top 18%) after the ratings follow-up, up from 79. Favre\'s 1990s Green Bay yards per completion was about league average in a West Coast offense, there are no air yards before 2006, and the arm list grades him "strong" on comparison evidence only (his arm is cited as the benchmark for other QBs), which counts at 0.75. I think 97+ can\'t be met honestly from the data we have; a pro-era source calling his arm among the strongest ever would move the grade to cannon. Decision Making below elite passes. (No band was proposed here, so the band stays and the flag stays.)' },
  { ids: ['players:michael-vick:ATL:2000s'], label: 'Michael Vick (2000s ATL)', checks: [ge('speed', 97), lt('shortAcc', 85), lt('midAcc', 85)] },
  { ids: ['players:lamar-jackson:BAL:2010s', 'players:lamar-jackson:BAL:2020s'], label: 'Lamar Jackson (BAL)', checks: [ge('speed', 95)], approved: `${FU} Speed 97+ → 95+ (he never ran at the combine, and 97+ needs about 4.30 electronic on this scale).`, review: 'Round 2 moved his 4.34 from an uncited estimate (read as electronic: Speed 96.5) to the cited time in his Wikipedia article ("reportedly clocked in a 4.34 40 yard dash time in 2017 at Louisville"). The source gives no timing, so the engine applies the standard correction for reported times (+0.06 s, as for every commonly cited time): 4.40, Speed 94.5, a hair under the approved 95+. I have not changed the rule for one player; your call (a Louisville laser time would make it +0.05 or less).' },
  { ids: ['players:barry-sanders:DET:1990s'], label: 'Barry Sanders (DET)', checks: [ge('elusiveness', 99), ge('agility', 90), lt('trucking', 80)], approved: `${FU} Agility 99 → 90+ for an unmeasured player (no drill times exist for him: agility is a prior plus his yards-per-carry signature; a measured cone or shuttle would move it).` },
  { ids: ['players:earl-campbell:TEN:1970s'], label: 'Earl Campbell (1970s TEN)', checks: [ge('trucking', 90)], approved: `${FU} Trucking 97+ → 90+ (Trucking is mostly mass; at 232 lb the 250–265 lb backs rank above him, and the violence of his running is in no stat).` },
  { ids: ['players:derrick-henry:TEN:2020s'], label: 'Derrick Henry (2020s TEN)', checks: [ge('trucking', 97)] },
  { ids: ['players:jerome-bettis:PIT:1990s'], label: 'Jerome Bettis (1990s PIT)', checks: [ge('trucking', 94), lt('speed', 85)], approved: `${FU} Trucking 95+ → 94+ (near miss: "Trucking 94, want 95").` },
  { ids: ['players:walter-payton:CHI:1970s', 'players:walter-payton:CHI:1980s'], label: 'Walter Payton (CHI)', checks: [ge('stiffArm', 80), ge('breakTackle', 93)], approved: `${FU} The flag proposed accepting both: Stiff Arm 95+ → 80+ ("the formula uses size, strength and production, and Payton (5'10", 200 lb) lands in the 80s"; his stiff arm is technique the data can't see) and Break Tackle 95+ → 93+ ("within a point or two").` },
  { ids: ['players:eric-dickerson:LAR:1980s'], label: 'Eric Dickerson (1980s LAR)', checks: [ge('speed', 95)] },
  { ids: ['players:marshall-faulk:LAR:1990s', 'players:marshall-faulk:LAR:2000s'], label: 'Marshall Faulk (LAR)', checks: [top('catching', 5), top('routeRunning', 5)] },
  { ids: ['players:christian-mccaffrey:SF:2020s'], label: 'Christian McCaffrey (2020s SF)', checks: [top('catching', 5), top('routeRunning', 5)] },
  { ids: ['players:jerry-rice:SF:1980s', 'players:jerry-rice:SF:1990s'], label: 'Jerry Rice (SF)', checks: [ge('shortRoute', 99), ge('deepRoute', 99), ge('catching', 95), lt('speed', 92)], review: 'Rice\'s 1980s stint is Deep Route 99, Catching 99 and Short Route rank 4 (97). The 1990s stint covers ages 28–37: short routes rank 1 (99), but his deep game (about 14 yards per catch) ranks 13th behind deep specialists. I think 97+ deep for the 1990s stint over-rates it; the 1980s stint is the 99.' },
  { ids: ['players:randy-moss:MIN:1990s'], label: 'Randy Moss (1990s MIN)', checks: [ge('speed', 97), ge('spectacular', 99), ge('jumping', 99)], approved: `${FU} The anchor moved from the NE 2000s stint (ages 30–33, where the aging curve takes about 4 points) to his MIN 1990s stint; bands unchanged. Measured: 4.25 pro-day 40 and a 47" vertical.` },
  { ids: ['players:calvin-johnson:DET:2010s'], label: 'Calvin Johnson (2010s DET)', checks: [ge('catchInTraffic', 99), { attr: 'heightIn', op: 'rank<=', value: 10 }, top('jumping', 10)] },
  { ids: ['players:tyreek-hill:KC:2010s', 'players:tyreek-hill:MIA:2020s'], label: 'Tyreek Hill (KC, MIA)', checks: [on(ge('speed', 95), 'players:tyreek-hill:KC:2010s'), on(ge('acceleration', 95), 'players:tyreek-hill:KC:2010s'), on(ge('speed', 93), 'players:tyreek-hill:MIA:2020s'), on(ge('acceleration', 93), 'players:tyreek-hill:MIA:2020s')], approved: `${FU} Speed and Acceleration 99 → 95+ at KC (ages 22–27) and 93+ at MIA (ages 28–31); on this scale 99 speed is reserved for about a 4.22 electronic 40.`, review: 'Still fails at the proposed band on one check: MIA Acceleration 92.2 (want 93+). His measured 1.50 10-yard split gives 94.6 at KC; the wide-receiver aging curve takes 2.5 points by age 30. The flag\'s own numbers were 94 / 92 (speed / acceleration) at MIA, so "93+ at MIA" fits speed, not acceleration. I\'m not inventing a new band: your call (92+ acceleration at MIA would pass).' },
  { ids: ['players:larry-fitzgerald:ARI:2000s'], label: 'Larry Fitzgerald (2000s ARI)', checks: [ge('catchInTraffic', 93)], approved: `${FU} Catch in Traffic 97+ → 93+ (height, TDs per catch, volume and honors put Calvin Johnson, Rice and Owens above him). The 'speed below 88' band was dropped after the M2 review.` },
  { ids: ['players:cris-carter:MIN:1990s'], label: 'Cris Carter (1990s MIN)', checks: [ge('catchInTraffic', 96), lt('speed', 88)], approved: 'Band 97+ → 96+ (you, M5: "Cris Carter: accept 96+, keep the anchor on Catch in Traffic"). The M4.5 added stints (Owens, Moss) moved the WR pool every receiver is standardized against: 96.7 → 96.4. Carter\'s own inputs are unchanged.' },
  { ids: ['players:wes-welker:NE:2000s', 'players:wes-welker:NE:2010s'], label: 'Wes Welker (NE)', checks: [on(ge('shortRoute', 97), 'players:wes-welker:NE:2000s'), on(ge('shortRoute', 95), 'players:wes-welker:NE:2010s')], approved: `${FU} Short Route 97+ → 95+ for the 2010s stint only (2010–12, ages 29–31; near miss at 95). The 2000s stint keeps 97+.` },
  { ids: ['players:antonio-brown:PIT:2010s'], label: 'Antonio Brown (2010s PIT)', checks: [ge('shortRoute', 96)], approved: `${FU} Short Route 97+ → 96+ (near miss: "96, want 97").` },
  { ids: ['players:tony-gonzalez:KC:2000s'], label: 'Tony Gonzalez (2000s KC)', checks: [ge('catching', 95), ge('shortRoute', 95)] },
  { ids: ['players:travis-kelce:KC:2010s', 'players:travis-kelce:KC:2020s'], label: 'Travis Kelce (KC)', checks: [ge('catching', 95), ge('shortRoute', 95)] },
  { ids: ['players:rob-gronkowski:NE:2010s'], label: 'Rob Gronkowski (2010s NE)', checks: [ge('runBlock', 90), ge('catchInTraffic', 95)] },
  { ids: ['defense:lawrence-taylor:NYG:1980s'], label: 'Lawrence Taylor (1980s NYG)', checks: [ge('finesseMoves', 99), ge('pursuit', 99)] },
  { ids: ['defense:reggie-white:PHI:1980s', 'defense:reggie-white:GB:1990s'], label: 'Reggie White (PHI, GB)', checks: [ge('powerMoves', 97)] },
  { ids: ['defense:bruce-smith:BUF:1990s'], label: 'Bruce Smith (1990s BUF)', checks: [ge('powerMoves', 97)] },
  { ids: ['defense:aaron-donald:LAR:2010s'], label: 'Aaron Donald (2010s LAR)', checks: [ge('blockShed', 99), top('finesseMoves', 3)] },
  { ids: ['defense:deacon-jones:LAR:1960s'], label: 'Deacon Jones (1960s LAR)', checks: [ge('finesseMoves', 97)] },
  { ids: ['defense:deion-sanders:DAL:1990s', 'defense:deion-sanders:ATL:1980s'], label: 'Deion Sanders (DAL, ATL)', checks: [on(ge('manCov', 99), 'defense:deion-sanders:DAL:1990s'), on(ge('speed', 95), 'defense:deion-sanders:ATL:1980s')], approved: `${FU} Speed 99 on the DAL stint (ages 28–32) → 95+ on the young ATL 1980s stint (his 1989 combine 4.27). Tackle below 70 is dropped as data-limited: no tackle data exists before 1999, so a pre-1999 DB's tackling is body and experience, and his poor-tackler reputation is in no dataset we can use. Man Coverage 99 on the DAL stint is unchanged.` },
  { ids: ['defense:darrelle-revis:NYJ:2000s', 'defense:darrelle-revis:NYJ:2010s'], label: 'Darrelle Revis (NYJ)', checks: [ge('manCov', 93), ge('press', 93)], approved: `${FU} Man Coverage and Press 97+ → 93+ (both NYJ stints include non-peak seasons; 97+ fits his 2009–11 peak, not the stints as a whole).`, review: 'Still fails at the proposed band on one check: NYJ 2000s Press 92.4 (want 93+). Press has no stat trace (honors, strength, length and passes defensed); the 2000s stint (2007–09: 1× All-Pro, 2× Pro Bowl in 3 seasons, his rookie year without honors) sits below the honors density of this elite pool, so honors pull it down 2 points. Man Coverage passes for both stints and Press passes for 2010s (93.1). I\'m not inventing a new band: your call. After the M4.5 added stints (four more CB stints in the pool) NYJ 2000s Press reads 92.6, which rounds to 93 and passes; the flag stays until you clear it.' },
  { ids: ['defense:sauce-gardner:NYJ:2020s'], label: 'Sauce Gardner (2020s NYJ)', checks: [ge('manCov', 90)] },
  { ids: ['defense:patrick-surtain-ii:DEN:2020s'], label: 'Patrick Surtain II (2020s DEN)', checks: [ge('manCov', 90)] },
  { ids: ['defense:mel-blount:PIT:1970s'], label: 'Mel Blount (1970s PIT)', checks: [ge('press', 96)], approved: `${FU} Press 97+ → 96+ (near miss: "Press 96, want 97"; Press has no stat trace).` },
  { ids: ['defense:ed-reed:BAL:2000s'], label: 'Ed Reed (2000s BAL)', checks: [ge('ballSkills', 99), ge('zoneCov', 99)] },
  { ids: ['defense:ray-lewis:BAL:2000s'], label: 'Ray Lewis (2000s BAL)', checks: [ge('tackle', 95), ge('pursuit', 95), ge('playRec', 95)] },
  { ids: ['defense:dick-butkus:CHI:1960s'], label: 'Dick Butkus (1960s CHI)', checks: [ge('tackle', 95), ge('pursuit', 94), ge('playRec', 95), ge('hitPower', 99)], approved: `${FU} Pursuit 95+ → 94+ (near miss: "Pursuit 94, want 95"; no tackle data exists for his era).` },
  { ids: ['defense:mike-singletary:CHI:1980s'], label: 'Mike Singletary (1980s CHI)', checks: [ge('tackle', 95), ge('pursuit', 95), ge('playRec', 95)] },
  { ids: ['defense:ronnie-lott:SF:1980s'], label: 'Ronnie Lott (1980s SF)', checks: [ge('hitPower', 94)], approved: `${FU} Hit Power 97+ → 94+ (near miss: "lands mid-90s, not 97"; Hit Power reads mass, forced fumbles, not tracked before about 1990, and honors, and Lott was 203 lb).` },
];
