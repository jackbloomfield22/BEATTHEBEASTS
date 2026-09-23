// Curated arm-strength grades for QBs (mostly pre-2006, where no air-yards data
// exists), read by tools/augment/arm.ts → data/augment/arm_strength.json.
//
// Rules:
// - Only QBs whose arm is specifically described in a citable source.
//   Anyone without one is left out; there are no knowledge-only grades here.
// - `note` is a verbatim phrase (≤ 20 words). arm.ts checks it against the
//   cached source: Wikipedia article prose (kind 'wikipedia'), the headline and
//   URL in a Wikipedia article's reference list (kind 'wikipedia-ref', a
//   newspaper/magazine piece cited by that article), or the player's Pro
//   Football Hall of Fame page (kind 'pfhof').
// - The grade is our estimate from the cited description plus the player's
//   general reputation (conf 'estimated'):
//     cannon  = one of the strongest arms of his era; the source calls the arm
//               powerful / among the strongest, or measures it
//     strong  = the source describes a strong, powerful or rifle arm
//     average = the source calls the arm ordinary, unexceptional or doubted,
//               without saying it was a real weakness
//     weak    = the source says he lacked arm strength
// - `entryIds` narrows the grade to some of the player's stints when the source
//   is about part of his career (default: all his QB entries); `scope` says why.
// - `evidence` says whether the sources describe his arm as a pro, only before
//   the pros (draft reports, college, high school), or only as a comparison
//   benchmark for another QB; the latter two are weaker evidence.

export type ArmGrade = 'cannon' | 'strong' | 'average' | 'weak';

export type ArmSourceDef =
  | {
      /** A phrase in the Wikipedia article's prose. */
      readonly kind: 'wikipedia';
      /** Exact Wikipedia title (disambiguated where needed). */
      readonly page: string;
      readonly note: string;
    }
  | {
      /** A newspaper/magazine article cited in a Wikipedia article's references; note is its headline. */
      readonly kind: 'wikipedia-ref';
      /** Wikipedia article whose references cite it. */
      readonly page: string;
      readonly note: string;
      /** Publication, as the reference gives it. */
      readonly title: string;
      /** Article URL, as the reference gives it. */
      readonly url: string;
    }
  | {
      /** A phrase on the player's Pro Football Hall of Fame page (bio or enshrinement speech). */
      readonly kind: 'pfhof';
      readonly url: string;
      readonly title: string;
      readonly note: string;
    };

/**
 * What the sources describe: his arm as a pro (NFL, or USFL/CFL for a few),
 * only before the pros (draft reports, college, high school), or only as the
 * benchmark in a comparison with another QB. Weaker evidence in that order.
 */
export type ArmEvidence = 'pro' | 'pre-pro' | 'comparison';

export interface ArmDef {
  /** Legacy PLAYERS name (p === 'QB'). */
  readonly name: string;
  readonly evidence: ArmEvidence;
  readonly grade: ArmGrade;
  /** One line: why this grade. */
  readonly basis: string;
  readonly sources: readonly ArmSourceDef[];
  readonly entryIds?: readonly string[];
  readonly scope?: string;
}

const w = (page: string, note: string): ArmSourceDef => ({ kind: 'wikipedia', page, note });

export const ARM_SOURCES: readonly ArmDef[] = [
  // --- cannon -------------------------------------------------------------
  {
    name: 'Terry Bradshaw',
    evidence: 'pro',
    grade: 'cannon',
    basis: 'Described as having one of the most powerful arms in NFL history; his deep threat loosened defenses.',
    sources: [
      w('Terry Bradshaw', 'having one of the most powerful arms in NFL history'),
      {
        kind: 'pfhof',
        url: 'https://www.profootballhof.com/players/terry-bradshaw/',
        title: 'Pro Football Hall of Fame: Terry Bradshaw (bio)',
        note: 'had a powerful throwing arm and called his own plays throughout his pro career',
      },
    ],
  },
  {
    name: 'Dan Marino',
    evidence: 'pro',
    grade: 'cannon',
    basis: 'Best remembered for a quick release and powerful arm; called "rifle-armed" in 1984 AP player-of-the-year coverage.',
    sources: [
      w('Dan Marino', 'Best remembered for his quick release and powerful arm'),
      {
        kind: 'wikipedia-ref',
        page: 'Dan Fouts',
        note: "Dolphins' rifle-armed Dan Marino is named AP player of the year",
        title: 'Escondido Times-Advocate (Dec 19, 1984)',
        url: 'https://www.newspapers.com/clip/95586614/marino-three-records-19-dec-1984/',
      },
    ],
  },
  {
    name: 'John Elway',
    evidence: 'comparison',
    grade: 'cannon',
    basis: 'Used as the benchmark for arm strength by analysts comparing later QBs (Collinsworth on Nate Davis; comparisons for Josh Allen).',
    sources: [
      w('Nate Davis (quarterback)', "compared Davis' arm strength to that of John Elway"),
      w('Josh Allen', 'arm strength, speed, running ability, and overall athleticism, drawing comparisons to John Elway'),
    ],
  },
  {
    name: 'Daryle Lamonica',
    evidence: 'pro',
    grade: 'cannon',
    basis: '"The Mad Bomber": a strong-armed deep passer who powered the Raiders\' vertical game.',
    sources: [
      w('1967 Oakland Raiders season', "strong-armed quarterback Daryle Lamonica greatly energized the Raiders' vertical passing game"),
      w('Daryle Lamonica', 'Nicknamed "The Mad Bomber" due to almost always throwing long passes'),
    ],
  },
  {
    name: 'Joe Flacco',
    evidence: 'pro',
    grade: 'cannon',
    basis: 'Known at his peak for one of the strongest arms in the NFL (Jaworski: the strongest).',
    sources: [
      w('Joe Flacco', 'Flacco was also known for having one of the strongest arms in the NFL'),
      {
        kind: 'wikipedia-ref',
        page: 'Joe Flacco',
        note: 'Ron Jaworksi: Joe Flacco has strongest arm in NFL',
        title: 'NFL.com',
        url: 'https://www.nfl.com/news/ron-jaworksi-joe-flacco-has-strongest-arm-in-nfl-09000d5d82a4cb00',
      },
    ],
  },
  {
    name: 'Josh Allen',
    evidence: 'pro',
    grade: 'cannon',
    basis: 'Measured ball velocity: 74.3 mph release speed, the fastest Sport Science recorded; "rocket arm".',
    sources: [
      w('Josh Allen', 'averaged 74.3 mph, the fastest launch velocity Sport Science ever recorded on their show'),
      {
        kind: 'wikipedia-ref',
        page: 'Josh Allen',
        note: 'Deep dive into how Bills QB Josh Allen reined in rocket arm, fixing early accuracy issues',
        title: 'Sports Illustrated',
        url: 'https://www.si.com/nfl/bills/news/how-bills-qb-josh-allen-reined-in-his-rocket-arm-and-fixed-early-accuracy-issues',
      },
    ],
  },
  {
    name: 'Patrick Mahomes',
    evidence: 'pro',
    grade: 'cannon',
    basis: 'Arm strength is named as a defining trait (ex-pitcher); widely considered elite.',
    sources: [
      w('Patrick Mahomes', 'due to his elusiveness in the pocket, arm strength, running ability, and athleticism'),
      w('Patrick Mahomes', 'Mahomes credits his years playing baseball with developing his arm strength'),
    ],
  },
  {
    name: 'Jay Cutler',
    evidence: 'pre-pro',
    grade: 'cannon',
    basis: 'Scouts rated his arm above the 2006 draft\'s top QBs (Vince Young, Matt Leinart).',
    sources: [w('Jay Cutler', 'some scouts believed he had better arm strength than Young and Leinart')],
  },
  // --- strong -------------------------------------------------------------
  {
    name: 'Brett Favre',
    evidence: 'comparison',
    grade: 'strong',
    basis: 'Arm noted from youth; cited with Elway and Cunningham as a comparison for Josh Allen\'s arm and size. Wikipedia has no playing-style text on it, so graded strong, not cannon.',
    sources: [
      w('Brett Favre', 'Irvin Favre said he knew his son had a great arm'),
      w('Josh Allen', 'drawing comparisons to John Elway, Randall Cunningham, Brett Favre, and Cam Newton'),
    ],
  },
  {
    name: 'Michael Vick',
    evidence: 'comparison',
    grade: 'strong',
    basis: 'The benchmark for a running QB with a strong arm (Michael Bishop comparisons); no direct Wikipedia description of his arm.',
    sources: [w('Michael Bishop (gridiron football)', 'combined with his strong arm, comparisons between him and NFL quarterback Michael Vick were made')],
  },
  {
    name: 'Randall Cunningham',
    evidence: 'comparison',
    grade: 'strong',
    basis: 'Cited with Elway and Favre as a comparison for Josh Allen\'s size, arm strength and running; no direct Wikipedia description of his arm.',
    sources: [w('Josh Allen', 'size, arm strength, speed, running ability, and overall athleticism, drawing comparisons to John Elway, Randall Cunningham')],
  },
  {
    name: 'Drew Bledsoe',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Subject of the 1999 biography "Drew Bledsoe: Patriot Rifle" (Mike Shalin).',
    sources: [w('Mike Shalin', 'Drew Bledsoe: Patriot Rifle (1999)')],
  },
  {
    name: 'Warren Moon',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Recruited out of junior college as "the rifle-armed Moon".',
    sources: [w('Warren Moon', 'was eager to sign the rifle-armed Moon')],
  },
  {
    name: 'Jim Kelly',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Hall of Fame bio: a strong-armed passer.',
    sources: [
      {
        kind: 'pfhof',
        url: 'https://www.profootballhof.com/players/jim-kelly/',
        title: 'Pro Football Hall of Fame: Jim Kelly (bio)',
        note: 'A strong-armed passer with a "linebacker\'s mentality,"',
      },
    ],
  },
  {
    name: 'Troy Aikman',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Hall of Fame presenter\'s speech: "unbelievable arm strength" with a great release and accuracy.',
    sources: [
      {
        kind: 'pfhof',
        url: 'https://www.profootballhof.com/players/troy-aikman/',
        title: 'Pro Football Hall of Fame: Troy Aikman (presenter\'s enshrinement speech)',
        note: 'Few have had the great release, the unbelievable arm strength, and incredible accuracy of Troy Aikman.',
      },
    ],
  },
  {
    name: 'Kerry Collins',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Signed by the 2004 Raiders as "the strong-armed Collins" for a vertical offense.',
    sources: [w('Rich Gannon', 'the strong-armed Collins, whom skeptics thought was a better fit in new head coach Norv Turner\'s vertical offense')],
  },
  {
    name: 'Vinny Testaverde',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Known for his strong arm (and interceptions).',
    sources: [
      w('Vinny Testaverde', 'Testaverde was known for his strong arm and high volume'),
      w('Vinny Testaverde', 'Testaverde was commended for his arm strength'),
    ],
  },
  {
    name: 'Boomer Esiason',
    evidence: 'pro',
    grade: 'strong',
    basis: 'A 6\'5" passer "with a powerful arm" running the late-1980s Bengals offense.',
    sources: [w('Boomer Esiason', 'with a powerful arm, Esiason was the signal caller on one of the most potent offenses of the late 1980s')],
  },
  {
    name: 'Jim Plunkett',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Excellent arm strength noted coming out of Stanford.',
    sources: [w('Jim Plunkett', 'His excellent arm strength and precision made him attractive to pro teams')],
  },
  {
    name: 'Roman Gabriel',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Known for his arm strength.',
    sources: [w('Roman Gabriel', 'Known for his arm strength')],
  },
  {
    name: 'Doug Williams',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Joe Gibbs\'s pre-draft report: "a big-time arm"; the first Buccaneers QB able to throw long downfield.',
    sources: [
      w('Doug Williams (quarterback)', 'a big-time arm with perfect passing mechanics'),
      w('Doug Williams (quarterback)', 'He was the first quarterback in Buccaneer history capable of throwing long passes downfield.'),
    ],
  },
  {
    name: 'James Harris',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Described as "the strong-armed Harris" with the mid-1970s Rams.',
    sources: [w('James "Shack" Harris', 'The strong-armed Harris helped lead the team to another division title in 1975.')],
  },
  {
    name: 'Bert Jones',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Nicknamed "the Ruston Rifle" (from high school on).',
    sources: [w('Bert Jones', 'where he was given the nickname "the Ruston Rifle"')],
  },
  {
    name: 'Ron Jaworski',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Nicknamed "Rifle Ron" / "the Polish Rifle" (from college on).',
    sources: [w('Ron Jaworski', 'where he was nicknamed "Rifle Ron" and the "Polish Rifle"')],
  },
  {
    name: 'Bobby Hebert',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Nicknamed "the Cajun Cannon".',
    sources: [w('Bobby Hebert', 'Nicknamed "the Cajun Cannon"')],
  },
  {
    name: 'Dieter Brock',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Nicknamed "The Birmingham Rifle" (CFL career before his 1985 Rams season).',
    sources: [w('Dieter Brock', 'Nicknamed "The Birmingham Rifle"')],
  },
  {
    name: 'Quincy Carter',
    evidence: 'pro',
    grade: 'strong',
    basis: 'The 2004 Jets signed him hoping his strong arm could help.',
    sources: [w('Quincy Carter', "were hoping Carter's strong arm could resurrect their season")],
  },
  {
    name: 'Steve Pelluer',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Showed a strong arm and mobility as a starter.',
    sources: [w('Steve Pelluer', 'showing a strong arm and great mobility')],
  },
  {
    name: 'Dave Wilson',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Reputation for a strong arm and quick release (pre-college).',
    sources: [w('Dave Wilson (American football)', 'He had a reputation for a strong arm and quick release')],
  },
  {
    name: 'Scott Zolak',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Pre-draft reports: size and arm strength great for the NFL, accuracy a concern.',
    sources: [w('Scott Zolak', 'Scouting reports noted that his size and arm strength were great for the NFL')],
  },
  {
    name: 'Erik Wilhelm',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'A "strong-armed" college passer (Oregon State).',
    sources: [w('Erik Wilhelm', 'the strong-armed Wilhelm')],
  },
  {
    name: 'Mark Vlasic',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'College coach Hayden Fry: a stronger arm than Heisman runner-up Chuck Long.',
    sources: [w('Mark Vlasic', "He's got a stronger arm than Long")],
  },
  {
    name: 'Billy Joe Tolliver',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'College coach: threw harder and with more velocity than anyone he had seen.',
    sources: [w('Billy Joe Tolliver', "He throws the ball harder, and with more velocity, than anyone I've ever seen.")],
  },
  {
    name: 'Geno Smith',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Combine scouts highlighted his strong arm.',
    sources: [w('Geno Smith', 'scouts who highlighted his athleticism and strong arm')],
  },
  {
    name: 'Colin Kaepernick',
    evidence: 'pro',
    grade: 'strong',
    basis: 'Preferred over Alex Smith in 2012 for scrambling and arm strength.',
    sources: [w('Colin Kaepernick', 'Kaepernick was considered more dynamic with his scrambling ability and arm strength')],
  },
  {
    name: 'Josh Freeman',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Pre-draft: "tremendous arm strength" and deep-ball touch.',
    sources: [w('Josh Freeman', 'He showed tremendous arm strength, an excellent touch on the deep balls')],
  },
  {
    name: 'Ryan Mallett',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Arm strength cited as his defining trait in college.',
    sources: [w('Ryan Mallett', 'citing his arm strength as a major determining factor')],
  },
  {
    name: 'Aaron Rodgers',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Pre-draft: a "strong-armed" prospect who could make all the throws.',
    sources: [w('Aaron Rodgers', 'combines arm strength, mechanics and delivery to make all the throws')],
  },
  {
    name: 'Matthew Stafford',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'Best Arm award at the 2005 Elite 11 camp (high school); widely regarded as a strong-armed pro.',
    sources: [w('Matthew Stafford', 'He also won the MVP and Best Arm awards at the 2005 EA Sports Elite 11 Quarterback Camp')],
  },
  {
    name: 'David Garrard',
    evidence: 'pre-pro',
    grade: 'strong',
    basis: 'High-school coaches called his arm one of the strongest they had seen (weak, early evidence).',
    sources: [w('David Garrard', 'Garrard possessed one of the strongest arms they had ever seen')],
  },
  // --- average ------------------------------------------------------------
  {
    name: 'Dan Fouts',
    evidence: 'pro',
    grade: 'average',
    basis: 'Arm strength described as unexceptional; accuracy and quick decisions made up for it (scouts also questioned it at the draft).',
    sources: [
      w('Dan Fouts', 'His accuracy and quick decision making compensated for his unexceptional arm strength.'),
      w('Dan Fouts', "NFL scouts questioned Fouts' durability, arm strength and athleticism"),
    ],
  },
  {
    name: 'Ken Stabler',
    evidence: 'pro',
    grade: 'average',
    basis: 'Lacked remarkable arm strength but threw the long ball well.',
    sources: [w('Ken Stabler', 'Although Stabler lacked remarkable arm strength, he was a master of the long pass')],
  },
  {
    name: 'Joe Montana',
    evidence: 'pre-pro',
    grade: 'average',
    basis: 'Scouting combine grade of 6 for arm strength (vs. 8 for the top prospect).',
    sources: [w('Joe Montana', 'Montana rated out as six-and-a-half overall with a six in arm strength')],
  },
  {
    name: 'Drew Brees',
    evidence: 'pre-pro',
    grade: 'average',
    basis: 'Fell to the second round partly over a perceived lack of arm strength.',
    sources: [
      w('Drew Brees', 'Due to questions over his height and arm strength, he was not selected until the second round'),
      w('Drew Brees', 'a perceived lack of arm strength'),
    ],
  },
  {
    name: 'Philip Rivers',
    evidence: 'pre-pro',
    grade: 'average',
    basis: 'Pre-draft concerns about a lack of arm strength and his side-arm motion.',
    sources: [w('Philip Rivers', 'questions about his lack of arm strength and his unorthodox side-arm throwing motion')],
  },
  {
    name: 'Mark Sanchez',
    evidence: 'pre-pro',
    grade: 'average',
    basis: 'Pre-draft consensus: arm strength "good enough".',
    sources: [w('Mark Sanchez', 'It was unanimously agreed upon that his arm strength was "good enough" to succeed in the league')],
  },
  {
    name: 'Cade McNown',
    evidence: 'pre-pro',
    grade: 'average',
    basis: 'After the 1999 combine, some scouts questioned the strength of his throwing arm.',
    sources: [w('Cade McNown', 'some scouts questioned the strength of his throwing arm')],
  },
  {
    name: 'Peyton Manning',
    evidence: 'pro',
    grade: 'average',
    entryIds: ['players:peyton-manning:DEN:2010s'],
    scope: 'Denver 2012–15 only, after the 2011 neck surgeries; no grade for the Indianapolis stints.',
    basis: 'Arm strength significantly diminished after neck surgery; ESPN later said he had "silenced the critics".',
    sources: [
      w('Peyton Manning', 'Manning was unable to complete his throwing motion, and his arm strength significantly diminished.'),
      w('Peyton Manning', 'Manning "has silenced the critics" about his arm strength'),
    ],
  },
  // --- weak ---------------------------------------------------------------
  {
    name: 'Chad Pennington',
    evidence: 'pro',
    grade: 'weak',
    basis: 'His lack of arm strength was often criticized.',
    sources: [w('Chad Pennington', 'Although his lack of arm strength was often criticized')],
  },
  {
    name: 'Pat Haden',
    evidence: 'pre-pro',
    grade: 'weak',
    basis: 'Dropped to the seventh round partly over a lack of height and arm strength.',
    sources: [w('Pat Haden', 'and arm strength, and he dropped to the seventh round of the 1975 NFL draft')],
  },
  {
    name: 'Kellen Moore',
    evidence: 'pre-pro',
    grade: 'weak',
    basis: 'Undrafted amid doubts about his size, arm strength and mobility.',
    sources: [w('Kellen Moore', 'as well as doubts about arm strength and mobility')],
  },
  {
    name: 'Rodney Peete',
    evidence: 'pre-pro',
    grade: 'weak',
    basis: 'Dropped to the sixth round, not considered to have the arm talent for the NFL.',
    sources: [w('Rodney Peete', 'he was not considered to have the size or the arm talent needed to succeed in the NFL')],
  },
  {
    name: 'Tyson Bagent',
    evidence: 'pre-pro',
    grade: 'weak',
    basis: 'Pre-draft analysis: arm strength inadequate for the NFL.',
    sources: [w('Tyson Bagent', 'felt his arm strength would be inadequate against professional defenses')],
  },
  {
    name: 'Matt Ryan',
    evidence: 'pro',
    grade: 'weak',
    entryIds: ['players:matt-ryan:IND:2020s'],
    scope: 'Indianapolis 2022 only (age 37, shoulder injury); no grade for the Atlanta stints.',
    basis: 'Decreased arm strength and a shoulder injury reduced his passing yards in Indianapolis.',
    sources: [w('Matt Ryan (American football)', "Ryan's decreased arm strength and shoulder injury")],
  },
];
