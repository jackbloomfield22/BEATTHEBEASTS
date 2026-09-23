// The brief's calibration anchors (BRIEF "Validation: prove the ratings are
// right"). Bands are position-relative. When a formula puts an anchor
// outside its band, the formula is the suspect, but the user asked us to flag
// an anchor we think is wrong rather than bend a formula to fit it: see
// `review` notes, which RATINGS_REPORT.md prints next to the result.

export type Check =
  | { attr: string; op: '>=' | '<'; value: number }
  /** Percentile within the position pool (0 = worst, 100 = best). */
  | { attr: string; op: 'pct<='; value: number }
  /** Rank within the position pool (1 = best). */
  | { attr: string; op: 'rank<='; value: number }
  /** Body measure, top N of the position pool. */
  | { attr: 'heightIn'; op: 'rank<='; value: number };

export interface Anchor {
  /** Legacy entry ids the check applies to (every listed stint must pass). */
  ids: string[];
  label: string;
  checks: Check[];
  review?: string;
}

const ge = (attr: string, value: number): Check => ({ attr, op: '>=', value });
const lt = (attr: string, value: number): Check => ({ attr, op: '<', value });
const bottom10 = (attr: string): Check => ({ attr, op: 'pct<=', value: 10 });
const top = (attr: string, n: number): Check => ({ attr, op: 'rank<=', value: n });

export const ANCHORS: Anchor[] = [
  { ids: ['players:joe-montana:SF:1980s'], label: 'Joe Montana (1980s SF)', checks: [ge('shortAcc', 95), ge('midAcc', 95), ge('underPressure', 95), lt('throwPower', 88)] },
  { ids: ['players:dan-marino:MIA:1980s'], label: 'Dan Marino (1980s MIA)', checks: [ge('release', 99), ge('throwPower', 95), bottom10('scramble')], review: 'Throw Power: arm strength has no box-score trace. The formula reads yards per completion (deep share), yards per attempt and passing volume vs league, plus capped reputation. Marino\'s deep share was above average, not extreme, so he lands in the high 80s. Options: accept that Throw Power is data-limited, or add air yards per attempt (nflverse play-by-play, 2006 on) plus a sourced, flagged \'cannon\' list for older QBs. Release 99 and bottom-10% Scramble pass.' },
  { ids: ['players:peyton-manning:IND:2000s'], label: 'Peyton Manning (2000s IND)', checks: [ge('awareness', 97), ge('decision', 97), bottom10('scramble')], review: 'Decision Making is interception avoidance (the brief\'s definition). Manning\'s 2000s INT rate was 2.5% against a 3.0% league: good, not extreme; Rodgers and Brady in the 2010s, Montana and Young rank above him. His reputation is pre-snap command, which Awareness captures (99, passes). Scramble lands at the 13th percentile; everyone below him is a backup with near-zero rushing. I\'d move the 97+ to Awareness and accept Scramble.' },
  { ids: ['players:tom-brady:NE:2010s'], label: 'Tom Brady (2010s NE)', checks: [ge('decision', 97), ge('shortAcc', 95), ge('midAcc', 95), bottom10('speed')] },
  { ids: ['players:patrick-mahomes:KC:2010s', 'players:patrick-mahomes:KC:2020s'], label: 'Patrick Mahomes (KC)', checks: [ge('throwOnRun', 97), ge('throwPower', 95)], review: 'Throw Power passes for the 2010s stint (97) but not 2020s: his 2020s yards per completion is close to league average (a shorter passing game), and the stats can\'t see arm talent. Same data limit as Marino/Favre; Throw on the Run passes for both stints.' },
  { ids: ['players:brett-favre:GB:1990s'], label: 'Brett Favre (1990s GB)', checks: [ge('throwPower', 97), lt('decision', 90)], review: 'Throw Power: Favre\'s 1990s Green Bay yards per completion was about league average in a West Coast offense, so no stat separates his arm; only capped reputation can, and it may add at most 20%. I think 97+ can\'t be met honestly without an arm-specific input (see Marino). Decision Making below elite passes.' },
  { ids: ['players:michael-vick:ATL:2000s'], label: 'Michael Vick (2000s ATL)', checks: [ge('speed', 97), lt('shortAcc', 85), lt('midAcc', 85)] },
  { ids: ['players:lamar-jackson:BAL:2010s', 'players:lamar-jackson:BAL:2020s'], label: 'Lamar Jackson (BAL)', checks: [ge('speed', 97)], review: 'Near miss: Speed 96.5 from his commonly cited 4.34 (he never ran at the combine). With the soft top of the speed scale, 97+ needs about 4.30 electronic. I\'d accept 95+.' },
  { ids: ['players:barry-sanders:DET:1990s'], label: 'Barry Sanders (DET)', checks: [ge('elusiveness', 99), ge('agility', 99), lt('trucking', 80)], review: 'Elusiveness 99 and Trucking below 80 pass. Agility is 92 (6th of 822 backs): no drill times exist for him (the pre-draft table has only a 4.37 pro-day 40), so agility is a prior plus his yards-per-carry signature, and estimates can\'t honestly reach 99. A measured cone or shuttle would. I\'d accept 90+ for an unmeasured player.' },
  { ids: ['players:earl-campbell:TEN:1970s'], label: 'Earl Campbell (1970s TEN)', checks: [ge('trucking', 97)], review: 'Trucking is mostly mass (the brief\'s body-type split) plus workload and goal-line scoring. Campbell was 232 lb; the 250–265 lb backs (Kinnebrew, Okoye, Jacobs, Bettis, Henry) rank above him. His legend is the violence of his running, which no stat records. I\'d accept 90+.' },
  { ids: ['players:derrick-henry:TEN:2020s'], label: 'Derrick Henry (2020s TEN)', checks: [ge('trucking', 97)] },
  { ids: ['players:jerome-bettis:PIT:1990s'], label: 'Jerome Bettis (1990s PIT)', checks: [ge('trucking', 95), lt('speed', 85)], review: 'Near miss (Trucking 94, want 95; Speed passes).' },
  { ids: ['players:walter-payton:CHI:1970s', 'players:walter-payton:CHI:1980s'], label: 'Walter Payton (CHI)', checks: [ge('stiffArm', 95), ge('breakTackle', 95)], review: 'Stiff Arm has no statistical trace: the formula uses size, strength and production, and Payton (5\'10", 200 lb) lands in the 80s. His stiff arm is technique the data can\'t see. Break Tackle is within a point or two (94.5 for the 1970s). I\'d accept, or you can supply a technique input if you want one.' },
  { ids: ['players:eric-dickerson:LAR:1980s'], label: 'Eric Dickerson (1980s LAR)', checks: [ge('speed', 95)] },
  { ids: ['players:marshall-faulk:LAR:1990s', 'players:marshall-faulk:LAR:2000s'], label: 'Marshall Faulk (LAR)', checks: [top('catching', 5), top('routeRunning', 5)] },
  { ids: ['players:christian-mccaffrey:SF:2020s'], label: 'Christian McCaffrey (2020s SF)', checks: [top('catching', 5), top('routeRunning', 5)] },
  { ids: ['players:jerry-rice:SF:1980s', 'players:jerry-rice:SF:1990s'], label: 'Jerry Rice (SF)', checks: [ge('shortRoute', 99), ge('deepRoute', 99), ge('catching', 95), lt('speed', 92)], review: 'Rice\'s 1980s stint is Deep Route 99, Catching 99 and Short Route rank 4 (97). The 1990s stint covers ages 28–37: short routes rank 1 (99), but his deep game (about 14 yards per catch) ranks 13th behind deep specialists. I think 97+ deep for the 1990s stint over-rates it; the 1980s stint is the 99.' },
  { ids: ['players:randy-moss:NE:2000s'], label: 'Randy Moss (2000s NE)', checks: [ge('speed', 97), ge('spectacular', 99), ge('jumping', 99)], review: 'Moss\'s measured numbers are elite: 4.25 pro-day 40 and a 47" vertical. His MIN 1990s stint rates Speed 97, Jumping 99 and Spectacular Catch at the top. The anchor is the NE stint (ages 30–33), where the aging curve takes about 4 points: Speed 93, Jumping 96, Spectacular 98 (rank 4). I\'d move this anchor to the Vikings stint, or accept aging.' },
  { ids: ['players:calvin-johnson:DET:2010s'], label: 'Calvin Johnson (2010s DET)', checks: [ge('catchInTraffic', 99), { attr: 'heightIn', op: 'rank<=', value: 10 }, top('jumping', 10)] },
  { ids: ['players:tyreek-hill:MIA:2020s'], label: 'Tyreek Hill (2020s MIA)', checks: [ge('speed', 99), ge('acceleration', 99)], review: 'Tyreek\'s measured 4.29 (pro day, +0.05 correction), 1.50 10-yard split and 6.53 cone give Speed 96.5 and Acceleration 95 for the KC stint (ages 22–27); the MIA stint is at ages 28–31, so aging takes 2–3 points (94 / 92). On this scale 99 speed is reserved for about a 4.22 electronic 40, the fastest ever measured. Speed 99 at 30 needs GPS data we don\'t have. I\'d accept 95+ at KC and 93+ at MIA.' },
  { ids: ['players:larry-fitzgerald:ARI:2000s'], label: 'Larry Fitzgerald (2000s ARI)', checks: [ge('catchInTraffic', 97), lt('speed', 88)], review: 'Speed is his measured 4.48 combine 40 (91 on the absolute scale, where 4.50 = 90), not an estimate, so \'below 88\' contradicts the measurement. Catch in Traffic is 94.6: height, TDs per catch, volume and honors put Calvin Johnson, Rice and Owens above him. I\'d accept 93+ and drop the speed band.' },
  { ids: ['players:cris-carter:MIN:1990s'], label: 'Cris Carter (1990s MIN)', checks: [ge('catchInTraffic', 97), lt('speed', 88)] },
  { ids: ['players:wes-welker:NE:2000s', 'players:wes-welker:NE:2010s'], label: 'Wes Welker (NE)', checks: [ge('shortRoute', 97)], review: 'Near miss: the 2000s stint passes (97); the 2010s stint (2010–12, ages 29–31) is 95.' },
  { ids: ['players:antonio-brown:PIT:2010s'], label: 'Antonio Brown (2010s PIT)', checks: [ge('shortRoute', 97)], review: 'Near miss (96, want 97).' },
  { ids: ['players:tony-gonzalez:KC:2000s'], label: 'Tony Gonzalez (2000s KC)', checks: [ge('catching', 95), ge('shortRoute', 95)] },
  { ids: ['players:travis-kelce:KC:2010s', 'players:travis-kelce:KC:2020s'], label: 'Travis Kelce (KC)', checks: [ge('catching', 95), ge('shortRoute', 95)] },
  { ids: ['players:rob-gronkowski:NE:2010s'], label: 'Rob Gronkowski (2010s NE)', checks: [ge('runBlock', 90), ge('catchInTraffic', 95)] },
  { ids: ['defense:lawrence-taylor:NYG:1980s'], label: 'Lawrence Taylor (1980s NYG)', checks: [ge('finesseMoves', 99), ge('pursuit', 99)] },
  { ids: ['defense:reggie-white:PHI:1980s', 'defense:reggie-white:GB:1990s'], label: 'Reggie White (PHI, GB)', checks: [ge('powerMoves', 97)] },
  { ids: ['defense:bruce-smith:BUF:1990s'], label: 'Bruce Smith (1990s BUF)', checks: [ge('powerMoves', 97)] },
  { ids: ['defense:aaron-donald:LAR:2010s'], label: 'Aaron Donald (2010s LAR)', checks: [ge('blockShed', 99), top('finesseMoves', 3)] },
  { ids: ['defense:deacon-jones:LAR:1960s'], label: 'Deacon Jones (1960s LAR)', checks: [ge('finesseMoves', 97)] },
  { ids: ['defense:deion-sanders:DAL:1990s'], label: 'Deion Sanders (1990s DAL)', checks: [ge('manCov', 99), ge('speed', 99), lt('tackle', 70)], review: 'Man Coverage passes (rank 2 of 69 all-time corners). Speed: his 1989 combine 4.27 (+0.03 correction) is 97 at 22, but he was 28–32 in Dallas, and the corner aging curve takes 3.5 points, giving 94; his ATL 1980s stint is 97. Tackle: no tackle data exists before 1999, so a pre-1999 DB\'s tackling is body and experience (plus capped reputation), and Deion lands at 76. His poor-tackler reputation isn\'t in any dataset we can use. I\'d accept Speed 95+ on the young stint and treat Tackle as data-limited.' },
  { ids: ['defense:darrelle-revis:NYJ:2000s', 'defense:darrelle-revis:NYJ:2010s'], label: 'Darrelle Revis (NYJ)', checks: [ge('manCov', 97), ge('press', 97)], review: 'Revis rates 94–95 in Man Coverage and 92–93 in Press: the top ten of 69 all-time corners. Both NYJ stints include non-peak seasons (2007–08, 2012, 2015–16), and even with the best-three-seasons blend his honors density trails Woodson, Deion, Bailey and Gilmore. I think 97+ fits his 2009–11 peak, not his stints as a whole. I\'d accept 93+.' },
  { ids: ['defense:sauce-gardner:NYJ:2020s'], label: 'Sauce Gardner (2020s NYJ)', checks: [ge('manCov', 90)] },
  { ids: ['defense:patrick-surtain-ii:DEN:2020s'], label: 'Patrick Surtain II (2020s DEN)', checks: [ge('manCov', 90)] },
  { ids: ['defense:mel-blount:PIT:1970s'], label: 'Mel Blount (1970s PIT)', checks: [ge('press', 97)], review: 'Near miss (Press 96, want 97). Press has no stat trace; it\'s honors, strength and length.' },
  { ids: ['defense:ed-reed:BAL:2000s'], label: 'Ed Reed (2000s BAL)', checks: [ge('ballSkills', 99), ge('zoneCov', 99)] },
  { ids: ['defense:ray-lewis:BAL:2000s'], label: 'Ray Lewis (2000s BAL)', checks: [ge('tackle', 95), ge('pursuit', 95), ge('playRec', 95)] },
  { ids: ['defense:dick-butkus:CHI:1960s'], label: 'Dick Butkus (1960s CHI)', checks: [ge('tackle', 95), ge('pursuit', 95), ge('playRec', 95), ge('hitPower', 99)], review: 'Near miss (Pursuit 94, want 95); Tackle, Play Recognition and Hit Power pass. No tackle data exists for his era.' },
  { ids: ['defense:mike-singletary:CHI:1980s'], label: 'Mike Singletary (1980s CHI)', checks: [ge('tackle', 95), ge('pursuit', 95), ge('playRec', 95)] },
  { ids: ['defense:ronnie-lott:SF:1980s'], label: 'Ronnie Lott (1980s SF)', checks: [ge('hitPower', 97)], review: 'Hit Power reads mass, forced fumbles (not tracked before ~1990) and honors. Lott was 203 lb, so he lands mid-90s, not 97. Near miss.' },
];
