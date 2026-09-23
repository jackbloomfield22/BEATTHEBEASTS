import type { DefPos } from '../types';
import type { SkillAttrDef, TermDef } from './types';

const t = (s: string | readonly string[], w: number): TermDef => ({ s, w });

// ---------------------------------------------------------------------- OL
// "each lineman's accolade rate, plus the unit's era-adjusted sack rate
// allowed (pass pro) and rushing yards (run block)". The unit terms are shared
// by all five linemen in a unit; honors and body separate them.

export const OL_ATTRS: readonly SkillAttrDef[] = [
  {
    key: 'pbPower',
    label: 'Pass Block Power',
    base: 72,
    terms: [t('u_sack', 0.2), t('u_grade', 0.15), t('acc', 0.3), t('p_strength', 0.2), t('imp', 0.15)],
    note: "Unit sack rate, the lineman's honors and strength. Holds up against bull rushes.",
  },
  {
    key: 'pbFinesse',
    label: 'Pass Block Finesse',
    base: 72,
    terms: [t('u_sack', 0.25), t('u_grade', 0.15), t('acc', 0.3), t('p_agility', 0.15), t('imp', 0.15)],
    note: 'Unit sack rate, honors and agility. Mirrors speed and swim moves.',
  },
  {
    key: 'rbPower',
    label: 'Run Block Power',
    base: 72,
    terms: [t('u_run', 0.25), t('acc', 0.3), t('p_strength', 0.15), t('p_weight', 0.15), t('imp', 0.15)],
    note: 'Unit rushing yards vs league, honors, mass and strength. Drive blocks and double teams.',
  },
  {
    key: 'rbFinesse',
    label: 'Run Block Finesse',
    base: 72,
    terms: [t('u_run', 0.25), t('acc', 0.3), t('p_agility', 0.2), t('u_grade', 0.1), t('imp', 0.15)],
    note: 'Unit rushing yards, honors and agility. Reach and zone blocks.',
  },
  {
    key: 'anchor',
    label: 'Anchor',
    base: 72,
    terms: [t('p_weight', 0.3), t('p_strength', 0.2), t('u_sack', 0.15), t('acc', 0.2), t('imp', 0.15)],
    note: 'Mass, strength and pass protection. How long the pocket holds against power.',
  },
  {
    key: 'pullMove',
    label: 'Pull and Move',
    base: 72,
    terms: [t('p_agility', 0.35), t('u_run', 0.2), t('acc', 0.3), t('imp', 0.15)],
    note: 'Agility, unit run game and honors. Pulls, screens and second-level blocks.',
  },
  {
    key: 'awareness',
    label: 'Awareness',
    base: 72,
    terms: [t('acc', 0.35), t('exp', 0.3), t('u_pbl', 0.15), t('imp', 0.2)],
    note: 'Honors, experience and unit quality. Stunt and blitz pickup.',
  },
];

// ----------------------------------------------------------------- Defense
// "Accolades per season ... are the backbone for every defender." Man
// Coverage and Press come mostly from honors and reputation, not INTs; Ball
// Skills comes from INTs and passes defensed.

/**
 * Position average and position best per skill on the shared scale:
 * [base, top]. A position's own skills are [72, 98]; for occasional skills the
 * average sits lower but the best still reaches where that skill matters (the
 * best pass-rushing linebacker rates with the elite ends; the best cover
 * linebacker stays below the elite corners).
 */
const DEF_SCALE: Record<string, Record<DefPos, [number, number]>> = {
  tackle: { DE: [68, 95], DT: [68, 95], LB: [72, 98], CB: [62, 88], S: [70, 96] },
  hitPower: { DE: [68, 95], DT: [68, 95], LB: [72, 98], CB: [62, 90], S: [72, 98] },
  pursuit: { DE: [68, 95], DT: [62, 92], LB: [72, 98], CB: [70, 95], S: [72, 98] },
  playRec: { DE: [72, 98], DT: [72, 98], LB: [72, 98], CB: [72, 98], S: [72, 98] },
  blockShed: { DE: [72, 98], DT: [72, 98], LB: [68, 95], CB: [45, 75], S: [52, 82] },
  powerMoves: { DE: [72, 98], DT: [72, 98], LB: [58, 92], CB: [30, 55], S: [38, 65] },
  finesseMoves: { DE: [72, 98], DT: [66, 96], LB: [60, 98], CB: [35, 65], S: [40, 72] },
  manCov: { DE: [30, 50], DT: [22, 40], LB: [52, 85], CB: [72, 98], S: [66, 94] },
  zoneCov: { DE: [35, 60], DT: [25, 45], LB: [60, 92], CB: [72, 98], S: [72, 98] },
  press: { DE: [30, 50], DT: [25, 45], LB: [45, 75], CB: [72, 98], S: [60, 90] },
  ballSkills: { DE: [35, 65], DT: [30, 55], LB: [55, 90], CB: [72, 98], S: [72, 98] },
  awareness: { DE: [72, 98], DT: [72, 98], LB: [72, 98], CB: [72, 98], S: [72, 98] },
};

function defAttrs(pos: DefPos): SkillAttrDef[] {
  const db = pos === 'CB' || pos === 'S';
  const b = (k: string) => DEF_SCALE[k]![pos][0];
  const tp = (k: string) => (DEF_SCALE[k]![pos][0] === 72 ? undefined : DEF_SCALE[k]![pos][1]);
  return [
    {
      key: 'tackle',
      label: 'Tackle',
      base: b('tackle'),
      top: tp('tackle'),
      // DBs' honors reflect coverage, so they don't count toward tackling.
      terms: db
        ? [t('d_tkl', 0.35), t('p_weight', 0.3), t('d_ff', 0.15), t('exp', 0.1), t('imp', 0.1)]
        : [t('acc', 0.3), t('d_tkl', 0.3), t('d_ff', 0.1), t('exp', 0.1), t('imp', 0.2)],
      note: 'Tackles per game (where officially tracked), honors and role. Wrap-up success.',
    },
    {
      key: 'hitPower',
      label: 'Hit Power',
      base: b('hitPower'),
      top: tp('hitPower'),
      terms: [t('p_weight', 0.3), t('d_ff', 0.25), t('acc', 0.2), t('p_strength', 0.1), t('imp', 0.15)],
      note: 'Mass, forced fumbles and honors. Knockback and fumble pressure on contact.',
    },
    {
      key: 'pursuit',
      label: 'Pursuit',
      base: b('pursuit'),
      top: tp('pursuit'),
      terms: [t('p_speed', 0.3), t('d_tkl', 0.2), t('acc', 0.3), t('imp', 0.2)],
      note: 'Speed, tackle volume and honors. Pursuit angles and closing speed to the ball.',
    },
    {
      key: 'playRec',
      label: 'Play Recognition',
      base: b('playRec'),
      top: tp('playRec'),
      terms: [t('acc', 0.4), t('exp', 0.2), t('d_int', 0.1), t('d_tkl', 0.1), t('imp', 0.2)],
      note: 'Honors and experience. How long pump fakes and play action fool the defender.',
    },
    {
      key: 'blockShed',
      label: 'Block Shedding',
      base: b('blockShed'),
      top: tp('blockShed'),
      terms: [t('acc', 0.35), t('d_sack', 0.15), t('d_tkl', 0.15), t('p_strength', 0.15), t('imp', 0.2)],
      note: 'Honors, backfield production and strength. Disengaging from a block.',
    },
    {
      key: 'powerMoves',
      label: 'Power Moves',
      base: b('powerMoves'),
      top: tp('powerMoves'),
      terms: [t('d_sack', 0.3), t('acc', 0.3), t('p_weight', 0.15), t('p_strength', 0.1), t('imp', 0.15)],
      note: 'Sacks per game vs league, honors, mass and strength. Bull rush and long-arm wins.',
    },
    {
      key: 'finesseMoves',
      label: 'Finesse Moves',
      base: b('finesseMoves'),
      top: tp('finesseMoves'),
      terms: [t('d_sack', 0.35), t('acc', 0.25), t('p_speed', 0.15), t('p_agility', 0.1), t('imp', 0.15)],
      note: 'Sacks per game vs league, honors, speed and agility. Speed rush, swim and spin wins.',
    },
    {
      key: 'manCov',
      label: 'Man Coverage',
      base: b('manCov'),
      top: tp('manCov'),
      terms: [t('acc', 0.45), t('d_pd', 0.2), t('p_speed', 0.15), t('imp', 0.2)],
      note: 'Mostly honors and reputation plus passes defensed (1999 on), not INTs: shutdown corners are rarely thrown at. Reaction delay in man.',
    },
    {
      key: 'zoneCov',
      label: 'Zone Coverage',
      base: b('zoneCov'),
      top: tp('zoneCov'),
      terms: [t('acc', 0.35), t('d_int', 0.25), t('d_pd', 0.15), t('exp', 0.1), t('imp', 0.15)],
      note: 'Honors, INTs and passes defensed. Zone drops, spacing and breaks on the ball.',
    },
    {
      key: 'press',
      label: 'Press',
      base: b('press'),
      top: tp('press'),
      terms: [t('acc', 0.45), t('p_strength', 0.15), t('p_height', 0.1), t('d_pd', 0.1), t('imp', 0.2)],
      note: 'Honors, strength and length. Jamming receivers at the line.',
    },
    {
      key: 'ballSkills',
      label: 'Ball Skills',
      base: b('ballSkills'),
      top: tp('ballSkills'),
      terms: [t('d_int', 0.45), t('d_pd', 0.2), t('d_td', 0.1), t('acc', 0.1), t('imp', 0.15)],
      note: 'INTs and passes defensed per game vs league. Turns a breakup into a pick.',
    },
    {
      key: 'awareness',
      label: 'Awareness',
      base: b('awareness'),
      top: tp('awareness'),
      terms: [t('acc', 0.35), t('exp', 0.3), t('d_tkl', 0.15), t('imp', 0.2)],
      note: 'Honors and experience. Assignment discipline: gap integrity, eye discipline, communication.',
    },
  ];
}

export const DEF_ATTRS: Record<DefPos, readonly SkillAttrDef[]> = {
  DE: defAttrs('DE'),
  DT: defAttrs('DT'),
  LB: defAttrs('LB'),
  CB: defAttrs('CB'),
  S: defAttrs('S'),
};
