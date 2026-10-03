// Commentary (GDD §11.7): the caption bar's lines. Legacy's caption templates
// (legacy/beat-the-beasts.jsx captionFor, 8246) carried forward and expanded
// into a bank keyed by the event, the situation and the players' traits, with
// variety rules. Pure and deterministic: lines are chosen with a seeded
// stream (engine/rng), never Math.random, so a game's seed and its events
// give the same broadcast every time.
//
// Every slot has a fallback (legacy bug L8, "Intercepted by null!"): a name
// slot the sim can't fill reads "the quarterback", "the defense"; a line that
// needs a number, a spot or a clock is only eligible when it has one, and every
// event has at least one line that needs nothing.
//
// The variety rules: no line is said twice within VARIETY_WINDOW lines, nor
// within the last KIND_WINDOW lines of its own event (so a touchdown, a rarer
// event, doesn't come back to the same words a quarter later). When an event
// has said all of its eligible lines inside the windows, the one said longest
// ago comes back.
//
// Lines can require tags (all of them, from the context): situation tags
// ("thirdDown", "redZone", "takesLead") and trait tags scoped to the slot
// whose player has the trait ("receiver:contested-catch-king"; alternatives
// with "|": "runner:burner|track-speed"). A line with requirements weighs
// more, so the specific line usually wins over the generic one when it fits
// and the game still sounds different from drive to drive.

import { deriveStream, type Rng } from '@/engine/rng';

export type CallKind =
  // Your snaps
  | 'passTD'
  | 'rushTD'
  | 'pass'
  | 'bigPass'
  | 'run'
  | 'bigRun'
  | 'stuff'
  | 'scramble'
  | 'incomplete'
  | 'drop'
  | 'breakup'
  | 'batted'
  | 'throwAway'
  | 'catchOOB'
  | 'sack'
  | 'stripSack'
  | 'int'
  | 'pickSix'
  | 'fumble'
  | 'bigHit'
  | 'safety'
  | 'downs'
  | 'twoPointGood'
  | 'twoPointFailed'
  | 'kneel'
  | 'spike'
  // Kicks
  | 'fgGood'
  | 'fgMiss'
  | 'patGood'
  | 'patMiss'
  | 'punt'
  // The Beasts' possessions (the Meanwhile cut)
  | 'beastsTD'
  | 'beastsFG'
  | 'beastsPunt'
  | 'beastsTurnover'
  | 'beastsDowns'
  | 'beastsSafety'
  | 'beastsMissedFG'
  | 'beastsHalf'
  | 'beastsGame'
  // Before the snap
  | 'driveStart'
  | 'thirdLong'
  | 'thirdShort'
  | 'fourthDown'
  | 'goalToGo'
  | 'redZone'
  | 'twoMinute';

/** What a line can name. Name slots fall back to a generic phrase; the rest make a line ineligible when missing. */
export interface Slots {
  passer?: string | null;
  receiver?: string | null;
  runner?: string | null;
  defender?: string | null;
  tackler?: string | null;
  rusher?: string | null;
  hitter?: string | null;
  /** Yards gained (or the kick's or drive's distance), whole. */
  yards?: number | null;
  /** Yards lost on a sack, whole and positive. */
  loss?: number | null;
  toGo?: number | null;
  /** A spot as the broadcast says it ("the BST 32"). */
  spot?: string | null;
  plays?: number | null;
  /** Time of possession, "4:12". */
  top?: string | null;
  clock?: string | null;
  /** What the Contenders need ("a touchdown", "a field goal"). */
  need?: string | null;
  timeouts?: number | null;
  /** Points the Contenders trail by. */
  deficit?: number | null;
  net?: number | null;
}

type SlotName = keyof Slots;

/** Name slots and what they read as when the sim has no name (L8). */
export const FALLBACK: Readonly<Record<'passer' | 'receiver' | 'runner' | 'defender' | 'tackler' | 'rusher' | 'hitter', string>> = {
  passer: 'the quarterback',
  receiver: 'the receiver',
  runner: 'the ball carrier',
  defender: 'the defense',
  tackler: 'the defense',
  rusher: 'the rush',
  hitter: 'the defender',
};

export interface Line {
  id: string;
  kind: CallKind;
  text: string;
  /** Tags the context must carry (each may list alternatives with "|"). */
  need?: string[];
  /** Tags that rule it out. */
  not?: string[];
}

/** No line is said twice within this many lines (GDD §11.7's "no repeats within N plays"). */
export const VARIETY_WINDOW = 12;
/** Nor within this many of its own event's lines (fewer when the event has fewer lines to choose from). */
export const KIND_WINDOW = 4;

const L = (kind: CallKind, lines: ([string] | [string, string[]] | [string, string[], string[]])[]): Line[] => lines.map(([text, need, not], i) => ({ id: `${kind}.${i}`, kind, text, need, not }));

// Trait groups the lines read (ids from src/engine/ratings/traits).
const SPEED = 'burner|track-speed|deep-threat|home-run-threat|vertical-nightmare|seam-stretcher|lightning|long-strider';
const HANDS = 'contested-catch-king|jump-ball-king|skyscraper|big-body|basketball-body|mismatch';
const BREAKER = 'stiff-arm-king|tackle-breaker|battering-ram|freight-train|wrecking-ball|bruiser-te';
const SHIFTY = 'human-joystick|ankle-breaker|head-fake|spin-cycle|dancer|twitch|jump-cut|scatback|human-highlight|highlight-reel';
const BIGBACK = 'home-run-hitter|big-play-back|big-play|open-field-menace|home-run-threat';
const GOALLINE = 'goal-line-hammer|short-yardage-nightmare|battering-ram|freight-train|red-zone-threat|low-center';
const RUSH_EDGE = 'speed-rusher|edge-bender|blindside-assassin';
const RUSH_POWER = 'power-rusher|interior-wrecker|space-eater';
const SACKER = 'sack-artist|strip-sack|motor';
const HAWK = 'ballhawk|center-fielder|pick-six|gambler|zone-reader';
const COVER = 'pbu-machine|shutdown-corner|no-fly-zone|jam-artist|coverage-linebacker';
const HITTER = 'enforcer|bone-crusher|thumper|missile|tackling-machine';
const STOPPER = 'run-stuffer|space-eater|interior-wrecker|tackling-machine|every-down-backer|sideline-to-sideline';
const ARM = 'cannon|laser|gunslinger|deep-ball-artist|air-raid|bomb-squad';
const TOUCH = 'surgeon|maestro|metronome|efficiency-king|field-general';
const RISKY = 'riverboat-gambler|gunslinger|turnover-machine|backyard-ball';
const RUNQB = 'designed-runner|dual-threat|escape-artist|off-platform|run-pass-nightmare';
const STILL = 'statue|sack-magnet|stone-feet|happy-feet';
const ROUTES = 'route-technician|release-artist|chain-mover|safety-blanket|go-to-guy|alpha|sure-hands|glue-hands';

export const BANK: readonly Line[] = [
  ...L('passTD', [
    ['{passer} finds {receiver} for a {yards}-yard touchdown.'],
    ['{passer} to {receiver}. Touchdown, Contenders!'],
    ['Pitch and catch, {passer} to {receiver}, {yards} yards for six.'],
    ['{receiver} hauls it in, and the Contenders are in the end zone.'],
    ['{passer} lets it fly... {receiver} is behind everybody! Touchdown!', ['deep']],
    ['{receiver} makes the catch and outruns them all. {yards} yards, touchdown.', ['yac']],
    ['{passer} fires it in to {receiver} at the goal line. Touchdown.', ['goalLine']],
    ['{passer} to {receiver}... touchdown! The Contenders take the lead!', ['takesLead']],
    ['{receiver} with the touchdown, and this game is tied!', ['tiesIt']],
    ['{receiver} goes up over the top and takes it away. Touchdown!', [`receiver:${HANDS}`, 'contested']],
    ['Nobody runs with {receiver}. {yards} yards, touchdown.', [`receiver:${SPEED}`, 'deep']],
    ['{passer} threads it through the window. {receiver}, touchdown.', [`passer:${ARM}`]],
    ['Right on the hands. {passer} to {receiver}, and that’s six.', [`passer:${TOUCH}`]],
    ['{receiver} sets him up, breaks it off, and {passer} hits him. Touchdown.', [`receiver:${ROUTES}`]],
    ['{receiver} breaks a tackle and dives in! Touchdown.', ['brokenTackle']],
  ]),
  ...L('rushTD', [
    ['{runner} runs for a {yards}-yard touchdown.'],
    ['{runner} finds the crease... and he’s in! Touchdown.'],
    ['{runner} takes it in for six.'],
    ['{runner} punches it in!', ['goalLine']],
    ['{runner} lowers the shoulder and drives it in. Touchdown.', ['goalLine', `runner:${GOALLINE}`]],
    ['Daylight for {runner}! {yards} yards, and the Contenders score.', ['long']],
    ['{runner} breaks into the open... nobody’s catching him! Touchdown.', ['long']],
    ['That’s why you give {runner} the ball. {yards} yards, touchdown!', ['long', `runner:${BIGBACK}`]],
    ['Gone! {runner} turns on the jets. {yards} yards to the house.', ['long', `runner:${SPEED}`]],
    ['{runner} makes a man miss and he’s gone! Touchdown.', ['move:juke|move:spin']],
    ['{runner} goes right over the top of him and in! Touchdown.', ['move:hurdle']],
    ['{runner} shoves one man to the turf and walks in. Touchdown.', ['move:stiffArm|move:truck']],
    ['{runner} keeps it himself... touchdown!', ['qb']],
    ['{runner} and the Contenders take the lead on the ground!', ['takesLead']],
  ]),
  ...L('bigPass', [
    ['{passer} hits {receiver} in stride. Gain of {yards}.'],
    ['{passer} airs it out... caught by {receiver}! {yards} yards.', ['deep']],
    ['Big play! {receiver} for {yards}.'],
    ['Big play through the air for the Contenders!'],
    ['{passer} finds {receiver} downfield!'],
    ['{receiver} turns it upfield and picks up {yards}.', ['yac']],
    ['{receiver} catches it short and turns it into {yards}.', ['yac']],
    ['{receiver} wins the fight for it. {yards} yards.', ['contested']],
    ['{receiver} high-points it in traffic. {yards}-yard gain.', [`receiver:${HANDS}`, 'contested']],
    ['{receiver} runs away from the coverage. {yards} yards.', [`receiver:${SPEED}`]],
    ['Play action, and {passer} goes over the top to {receiver}. {yards} yards.', ['playAction']],
    ['The screen is set up beautifully. {receiver} for {yards}.', ['screen']],
    ['What a throw by {passer}. {receiver} for {yards}.', [`passer:${ARM}|${TOUCH}`]],
    ['{receiver} breaks a tackle and keeps going. {yards} yards.', ['brokenTackle']],
  ]),
  ...L('pass', [
    ['{passer} to {receiver}, gain of {yards}.'],
    ['{receiver} pulls it in for {yards}.'],
    ['Complete to {receiver}. {yards} yards.'],
    ['{receiver} makes the grab, and {tackler} brings him down.'],
    ['{receiver} moves the chains.', ['firstDown']],
    ['That’s a first down. {receiver} on the catch.', ['firstDown']],
    ['Big conversion on third down! {receiver} gets {yards}.', ['thirdDown', 'firstDown']],
    ['They go for it, and {receiver} gets it! First down.', ['fourthDown', 'firstDown']],
    ['{receiver} makes the catch, but he’s short of the sticks.', ['shortOfSticks']],
    ['{passer} checks it down to {receiver}.', ['checkdown']],
    ['Quick throw to {receiver}. {yards} yards.', ['quick']],
    ['{receiver} catches it and is dropped for a loss.', ['loss']],
    ['{receiver} finds the soft spot. {yards} yards.', [`receiver:${ROUTES}`]],
    ['{passer} on time and on target. {receiver} for {yards}.', [`passer:${TOUCH}`]],
    ['{receiver} goes up and gets it. {yards} yards.', [`receiver:${HANDS}`, 'contested']],
    ['{receiver} hangs on as {hitter} arrives.', ['contact']],
  ]),
  ...L('bigRun', [
    ['{runner} breaks into the second level! {yards} yards.'],
    ['{runner} bursts through the hole for {yards}.'],
    ['{runner} gets loose for {yards}.'],
    ['{runner} breaks loose!'],
    ['One cut and {runner} is gone. {yards} yards.', ['runner:burst|one-cut|patient-runner|lightning']],
    ['{runner} breaks a tackle and keeps going. {yards} yards.', ['brokenTackle']],
    ['{runner} makes a man miss in the hole. {yards} yards.', ['move:juke|move:spin']],
    ['{runner} hurdles a tackler! {yards}-yard gain.', ['move:hurdle']],
    ['{runner} leaves a defender grabbing air. {yards} yards.', [`runner:${SHIFTY}`]],
    ['{runner} runs through the arm tackle and picks up {yards}.', [`runner:${BREAKER}`, 'brokenTackle']],
    ['{runner} turns the corner and outruns everybody. {yards} yards.', [`runner:${SPEED}`]],
    ['{runner} keeps it and takes off! {yards} yards.', ['qb']],
  ]),
  ...L('run', [
    ['{runner} picks up {yards}.'],
    ['{runner} carries for {yards}.'],
    ['{runner} finds a little room.'],
    ['{runner} for {yards}, {tackler} makes the stop.'],
    ['{runner} moves the chains.', ['firstDown']],
    ['{runner} picks up the first down.', ['firstDown']],
    ['They go for it, and {runner} gets it! First down.', ['fourthDown', 'firstDown']],
    ['{runner} is stopped short of the sticks.', ['shortOfSticks']],
    ['{runner} falls forward for {yards}.', [`runner:${BREAKER}|${GOALLINE}`]],
    ['{runner} shakes one tackler and gets {yards}.', ['move:juke|move:spin']],
    ['{runner} makes the first man miss and picks up {yards}.', [`runner:${SHIFTY}`]],
    ['{runner} runs through contact for {yards}.', ['brokenTackle']],
    ['{runner} keeps it for {yards}.', ['qb']],
  ]),
  ...L('stuff', [
    ['Nowhere to go for {runner}. {tackler} with the stop.'],
    ['Stuffed! {tackler} meets {runner} at the line.'],
    ['{tackler} blows it up in the backfield.', ['loss']],
    ['{tackler} meets {runner} in the backfield. Loss on the play.', ['loss']],
    ['{tackler} eats up the run. No gain.', [`tackler:${STOPPER}`]],
    ['Stopped short on fourth down!', ['fourthDown']],
  ]),
  ...L('scramble', [
    ['{runner} escapes the pocket and takes off for {yards}.'],
    ['{runner} tucks it and runs. {yards} yards.'],
    ['{runner} pulls it down and runs.'],
    ['Nothing open, so {runner} takes what’s there. {yards} yards.'],
    ['{runner} slips the rush and picks up the first down!', ['firstDown']],
    ['{runner} buys time and turns it into {yards}.', [`runner:${RUNQB}`]],
  ]),
  ...L('incomplete', [
    ['Incomplete, intended for {receiver}.'],
    ['{passer} looking for {receiver}. Incomplete.'],
    ['The pass falls incomplete.'],
    ['Overthrown. {receiver} couldn’t get there.', ['sail']],
    ['Short-hopped. {passer} misses {receiver}.', ['short']],
    ['{passer} throws under pressure. Incomplete.', ['pressure']],
    ['Off the mark on the run. Incomplete.', ['onRun']],
    ['Third down pass falls incomplete. That’ll bring up fourth.', ['thirdDown']],
  ]),
  ...L('drop', [
    ['Dropped! {receiver} lets one get away.'],
    ['{receiver} can’t hang on.'],
    ['It’s in his hands... and out. Dropped by {receiver}.'],
    ['{hitter} arrives with the ball, and it comes loose. Incomplete.', ['contact']],
    ['{receiver} drops it. That’s been the knock on him.', ['receiver:drops|alligator-arms']],
  ]),
  ...L('breakup', [
    ['Broken up by {defender}!'],
    ['{defender} gets a hand in there. Incomplete.'],
    ['Good coverage by {defender}. Knocked away.'],
    ['{defender} blankets {receiver} and knocks it away.', [`defender:${COVER}|${HAWK}`]],
    ['{defender} was there the whole way. Pass broken up.', [`defender:${COVER}`]],
  ]),
  ...L('batted', [
    ['Batted down at the line by {defender}!'],
    ['{defender} gets a paw on it at the line.'],
    ['Knocked down at the line. {defender} reads the throw.'],
  ]),
  ...L('throwAway', [
    ['{passer} throws it away.'],
    ['Nothing there. {passer} sends it out of bounds.'],
    ['{passer} lives to play another down. Thrown away.'],
  ]),
  ...L('catchOOB', [
    ['{receiver} makes the grab, but he’s out of bounds.'],
    ['Caught, but out. {receiver} couldn’t get a foot down.'],
  ]),
  ...L('sack', [
    ['{rusher} gets home! {passer} is sacked for a loss of {loss}.'],
    ['Sacked! {rusher} drops {passer}.'],
    ['{rusher} beats his man and brings down {passer}.'],
    ['{passer} goes down. {rusher} with the sack.'],
    ['{rusher} bends the edge and gets to {passer}.', [`rusher:${RUSH_EDGE}`]],
    ['{rusher} walks his man right back into {passer}. Sack.', [`rusher:${RUSH_POWER}`]],
    ['That’s what {rusher} does. Sack.', [`rusher:${SACKER}|${RUSH_EDGE}`]],
    ['{passer} never had a chance to move. Sacked by {rusher}.', [`passer:${STILL}`]],
    ['Sack on third down. The Contenders will have a decision to make.', ['thirdDown']],
    ['A sack on fourth down! The Beasts take over.', ['fourthDown']],
  ]),
  ...L('stripSack', [
    ['{rusher} strips {passer}! The ball’s out, and the Beasts have it!', ['lost']],
    ['Strip sack! {rusher} takes the ball and the drive with it.', ['lost']],
    ['{rusher} knocks it out of {passer}’s hands! Turnover.', ['lost']],
    ['{passer} is stripped, but the Contenders fall on it.', [], ['lost']],
    ['The ball comes out on the sack. The Contenders keep it.', [], ['lost']],
  ]),
  ...L('int', [
    ['Intercepted by {defender}!'],
    ['Picked off! {defender} jumps the route.'],
    ['{passer} throws it right to {defender}. Interception.'],
    ['{defender} reads it all the way. Intercepted.'],
    ['{defender} was sitting on that one. Picked.', [`defender:${HAWK}`]],
    ['{passer} tries to force it, and {defender} makes him pay.', [`passer:${RISKY}`]],
    ['Under-thrown, and {defender} comes down with it.', ['deep']],
    ['{passer} throws into pressure, and {defender} picks it.', ['pressure']],
  ]),
  ...L('pickSix', [
    ['Picked off... and {defender} is gone! Pick-six for the Beasts.'],
    ['{defender} jumps it and takes it to the house!'],
    ['Interception, returned for a touchdown. {defender} makes it look easy.'],
    ['{defender} lives for that. Picked off and taken back for six.', [`defender:${HAWK}`]],
  ]),
  ...L('fumble', [
    ['Fumble! {runner} coughs it up, and {defender} recovers for the Beasts.'],
    ['The ball’s out! {defender} falls on it. Beasts ball.'],
    ['{hitter} punches it loose. Turnover.'],
    ['{hitter} punches it out! The Beasts have the ball.', ['hitter:ball-punch|strip-sack']],
    ['Ball security’s been the question with {runner}. Fumble, Beasts ball.', ['runner:fumble-risk']],
    ['Scoop and score! {defender} takes it all the way.', ['returnTD']],
  ]),
  ...L('bigHit', [
    ['{hitter} lays the wood on {runner}!'],
    ['Oh, what a shot by {hitter}!'],
    ['{hitter} arrives with bad intentions. {runner} goes down hard.'],
    ['{hitter} lives for that. What a hit.', [`hitter:${HITTER}`]],
    ['{runner} takes a shot from {hitter} and holds on for {yards}.', ['gain']],
  ]),
  ...L('safety', [
    ['Safety! {tackler} drops {runner} in the end zone.'],
    ['Tackled in the end zone. That’s two points for the Beasts.'],
    ['Pinned deep and brought down for a safety.'],
  ]),
  ...L('downs', [
    ['Stopped short! Turnover on downs.'],
    ['{tackler} makes the stop on fourth down. Beasts ball.'],
    ['They went for it, and the Beasts held. Turnover on downs.'],
  ]),
  ...L('twoPointGood', [
    ['The two-point try is good!'],
    ['{runner} gets in. Two points.'],
    ['Two-point conversion: good. {runner} with it.'],
  ]),
  ...L('twoPointFailed', [
    ['Stopped! The two-point try fails.'],
    ['No good on the two-point try. {tackler} with the stop.'],
    ['The Beasts hold on the conversion.'],
  ]),
  ...L('kneel', [['The Contenders take a knee.'], ['A knee, and the clock keeps moving.']]),
  ...L('spike', [['Spiked to stop the clock.'], ['The ball is spiked. Clock stopped.']]),
  ...L('fgGood', [
    ['The {yards}-yard try is... good!'],
    ['Right down the middle from {yards}. Three points.'],
    ['It’s good! A {yards}-yard field goal.'],
    ['The field goal is good.'],
    ['Into the wind, and it still gets there from {yards}.', ['windy']],
    ['From {yards} with the game on the line... good!', ['late', 'close']],
    ['A {yards}-yard field goal, and the Contenders take the lead.', ['takesLead']],
  ]),
  ...L('fgMiss', [
    ['No good! The {yards}-yard try misses.'],
    ['The kick is no good.'],
    ['Wide left from {yards}. No good.', ['wideLeft']],
    ['Wide right! The {yards}-yard try is no good.', ['wideRight']],
    ['Short! The {yards}-yard kick falls short.', ['shortKick']],
    ['Off the upright! No good.', ['doink']],
    ['The wind takes it. No good from {yards}.', ['windy']],
  ]),
  ...L('patGood', [['The extra point is good.'], ['The PAT is through.'], ['Extra point: good.']]),
  ...L('patMiss', [['The extra point is no good!'], ['The PAT misses! That point could matter.']]),
  ...L('punt', [
    ['A {yards}-yard punt.'],
    ['The Contenders punt it away. {yards} yards.'],
    ['The Contenders punt it away.'],
    ['{yards}-yard punt, fair catch.', ['fairCatch']],
    ['A {yards}-yard punt, out of bounds.', ['puntOut']],
    ['A {yards}-yard punt into the end zone. Touchback.', ['touchback']],
    ['Returned. The punt nets {net}.', ['returned']],
  ]),
  ...L('beastsTD', [
    ['The Beasts punch in a touchdown.', [], ['opening']],
    ['The Beasts strike first with a touchdown.', ['opening']],
    ['The Beasts score a touchdown and convert for two.', ['twoGood']],
    ['The Beasts answer with a touchdown.', ['answer']],
    ['{plays} plays, {yards} yards. The Beasts find the end zone.'],
    ['Touchdown, Beasts. That’s {plays} plays and {top} off the clock.'],
    ['The Beasts march right down the field. Touchdown.'],
    ['The Beasts take the lead with a touchdown.', ['beastsLead']],
  ]),
  ...L('beastsFG', [
    ['The Beasts drill a field goal.', [], ['opening']],
    ['The Beasts open the scoring with a field goal.', ['opening']],
    ['The drive stalls, and the Beasts settle for three.'],
    ['{plays} plays, and the Beasts come away with a field goal.'],
    ['The Beasts answer with three.', ['answer']],
  ]),
  ...L('beastsPunt', [
    ['The Contenders’ defense holds. The Beasts punt.'],
    ['Three and out! The Beasts have to punt.', ['threeAndOut']],
    ['The Beasts go nowhere and punt it away.'],
    ['A stop for the Contenders. Beasts punt.'],
  ]),
  ...L('beastsTurnover', [
    ['Turnover! The Beasts give it away.'],
    ['The Contenders take it away!'],
    ['A takeaway! The Contenders get the ball back.'],
  ]),
  ...L('beastsDowns', [
    ['The Beasts go for it on fourth... and they’re stopped!'],
    ['Turnover on downs! The Contenders hold.'],
  ]),
  ...L('beastsSafety', [['Safety! The Contenders pin the Beasts in their own end zone.'], ['The Beasts are tackled in their end zone. Two points, Contenders.']]),
  ...L('beastsMissedFG', [['The Beasts’ kick is no good!'], ['The Beasts miss the field goal. No points.']]),
  ...L('beastsHalf', [['The Beasts run out the half.'], ['That’s the half.']]),
  ...L('beastsGame', [['The Beasts kneel it out.', ['beastsLead']], ['Time runs out on the Beasts’ drive.']]),
  ...L('driveStart', [
    ['The Contenders take over at the {spot}.'],
    ['The Contenders take the field.'],
    ['First and ten from the {spot}. Here we go.'],
    ['A short field for the Contenders. Ball on the {spot}.', ['shortField']],
    ['Backed up at the {spot}.', ['backedUp']],
    ['Here we go: the Contenders’ first snap.', ['firstSnap']],
    ['Down {deficit}, the Contenders take over at the {spot}.', ['trailing']],
  ]),
  ...L('thirdLong', [
    ['Third and {toGo}. A big down for the Contenders.'],
    ['Third and long. The Beasts know what’s coming.'],
    ['Third and {toGo}, and the Beasts can pin their ears back.'],
  ]),
  ...L('thirdShort', [
    ['Third and {toGo}, the sticks in sight.'],
    ['Third and short. Move the sticks and keep it going.'],
    ['Third and {toGo}. Pick it up and keep the drive alive.'],
  ]),
  ...L('fourthDown', [
    ['They’re going for it on fourth down!'],
    ['Fourth and {toGo}. The Contenders are rolling the dice.'],
    ['Fourth down, and this drive lives or dies on one snap.'],
  ]),
  ...L('goalToGo', [
    ['First and goal from the {spot}.', ['down1']],
    ['Goal to go.'],
    ['Goal to go from the {spot}. Punch it in.'],
  ]),
  ...L('redZone', [
    ['The Contenders are in the red zone.'],
    ['Inside the 20, and the field gets tight.'],
    ['Red zone. The Beasts’ defense digs in.'],
  ]),
  ...L('twoMinute', [
    ['{clock} to go, and the Contenders need {need}.', ['trailing']],
    ['Two-minute drill. {timeouts} timeouts left.'],
    ['Two-minute drill for the Contenders.'],
    ['The clock is the enemy now. {clock} left.'],
  ]),
];

const BY_KIND: ReadonlyMap<CallKind, readonly Line[]> = (() => {
  const m = new Map<CallKind, Line[]>();
  for (const l of BANK) m.set(l.kind, [...(m.get(l.kind) ?? []), l]);
  return m;
})();

/** The kinds the bank answers. */
export const KINDS: readonly CallKind[] = [...BY_KIND.keys()];

/** The slots a line's text names. */
export function slotsOf(text: string): SlotName[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as SlotName);
}

const isName = (s: SlotName): s is keyof typeof FALLBACK => s in FALLBACK;
/** A slot's value as text, or null when it's missing (null, undefined, empty, NaN, or the string "null"). */
function valueOf(slots: Slots, s: SlotName): string | null {
  const v = slots[s];
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(Math.abs(v))) : null;
  const t = String(v).trim();
  return t && t !== 'null' && t !== 'undefined' ? t : null;
}

/** A line is eligible when every slot that has no fallback has a value. */
export function canSay(line: Line, slots: Slots): boolean {
  return slotsOf(line.text).every((s) => isName(s) || valueOf(slots, s) !== null);
}

/** The trait tag a line matched ("receiver:contested-catch-king" against the context's tags): the role and the trait. */
function tagMatch(need: string, tags: ReadonlySet<string>): string | null {
  const [role, alts] = need.includes(':') ? (need.split(':') as [string, string]) : [null, need];
  for (const a of alts.split('|')) {
    const t = role ? `${role}:${a}` : a;
    if (tags.has(t)) return t;
  }
  return null;
}

function fits(line: Line, tags: ReadonlySet<string>): boolean {
  return (line.need ?? []).every((n) => tagMatch(n, tags) !== null) && !(line.not ?? []).some((n) => tagMatch(n, tags) !== null);
}

const SENTENCE_START = /(^|[.!?]\s+|\.\.\.\s*)$/;

/** The line with its slots filled (a name the sim doesn't have reads as its fallback), capitalised, with "a"/"an" agreeing with the number after it. */
export function fill(text: string, slots: Slots): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    const s = m[1] as SlotName;
    out += text.slice(last, m.index);
    let v = valueOf(slots, s) ?? (isName(s) ? FALLBACK[s] : '');
    if (SENTENCE_START.test(out)) v = v.charAt(0).toUpperCase() + v.slice(1);
    out += v;
    last = m.index! + m[0].length;
  }
  out += text.slice(last);
  // "a 8-yard" → "an 8-yard" (8, 11, 18, 80–89 and 800s are said with a vowel).
  out = out.replace(/\b([Aa]) (\d+)/g, (all, a: string, n: string) => (/^(8|11|18)(\D|$)|^8\d/.test(n) ? `${a}n ${n}` : all));
  return out.replace(/\s{2,}/g, ' ').trim();
}

export interface Said {
  id: string;
  text: string;
  /** The trait the line was chosen for (the lower third's badge): its slot and id. */
  trait: { role: string; id: string } | null;
}

/**
 * The commentator for one game: a seeded stream and the lines said lately.
 * `say` is pure in its inputs and its own history, so the same game seed and
 * the same events give the same lines.
 */
export class Commentator {
  private rng: Rng;
  private recent: string[] = [];
  private byKind = new Map<CallKind, string[]>();
  private lastSaid = new Map<string, number>();
  private n = 0;

  constructor(seed: number, private readonly window = VARIETY_WINDOW) {
    this.rng = deriveStream(seed, 'commentary');
  }

  /** The lines said, most recent last (the variety window). */
  get history(): readonly string[] {
    return this.recent;
  }

  say(kind: CallKind, slots: Slots = {}, tags: Iterable<string> = []): Said {
    const tagSet = new Set(tags);
    const pool = BY_KIND.get(kind) ?? [];
    const ok = pool.filter((l) => fits(l, tagSet) && canSay(l, slots));
    // Every kind has a line that needs nothing; an unknown kind still says something.
    const eligible = ok.length ? ok : pool.filter((l) => !l.need?.length && canSay(l, slots));
    if (!eligible.length) return { id: `${kind}.none`, text: '', trait: null };
    const mine = this.byKind.get(kind) ?? [];
    const k = Math.min(KIND_WINDOW, eligible.length - 1);
    const own = k > 0 ? mine.slice(-k) : [];
    const fresh = eligible.filter((l) => !this.recent.includes(l.id) && !own.includes(l.id));
    let line: Line;
    if (fresh.length) {
      // Specific lines weigh more: 1 + 2 per requirement met.
      const w = fresh.map((l) => 1 + 2 * (l.need?.length ?? 0));
      let r = this.rng() * w.reduce((a, b) => a + b, 0);
      let i = 0;
      while (i < fresh.length - 1 && (r -= w[i]!) >= 0) i++;
      line = fresh[i]!;
    } else {
      // All said lately: the one said longest ago (the stream still advances, so the next pick doesn't depend on this).
      this.rng();
      line = eligible.reduce((a, b) => ((this.lastSaid.get(a.id) ?? -1) <= (this.lastSaid.get(b.id) ?? -1) ? a : b));
    }
    this.recent.push(line.id);
    if (this.recent.length > this.window) this.recent.shift();
    this.lastSaid.set(line.id, this.n++);
    this.byKind.set(kind, [...mine, line.id].slice(-KIND_WINDOW));
    let trait: Said['trait'] = null;
    for (const need of line.need ?? []) {
      const t = need.includes(':') ? tagMatch(need, tagSet) : null;
      if (t) {
        const [role, id] = t.split(':') as [string, string];
        trait = { role, id };
        break;
      }
    }
    return { id: line.id, text: fill(line.text, slots), trait };
  }
}
