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
  { ids: ['players:dan-marino:MIA:1980s'], label: 'Dan Marino (1980s MIA)', checks: [ge('release', 99), ge('throwPower', 95), bottom10('scramble')] },
  { ids: ['players:peyton-manning:IND:2000s'], label: 'Peyton Manning (2000s IND)', checks: [ge('awareness', 97), ge('decision', 97), bottom10('scramble')] },
  { ids: ['players:tom-brady:NE:2010s'], label: 'Tom Brady (2010s NE)', checks: [ge('decision', 97), ge('shortAcc', 95), ge('midAcc', 95), bottom10('speed')] },
  { ids: ['players:patrick-mahomes:KC:2010s', 'players:patrick-mahomes:KC:2020s'], label: 'Patrick Mahomes (KC)', checks: [ge('throwOnRun', 97), ge('throwPower', 95)] },
  { ids: ['players:brett-favre:GB:1990s'], label: 'Brett Favre (1990s GB)', checks: [ge('throwPower', 97), lt('decision', 90)] },
  { ids: ['players:michael-vick:ATL:2000s'], label: 'Michael Vick (2000s ATL)', checks: [ge('speed', 97), lt('shortAcc', 85), lt('midAcc', 85)] },
  { ids: ['players:lamar-jackson:BAL:2010s', 'players:lamar-jackson:BAL:2020s'], label: 'Lamar Jackson (BAL)', checks: [ge('speed', 97)] },
  { ids: ['players:barry-sanders:DET:1990s'], label: 'Barry Sanders (DET)', checks: [ge('elusiveness', 99), ge('agility', 99), lt('trucking', 80)] },
  { ids: ['players:earl-campbell:TEN:1970s'], label: 'Earl Campbell (1970s TEN)', checks: [ge('trucking', 97)] },
  { ids: ['players:derrick-henry:TEN:2020s'], label: 'Derrick Henry (2020s TEN)', checks: [ge('trucking', 97)] },
  { ids: ['players:jerome-bettis:PIT:1990s'], label: 'Jerome Bettis (1990s PIT)', checks: [ge('trucking', 95), lt('speed', 85)] },
  { ids: ['players:walter-payton:CHI:1970s', 'players:walter-payton:CHI:1980s'], label: 'Walter Payton (CHI)', checks: [ge('stiffArm', 95), ge('breakTackle', 95)] },
  { ids: ['players:eric-dickerson:LAR:1980s'], label: 'Eric Dickerson (1980s LAR)', checks: [ge('speed', 95)] },
  { ids: ['players:marshall-faulk:LAR:1990s', 'players:marshall-faulk:LAR:2000s'], label: 'Marshall Faulk (LAR)', checks: [top('catching', 5), top('routeRunning', 5)] },
  { ids: ['players:christian-mccaffrey:SF:2020s'], label: 'Christian McCaffrey (2020s SF)', checks: [top('catching', 5), top('routeRunning', 5)] },
  { ids: ['players:jerry-rice:SF:1980s', 'players:jerry-rice:SF:1990s'], label: 'Jerry Rice (SF)', checks: [ge('shortRoute', 99), ge('deepRoute', 99), ge('catching', 95), lt('speed', 92)] },
  { ids: ['players:randy-moss:NE:2000s'], label: 'Randy Moss (2000s NE)', checks: [ge('speed', 97), ge('spectacular', 99), ge('jumping', 99)] },
  { ids: ['players:calvin-johnson:DET:2010s'], label: 'Calvin Johnson (2010s DET)', checks: [ge('catchInTraffic', 99), { attr: 'heightIn', op: 'rank<=', value: 10 }, top('jumping', 10)] },
  { ids: ['players:tyreek-hill:MIA:2020s'], label: 'Tyreek Hill (2020s MIA)', checks: [ge('speed', 99), ge('acceleration', 99)] },
  { ids: ['players:larry-fitzgerald:ARI:2000s'], label: 'Larry Fitzgerald (2000s ARI)', checks: [ge('catchInTraffic', 97), lt('speed', 88)] },
  { ids: ['players:cris-carter:MIN:1990s'], label: 'Cris Carter (1990s MIN)', checks: [ge('catchInTraffic', 97), lt('speed', 88)] },
  { ids: ['players:wes-welker:NE:2000s', 'players:wes-welker:NE:2010s'], label: 'Wes Welker (NE)', checks: [ge('shortRoute', 97)] },
  { ids: ['players:antonio-brown:PIT:2010s'], label: 'Antonio Brown (2010s PIT)', checks: [ge('shortRoute', 97)] },
  { ids: ['players:tony-gonzalez:KC:2000s'], label: 'Tony Gonzalez (2000s KC)', checks: [ge('catching', 95), ge('shortRoute', 95)] },
  { ids: ['players:travis-kelce:KC:2010s', 'players:travis-kelce:KC:2020s'], label: 'Travis Kelce (KC)', checks: [ge('catching', 95), ge('shortRoute', 95)] },
  { ids: ['players:rob-gronkowski:NE:2010s'], label: 'Rob Gronkowski (2010s NE)', checks: [ge('runBlock', 90), ge('catchInTraffic', 95)] },
  { ids: ['defense:lawrence-taylor:NYG:1980s'], label: 'Lawrence Taylor (1980s NYG)', checks: [ge('finesseMoves', 99), ge('pursuit', 99)] },
  { ids: ['defense:reggie-white:PHI:1980s', 'defense:reggie-white:GB:1990s'], label: 'Reggie White (PHI, GB)', checks: [ge('powerMoves', 97)] },
  { ids: ['defense:bruce-smith:BUF:1990s'], label: 'Bruce Smith (1990s BUF)', checks: [ge('powerMoves', 97)] },
  { ids: ['defense:aaron-donald:LAR:2010s'], label: 'Aaron Donald (2010s LAR)', checks: [ge('blockShed', 99), top('finesseMoves', 3)] },
  { ids: ['defense:deacon-jones:LAR:1960s'], label: 'Deacon Jones (1960s LAR)', checks: [ge('finesseMoves', 97)] },
  { ids: ['defense:deion-sanders:DAL:1990s'], label: 'Deion Sanders (1990s DAL)', checks: [ge('manCov', 99), ge('speed', 99), lt('tackle', 70)] },
  { ids: ['defense:darrelle-revis:NYJ:2000s', 'defense:darrelle-revis:NYJ:2010s'], label: 'Darrelle Revis (NYJ)', checks: [ge('manCov', 97), ge('press', 97)] },
  { ids: ['defense:sauce-gardner:NYJ:2020s'], label: 'Sauce Gardner (2020s NYJ)', checks: [ge('manCov', 90)] },
  { ids: ['defense:patrick-surtain-ii:DEN:2020s'], label: 'Patrick Surtain II (2020s DEN)', checks: [ge('manCov', 90)] },
  { ids: ['defense:mel-blount:PIT:1970s'], label: 'Mel Blount (1970s PIT)', checks: [ge('press', 97)] },
  { ids: ['defense:ed-reed:BAL:2000s'], label: 'Ed Reed (2000s BAL)', checks: [ge('ballSkills', 99), ge('zoneCov', 99)] },
  { ids: ['defense:ray-lewis:BAL:2000s'], label: 'Ray Lewis (2000s BAL)', checks: [ge('tackle', 95), ge('pursuit', 95), ge('playRec', 95)] },
  { ids: ['defense:dick-butkus:CHI:1960s'], label: 'Dick Butkus (1960s CHI)', checks: [ge('tackle', 95), ge('pursuit', 95), ge('playRec', 95), ge('hitPower', 99)] },
  { ids: ['defense:mike-singletary:CHI:1980s'], label: 'Mike Singletary (1980s CHI)', checks: [ge('tackle', 95), ge('pursuit', 95), ge('playRec', 95)] },
  { ids: ['defense:ronnie-lott:SF:1980s'], label: 'Ronnie Lott (1980s SF)', checks: [ge('hitPower', 97)] },
];
