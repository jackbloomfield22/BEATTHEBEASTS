// Manual alias tables for matching legacy names to nflverse names.
//
// Every entry says why it exists. Keep these small: the automatic passes
// (exact normalized name, then nickname-folded first name + last name, both
// restricted to the franchise's rosters in the stint's decade) handle almost
// everything; these cover the rest.

/**
 * First-name nickname groups. The first element is the canonical form. Used
 * only in the looser pass, and only among people who were on the right
 * franchise in the right decade, so a fold can't jump to a stranger.
 */
export const NICKNAME_GROUPS: readonly (readonly string[])[] = [
  ['jim', 'james', 'jimmy', 'jimbo', 'jimmie'],
  ['bob', 'robert', 'bobby', 'rob', 'robby', 'bobbie'],
  ['bill', 'william', 'billy', 'will', 'willie', 'willy'],
  ['mike', 'michael', 'mikey'],
  ['dick', 'richard', 'rich', 'rick', 'ricky', 'richie'],
  ['tom', 'thomas', 'tommy'],
  ['joe', 'joseph', 'joey'],
  ['dave', 'david', 'davey'],
  ['dan', 'daniel', 'danny'],
  ['don', 'donald', 'donnie', 'donny'],
  ['ed', 'edward', 'eddie', 'eddy', 'ted', 'teddy'],
  ['chuck', 'charles', 'charlie', 'charley', 'chas'],
  ['tony', 'anthony'],
  ['steve', 'steven', 'stephen', 'stevie'],
  ['ken', 'kenneth', 'kenny'],
  ['ron', 'ronald', 'ronnie'],
  ['larry', 'lawrence'],
  ['jerry', 'gerald', 'jerome'],
  ['matt', 'matthew'],
  ['chris', 'christopher', 'cris', 'kris'],
  ['nick', 'nicholas'],
  ['greg', 'gregory'],
  ['jeff', 'jeffrey', 'jeffery'],
  ['tim', 'timothy', 'timmy'],
  ['andy', 'andrew', 'drew'],
  ['sam', 'samuel', 'sammy'],
  ['ben', 'benjamin', 'benny'],
  ['pat', 'patrick'],
  ['fred', 'frederick', 'freddie', 'freddy'],
  ['al', 'albert', 'alan', 'allen', 'alvin'],
  ['herb', 'herbert'],
  ['walt', 'walter'],
  ['gene', 'eugene'],
  ['hank', 'henry'],
  ['jack', 'john', 'johnny', 'jon'],
  ['frank', 'francis', 'frankie'],
  ['doug', 'douglas'],
  ['gary', 'garry'],
  ['lou', 'louis'],
  ['ray', 'raymond'],
  ['vince', 'vincent'],
  ['zach', 'zachary', 'zack'],
  ['josh', 'joshua'],
  ['jake', 'jacob'],
  ['nate', 'nathan', 'nathaniel'],
  ['alex', 'alexander'],
  ['cam', 'cameron'],
  ['ollie', 'oliver'],
  ['mo', 'maurice'],
  ['reggie', 'reginald'],
  ['stan', 'stanley'],
  ['phil', 'phillip', 'philip'],
  ['leo', 'leonard', 'len', 'lenny'],
  ['russ', 'russell'],
  ['art', 'arthur', 'artie'],
  ['mel', 'melvin'],
  ['wally', 'wallace'],
];

/**
 * Legacy name → nflverse roster names to try, for people the automatic passes
 * miss (nicknames that are not first-name variants, spelling differences).
 * Applied only against the stint's franchise and decade.
 */
export const NAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Changed his name in 1996 (as Abdul-Karim al-Jabbar in nflverse).
  'Karim Abdul-Jabbar': ['Abdul-Karim al-Jabbar'],
  // Became Domanick Williams in 2005; nflverse uses the later surname.
  'Domanick Davis': ['Domanick Williams'],
  // Nicknames that nflverse does not use.
  'Hollywood Brown': ['Marquise Brown'],
  'Beanie Wells': ['Chris Wells'],
  'Rocket Ismail': ['Raghib Ismail'],
  'Ed Jones': ['Too Tall Jones'],
  'Jim Butler': ['Cannonball Butler'],
  // LAR 1980s WR is Willie "Flipper" Anderson (the OT Willie Anderson is a different person).
  'Willie Anderson': ['Flipper Anderson'],
  // Bobby Moore took the name Ahmad Rashad in 1973.
  'Bobby Moore': ['Ahmad Rashad'],
  // Legacy spellings that differ from nflverse (legacy typo or variant spelling).
  'Earnest Wilford': ['Ernest Wilford'],
  'Sammy Smith': ['Sammie Smith'],
  'Duke Ferguson': ['Duke Fergerson'],
  'Isaiah Pacheco': ['Isiah Pacheco'],
  'Eric Pegram': ['Erric Pegram'],
  'Tyrone Drakeford': ['Tyronne Drakeford'],
  // DEN 2020s OL key list: Garett Bolles (legacy has "Garett Bolton").
  'Garett Bolton': ['Garett Bolles'],
};

/**
 * Key-list tokens in OL_UNITS that are not a person (unit nicknames). They
 * get an `unmatched:` person id with a `not-a-person` flag.
 */
export const NOT_A_PERSON: ReadonlySet<string> = new Set(['The Hogs']);
