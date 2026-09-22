// Broadcast text, ported line-for-line from legacy/beat-the-beasts.jsx:
// situFor 6785–6814, bannerFor 8225–8241, captionFor 8246–8262,
// generateBeatdownAnalysis 8752–8784. Words only; no SVG.

import { TEAM_NAME } from '@data/legacy/constants';
import type { BeastLike, BeatdownResult, CinematicEvent, Roster } from './types';

/** The subset of an event the text functions read. */
export type EventLike = Partial<Pick<CinematicEvent, 'type' | 'by' | 'passer' | 'yard' | 'pts' | 'opening' | 'drive' | 'q'>>;

export interface Situation {
  dnd: string;
  clockSub: string;
  playClk: string;
  wind: number;
}

/**
 * Seeded pseudo game-situation per event (down & distance, play clock, wind):
 * the sim doesn't track these, so the HUD derives stable values.
 */
export function situFor(e: EventLike): Situation {
  const sd = (((e.drive || 1) * 7919) ^ ((e.q || 1) * 104729)) >>> 0;
  const t = e.type || '';
  const playClk = ':' + String(5 + (sd % 18)).padStart(2, '0');
  const wind = 2 + (sd % 11);
  const isTD = t.indexOf('TD') !== -1;
  const isKick = t === 'FG' || t === 'FG_MISS' || t === 'BEAST_FG' || t === 'PUNT';
  let dnd, clockSub;
  if (isTD) {
    const spot = e.yard != null ? Math.round(e.yard) : 1 + (sd % 9);
    dnd = '1ST & ' + (spot <= 9 ? 'GOAL' : '10');
    clockSub = spot <= 50 ? 'BALL ON ' + spot : 'OWN ' + (100 - spot);
  } else if (isKick) {
    dnd = '4TH & ' + (2 + (sd % 8));
    clockSub = Math.round(e.yard || 40) + ' YARD FG ATTEMPT';
  } else if (t === 'DOWNS' || t === 'BEAST_SAFETY') {
    dnd = '4TH & ' + (1 + (sd % 3));
    clockSub = dnd;
  } else {
    const dn = 1 + (sd % 3);
    dnd = (dn === 1 ? '1ST' : dn === 2 ? '2ND' : '3RD') + ' & ' + (3 + (sd % 8));
    clockSub = dnd;
  }
  return { dnd, clockSub, playClk, wind };
}

/** Build a human caption for an event. */
export function captionFor(e: EventLike): string {
  if (e.type === 'RUSH_TD') return `${e.by} runs for a ${Math.round(e.yard as number)}-yard touchdown.`;
  if (e.type === 'PASS_TD') return `${e.passer} finds ${e.by} for a ${Math.round(e.yard as number)}-yard touchdown.`;
  if (e.type === 'FG') return `${TEAM_NAME} kick a ${Math.round(e.yard as number)}-yard field goal.`;
  if (e.type === 'FG_MISS') return `${TEAM_NAME} miss a ${Math.round(e.yard as number)}-yard field goal.`;
  if (e.type === 'INT') return `Intercepted by ${e.by}!`;
  if (e.type === 'FUM') return `${e.by} forces a fumble. Beasts ball!`;
  if (e.type === 'DOWNS') return `${TEAM_NAME} turn it over on downs.`;
  if (e.type === 'BEAST_TD') {
    if (e.pts === 8) return 'The Beasts score a touchdown and convert for two.';
    return e.opening ? 'The Beasts strike first with a touchdown.' : 'The Beasts punch in a touchdown.';
  }
  if (e.type === 'BEAST_FG') return e.opening ? 'The Beasts open the scoring with a field goal.' : 'The Beasts drill a field goal.';
  if (e.type === 'BEAST_SAFETY') return 'The Beasts force a safety.';
  if (e.type === 'PUNT') return `${TEAM_NAME} punt it away.`;
  return 'Big play.';
}

export interface Banner {
  word: string;
  name: string | null | undefined;
  det: string;
  pos: string;
  theme: 'gold' | 'dim' | 'beast';
}

/** Lower-third banner content per event type (big word, name, detail, position chip). */
export function bannerFor(e: EventLike): Banner {
  const t = e.type || '';
  const yd = e.yard ? Math.round(e.yard) + '-YD ' : '';
  if (t === 'RUSH_TD') return { word: 'TOUCHDOWN!', name: e.by, det: yd + 'TD RUN', pos: 'RB', theme: 'gold' };
  if (t === 'PASS_TD') return { word: 'TOUCHDOWN!', name: e.by, det: yd + 'TD RECEPTION', pos: 'WR', theme: 'gold' };
  if (t === 'FG') return { word: 'FIELD GOAL!', name: e.by, det: yd + 'FIELD GOAL IS GOOD', pos: 'K', theme: 'gold' };
  if (t === 'FG_MISS') return { word: 'NO GOOD!', name: e.by, det: yd + 'ATTEMPT SAILS WIDE', pos: 'K', theme: 'dim' };
  if (t === 'PUNT') return { word: 'PUNT', name: e.by, det: 'PUNTING IT AWAY', pos: 'P', theme: 'dim' };
  if (t === 'DOWNS') return { word: 'TURNOVER ON DOWNS', name: e.by, det: 'STUFFED ON 4TH DOWN', pos: '', theme: 'dim' };
  if (t === 'INT') return { word: 'INTERCEPTED!', name: e.by, det: 'THE BEASTS TAKE IT AWAY', pos: 'DB', theme: 'beast' };
  if (t === 'FUM') return { word: 'FUMBLE!', name: e.by, det: 'RECOVERED BY THE BEASTS', pos: 'LB', theme: 'beast' };
  if (t === 'BEAST_TD') return { word: 'TOUCHDOWN!', name: 'THE BEASTS', det: (captionFor(e) || '').replace('The Beasts ', '').replace('.', '').toUpperCase(), pos: '', theme: 'beast' };
  if (t === 'BEAST_FG') return { word: 'FIELD GOAL!', name: 'THE BEASTS', det: (captionFor(e) || '').replace('The Beasts ', '').replace('.', '').toUpperCase(), pos: '', theme: 'beast' };
  if (t === 'BEAST_SAFETY') return { word: 'SAFETY!', name: 'THE BEASTS', det: 'TWO POINTS THE OTHER WAY', pos: '', theme: 'beast' };
  return { word: t, name: e.by || '', det: '', pos: '', theme: 'dim' };
}

/** The post-game write-up paragraph. */
export function generateBeatdownAnalysis(
  result: Pick<BeatdownResult, 'won' | 'yourScore' | 'beastScore' | 'defRating' | 'box' | 'trench' | 'matchups'>,
  roster: Roster,
  beasts: readonly BeastLike[],
): string {
  const { won, yourScore, beastScore, defRating, box, trench, matchups } = result;
  const qb = roster.QB;
  const ol = roster.OL;
  const topBeast = beasts.reduce((a, b) => (b.imp > a.imp ? b : a));
  const margin = Math.abs(yourScore - beastScore);
  const passRush = trench.sacks >= 4 ? 'relentless' : trench.sacks >= 2 ? 'steady' : 'manageable';

  // Find the standout offensive performer and the matchup that swung the game.
  const topRec = (box.rec || []).slice().sort((a, b) => b.yds - a.yds)[0];
  const topRush = (box.rush || []).slice().sort((a, b) => b.yds - a.yds)[0];
  const wonMatch = matchups.find(m => m.winner === 'offense');
  const lostMatch = matchups.find(m => m.winner === 'defense');
  const qbLine = `${box.pass.cmp}/${box.pass.att} for ${box.pass.yds}, ${box.pass.td} TD${box.pass.int ? ` and ${box.pass.int} INT` : ''}${box.qbRush && box.qbRush.att > 0 ? `, plus ${box.qbRush.yds} yds on ${box.qbRush.att} scrambles` : ''}`;

  const recBit = topRec ? `${topRec.name} led the way with ${topRec.rec} catches for ${topRec.yds}${topRec.td ? ` and ${topRec.td} TD` : ''}` : 'the passing game struggled to find a rhythm';
  const rushBit = topRush ? `${topRush.name} carried ${topRush.car} times for ${topRush.yds}${topRush.td ? ` and ${topRush.td} on the ground` : ''}` : 'the run game never got going';

  if (won && margin >= 21) {
    return `A total dismantling. ${qb.n} went ${qbLine} against a Beasts front anchored by ${topBeast.n}, and the ${ol.t} line kept the ${passRush} pass rush off him (${trench.sacks} sacks allowed). ${recBit}, and ${rushBit}. ${wonMatch ? `${wonMatch.off} owned his matchup with ${wonMatch.def} for ${wonMatch.recYds} yards. ` : ''}Beating an all-time defense rated ${defRating} by ${margin} is the kind of game you frame.`;
  }
  if (won) {
    return `You beat the Beasts ${yourScore}-${beastScore}. ${qb.n} went ${qbLine} behind a line that handled a ${passRush} rush (${trench.sacks} sacks). ${recBit[0]!.toUpperCase() + recBit.slice(1)}, and ${rushBit}. ${wonMatch ? `The difference was ${wonMatch.off} beating ${wonMatch.def} (${wonMatch.recYds} yds). ` : ''}A defense rated ${defRating} doesn't give up much, but you made the plays that mattered.`;
  }
  if (margin <= 10) {
    return `So close. You fell ${beastScore}-${yourScore} to a Beasts unit rated ${defRating}. ${qb.n} went ${qbLine} and ${recBit}, but ${lostMatch ? `${lostMatch.def} blanketed ${lostMatch.off} (just ${lostMatch.recYds} yds) and ` : ''}a ${passRush} rush got home ${trench.sacks} times. A few plays the other way and this is a win — run it back against new Beasts.`;
  }
  return `The Beasts handled you ${beastScore}-${yourScore}. A front led by ${topBeast.n} brought a ${passRush} rush (${trench.sacks} sacks) that the ${ol.t} line couldn't slow, and ${qb.n} went ${qbLine}. ${lostMatch ? `${lostMatch.def} erased ${lostMatch.off} in coverage. ` : ''}Against a defense rated ${defRating}, you'll need a more complete offense — draft again and find a better matchup.`;
}
