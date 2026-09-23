import type { RatedPos } from '../types';
import { DEF_ATTRS, OL_ATTRS } from './linemenAndDefense';
import { QB_ATTRS, RB_ATTRS, TE_ATTRS, WR_ATTRS } from './offense';
import type { SkillAttrDef } from './types';

export * from './types';

export const SKILL_ATTRS: Record<RatedPos, readonly SkillAttrDef[]> = {
  QB: QB_ATTRS,
  RB: RB_ATTRS,
  WR: WR_ATTRS,
  TE: TE_ATTRS,
  OL: OL_ATTRS,
  ...DEF_ATTRS,
};

/** Physical attributes shown per position (all are computed for everyone). */
export const PHYSICAL_BY_POS: Record<RatedPos, readonly string[]> = {
  QB: ['speed', 'acceleration', 'agility', 'strength', 'stamina'],
  RB: ['speed', 'acceleration', 'agility', 'strength', 'stamina'],
  WR: ['speed', 'acceleration', 'agility', 'strength', 'stamina', 'jumping'],
  TE: ['speed', 'acceleration', 'agility', 'strength', 'stamina', 'jumping'],
  OL: ['speed', 'acceleration', 'agility', 'strength', 'stamina'],
  DE: ['speed', 'acceleration', 'agility', 'strength', 'stamina'],
  DT: ['speed', 'acceleration', 'agility', 'strength', 'stamina'],
  LB: ['speed', 'acceleration', 'agility', 'strength', 'stamina'],
  // DBs contest catches at the high point, so jumping drives play for them too.
  CB: ['speed', 'acceleration', 'agility', 'strength', 'stamina', 'jumping'],
  S: ['speed', 'acceleration', 'agility', 'strength', 'stamina', 'jumping'],
};

export function attrLabel(pos: RatedPos, key: string): string {
  const def = SKILL_ATTRS[pos].find((d) => d.key === key);
  if (def) return def.label;
  return key.charAt(0).toUpperCase() + key.slice(1);
}
