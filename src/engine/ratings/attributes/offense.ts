import type { SkillAttrDef, TermDef } from './types';

// Offensive skill attributes (BRIEF "The attribute set" and "How each
// attribute is derived"). Weights are starting values chosen from the brief's
// guidance; each list sums to 1. Signal keys are defined in ../signals.ts.

const t = (s: string | readonly string[], w: number): TermDef => ({ s, w });

// ---------------------------------------------------------------------- QB

export const QB_ATTRS: readonly SkillAttrDef[] = [
  {
    key: 'throwPower',
    label: 'Throw Power',
    base: 72,
    // "yards per attempt index plus the deep share of production, with
    // reputation used to separate true cannons"
    // Honors say nothing about arm strength, so they're left out.
    // Ratings follow-up (user-approved): two arm-specific inputs.
    //   q_air  intended air yards per attempt vs league, 2006+ (verified).
    //          It measures where he throws, not how hard (the graded cannons
    //          average a ratio of 1.04, the weak arms 0.88), so it is one input
    //          of five, weighted below the deep share it complements.
    //   q_arm  our grade of cited arm descriptions, any era (estimated),
    //          scaled by evidence strength (signals.ts ARM_GRADE_Z,
    //          ARM_EVIDENCE_WEIGHT). Most QBs have no grade; like any
    //          missing evidence it then regresses to the average and moves
    //          part of its weight to the stats he has.
    // The deep share stays the largest term (every era has it); volume and
    // reputation give up the weight (volume says little about the arm).
    terms: [t('q_ypcmp', 0.3), t('q_air', 0.2), t('q_arm', 0.2), t('q_ypa', 0.1), t(['q_yds', 'q_tdg'], 0.05), t('imp', 0.15)],
    note: 'Yards per completion (deep share), intended air yards per attempt (2006+) and per-attempt yards vs league, plus a sourced arm grade (estimated) where one exists. Drives release velocity and max air distance.',
  },
  {
    key: 'shortAcc',
    label: 'Short Accuracy',
    base: 72,
    terms: [t('q_cmp', 0.45), t(['q_int', 'q_intg'], 0.15), t('q_rate', 0.15), t('acc', 0.1), t('imp', 0.15)],
    note: 'Completion % vs league, INT rate, passer rating. Sets the placement error cone on short throws.',
  },
  {
    key: 'midAcc',
    label: 'Mid Accuracy',
    base: 72,
    terms: [t('q_cmp', 0.3), t('q_rate', 0.25), t('q_ypa', 0.15), t(['q_int', 'q_intg'], 0.1), t('acc', 0.1), t('imp', 0.1)],
    note: 'Completion %, passer rating and Y/A vs league. Placement error at 10–25 yards.',
  },
  {
    key: 'deepAcc',
    label: 'Deep Accuracy',
    base: 72,
    terms: [t('q_ypa', 0.3), t(['q_td', 'q_tdg'], 0.3), t('q_ypcmp', 0.15), t('acc', 0.1), t('imp', 0.15)],
    note: 'Y/A and TD rate vs league. Placement error beyond 25 yards.',
  },
  {
    key: 'throwOnRun',
    label: 'Throw on the Run',
    base: 72,
    terms: [t('q_rush', 0.25), t('q_rate', 0.2), t('q_cmp', 0.1), t('p_agility', 0.2), t('acc', 0.1), t('imp', 0.15)],
    note: 'Mobility (rushing, agility) combined with passing efficiency. Widens or narrows the error cone when throwing on the move.',
  },
  {
    key: 'underPressure',
    label: 'Under Pressure',
    base: 72,
    terms: [t('q_sack', 0.3), t('q_rate', 0.2), t(['q_int', 'q_intg'], 0.1), t('acc', 0.25), t('imp', 0.15)],
    note: 'Sack rate vs league, efficiency and honors. Error cone growth with a rusher in the lap.',
  },
  {
    key: 'release',
    label: 'Release',
    base: 72,
    terms: [t('q_sack', 0.35), t('q_cmp', 0.15), t(['q_yds', 'q_tdg'], 0.15), t('acc', 0.15), t('imp', 0.2)],
    note: 'Low sack rate is the strongest statistical trace of a quick release. Wind-up time 0.45 s at 70, 0.30 s at 99.',
  },
  {
    key: 'decision',
    label: 'Decision Making',
    base: 72,
    // Interception avoidance only: honors reward overall greatness, not decisions.
    terms: [t(['q_int', 'q_intg'], 0.5), t('q_tdint', 0.3), t('q_rate', 0.1), t('imp', 0.1)],
    note: 'Era-adjusted INT rate and TD:INT ratio. How often the QB throws into a closing window.',
  },
  {
    key: 'pocketPresence',
    label: 'Pocket Presence',
    base: 72,
    terms: [t('q_sack', 0.35), t(['q_int', 'q_intg'], 0.15), t('acc', 0.2), t('exp', 0.1), t('imp', 0.2)],
    note: 'Sack rate vs league plus honors. How the QB slides and climbs as the pocket collapses.',
  },
  {
    key: 'scramble',
    label: 'Scramble',
    base: 72,
    terms: [t('q_rush', 0.7), t('p_speed', 0.2), t('p_agility', 0.1)],
    note: 'Rushing yards per game plus speed. When and how far the QB breaks the pocket.',
  },
  {
    key: 'awareness',
    label: 'Awareness',
    base: 72,
    terms: [t('acc', 0.35), t('q_rate', 0.15), t(['q_int', 'q_intg'], 0.15), t('exp', 0.15), t('imp', 0.2)],
    note: 'Honors, efficiency and experience. Read speed: how fast the QB progresses to the open receiver.',
  },
];

// ---------------------------------------------------------------------- RB

export const RB_ATTRS: readonly SkillAttrDef[] = [
  {
    key: 'vision',
    label: 'Vision',
    base: 72,
    // "yards per carry index weighted by volume"
    terms: [t('r_ypc', 0.35), t('r_yds', 0.25), t('acc', 0.2), t('exp', 0.05), t('imp', 0.15)],
    note: 'YPC and rushing yards vs league. How early the back sees and takes the right lane.',
  },
  {
    key: 'elusiveness',
    label: 'Elusiveness',
    base: 72,
    // "A 200-pound, 5.0 yards-per-carry back leans Elusive"
    terms: [t('r_ypc', 0.3), t('p_agility', 0.25), t('p_light', 0.2), t('acc', 0.1), t('imp', 0.15)],
    note: 'YPC, agility and a lighter frame. Juke and spin success.',
  },
  {
    key: 'breakTackle',
    label: 'Break Tackle',
    base: 72,
    terms: [t('r_ypc', 0.25), t('r_yds', 0.25), t('r_car', 0.15), t('p_weight', 0.1), t('acc', 0.1), t('imp', 0.15)],
    note: 'YPC weighted by volume, workload and mass. Chance to shed an arm tackle.',
  },
  {
    key: 'trucking',
    label: 'Trucking',
    base: 72,
    // "a 245-pound back leans Trucking"
    terms: [t('p_weight', 0.55), t('r_car', 0.15), t('r_td', 0.15), t('imp', 0.15)],
    note: 'Body mass first, then workload and goal-line scoring. Wins head-on collisions against Tackle and Hit Power.',
  },
  {
    key: 'stiffArm',
    label: 'Stiff Arm',
    base: 72,
    terms: [t('p_weight', 0.25), t('p_strength', 0.15), t('r_yds', 0.2), t('r_car', 0.1), t('acc', 0.1), t('imp', 0.2)],
    note: 'Size, strength and production. Stiff-arm success against an angled tackler.',
  },
  {
    key: 'ballSecurity',
    label: 'Ball Security',
    base: 72,
    terms: [t('r_fum', 0.7), t('exp', 0.15), t('imp', 0.15)],
    note: 'Fumbles per touch. Fumble chance against Hit Power.',
  },
  {
    key: 'catching',
    label: 'Catching',
    base: 62,
    top: 93,
    terms: [t('r_recn', 0.35), t('r_rec', 0.3), t('acc', 0.1), t('p_agility', 0.1), t('imp', 0.15)],
    note: 'Receptions and receiving yards per game. Same catch model as receivers; the average back starts 10 below the average WR.',
  },
  {
    key: 'routeRunning',
    label: 'Route Running',
    base: 58,
    top: 90,
    terms: [t('r_rec', 0.35), t('r_recn', 0.25), t('p_agility', 0.15), t('acc', 0.1), t('imp', 0.15)],
    note: 'Receiving production and agility. Break sharpness on backfield routes.',
  },
  {
    key: 'passBlock',
    label: 'Pass Block',
    base: 60,
    top: 90,
    terms: [t('p_weight', 0.35), t('p_strength', 0.15), t('exp', 0.2), t('acc', 0.1), t('imp', 0.2)],
    note: 'Size, strength and experience (no pass-pro data exists). Blitz pickup success. Low confidence by design.',
  },
  {
    key: 'awareness',
    label: 'Awareness',
    base: 72,
    terms: [t('acc', 0.4), t('exp', 0.25), t('r_ypc', 0.15), t('imp', 0.2)],
    note: 'Honors, experience and efficiency. Reads blocking flow and blitzers.',
  },
];

// -------------------------------------------------------------- WR and TE

function receiverAttrs(pos: 'WR' | 'TE'): SkillAttrDef[] {
  const te = pos === 'TE';
  const list: SkillAttrDef[] = [
    {
      key: 'beatPress',
      label: 'Release',
      base: te ? 66 : 72,
      top: te ? 94 : undefined,
      terms: [t('acc', 0.25), t('w_yds', 0.2), t(['w_recn', 'w_yds'], 0.2), t('p_strength', 0.1), t('p_agility', 0.1), t('imp', 0.15)],
      note: 'Honors, volume, strength and agility. Beating press at the line.',
    },
    {
      key: 'shortRoute',
      label: 'Short Route Running',
      base: 72,
      // "catch rate, reception volume and short-area role"
      terms: [t(['w_catch', 'w_recn'], 0.3), t('w_recn', 0.3), t(['w_ypt', 'w_ypr'], 0.1), t('acc', 0.15), t('imp', 0.15)],
      note: 'Catch rate and reception volume. Separation at the break on short routes.',
    },
    {
      key: 'deepRoute',
      label: 'Deep Route Running',
      base: te ? 66 : 72,
      top: te ? 94 : undefined,
      terms: [t('w_ypr', 0.3), t(['w_ypt', 'w_ypr'], 0.2), t('w_yds', 0.2), t('acc', 0.15), t('imp', 0.15)],
      note: 'Yards per reception and per target vs league. Separation on vertical routes.',
    },
    {
      key: 'catching',
      label: 'Catching',
      base: 72,
      // "catch % where targets exist (1992 on). Before that, lean on
      // receptions per game and accolades at low confidence"
      terms: [t(['w_catch', 'w_recn'], 0.4), t('w_recn', 0.15), t(['w_ypt', 'w_yds'], 0.1), t('acc', 0.2), t('imp', 0.15)],
      note: 'Catch % vs league where targets exist, else receptions per game. Base catch probability.',
    },
    {
      key: 'catchInTraffic',
      label: 'Catch in Traffic',
      base: 72,
      // "height, TD rate (red-zone usage) and reputation"
      terms: [t('p_height', 0.2), t('w_tdrate', 0.25), t('w_recn', 0.15), t('acc', 0.15), t('p_weight', 0.1), t('imp', 0.15)],
      note: 'Height, TDs per catch and volume. Catch probability with a defender in contact.',
    },
    {
      key: 'spectacular',
      label: 'Spectacular Catch',
      base: 72,
      terms: [t('p_jump', 0.2), t('p_height', 0.15), t('w_ypr', 0.2), t('w_td', 0.15), t('acc', 0.15), t('imp', 0.15)],
      note: 'Jumping, height, big-play and TD production. One-handed, diving and high-point catches.',
    },
    {
      key: 'rac',
      label: 'Run After Catch',
      base: 72,
      terms: [t('w_ypr', 0.2), t('p_agility', 0.3), t('p_speed', 0.2), t('acc', 0.1), t('imp', 0.2)],
      note: 'Yards per reception plus agility and speed. Yards after the catch and broken-tackle chance in space.',
    },
    {
      key: 'ballSecurity',
      label: 'Ball Security',
      base: 72,
      terms: [t('r_fum', 0.7), t('exp', 0.15), t('imp', 0.15)],
      note: 'Fumbles per touch (1999 on; earlier stints regress to the average). Fumble chance against Hit Power.',
    },
    {
      key: 'runBlock',
      label: 'Run Block',
      base: te ? 72 : 50,
      top: te ? undefined : 85,
      terms: te
        ? [t('w_block', 0.4), t('p_weight', 0.25), t('p_strength', 0.15), t('acc', 0.05), t('imp', 0.15)]
        : [t('p_weight', 0.35), t('p_strength', 0.25), t('exp', 0.15), t('acc', 0.1), t('imp', 0.15)],
      note: te ? 'Legacy block grade (hand-set, low confidence), size and strength. Blocks at the point of attack.' : 'Size, strength and experience. Downfield blocks on runs and screens.',
    },
  ];
  if (te) {
    list.push(
      {
        key: 'passBlock',
        label: 'Pass Block',
        base: 66,
        top: 94,
        terms: [t('w_block', 0.35), t('p_weight', 0.3), t('p_strength', 0.1), t('exp', 0.1), t('imp', 0.15)],
        note: 'Block grade, size and experience. Chip and pass-protection wins against edge rushers.',
      },
      {
        key: 'impactBlock',
        label: 'Impact Block',
        base: 70,
        top: 97,
        terms: [t('p_weight', 0.3), t('p_strength', 0.3), t('w_block', 0.25), t('imp', 0.15)],
        note: 'Mass, strength and block grade. Pancake and seal strength on contact.',
      },
    );
  }
  list.push({
    key: 'awareness',
    label: 'Awareness',
    base: 72,
    terms: [t('acc', 0.4), t('exp', 0.25), t(['w_catch', 'w_recn'], 0.15), t('imp', 0.2)],
    note: 'Honors, experience and reliability. Coverage reads and sitting down in zone holes.',
  });
  return list;
}

export const WR_ATTRS: readonly SkillAttrDef[] = receiverAttrs('WR');
export const TE_ATTRS: readonly SkillAttrDef[] = receiverAttrs('TE');
