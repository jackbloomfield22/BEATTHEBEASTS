// Name normalization for matching legacy names to nflverse people.

import { NICKNAME_GROUPS } from './aliases.ts';

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/**
 * Canonical matching form: lower case, diacritics stripped, periods and
 * apostrophes dropped ("A.J." → "aj", "Ja'Marr" → "jamarr"), hyphens and
 * other punctuation as spaces, generational suffixes removed.
 */
export function normName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const parts = base.split(' ').filter((p) => p !== '');
  while (parts.length > 2 && SUFFIXES.has(parts[parts.length - 1] ?? '')) parts.pop();
  return parts.join(' ');
}

/** Same as normName but with hyphenated/compound parts joined ("Smith-Njigba" → "smithnjigba"). */
export function squashName(name: string): string {
  return normName(name).replace(/ /g, '');
}

/** URL-ish slug, matching the style of the legacy ids. */
export function slug(name: string): string {
  return normName(name).replace(/ /g, '-');
}

const NICK_CANON = new Map<string, string>();
for (const group of NICKNAME_GROUPS) {
  const canon = group[0];
  if (canon === undefined) continue;
  for (const n of group) NICK_CANON.set(n, canon);
}

/** First name folded to its nickname group ("jimbo", "jimmy", "james" → "jim"). */
export function canonFirst(first: string): string {
  return NICK_CANON.get(first) ?? first;
}

/** Last-name key plus nickname-folded first name, for the looser alias pass. */
export function looseKey(name: string): string {
  const parts = normName(name).split(' ');
  if (parts.length < 2) return parts.join(' ');
  const first = parts[0] ?? '';
  // Middle initials are dropped ("Robert E. Jackson" → "bob jackson").
  const rest = parts.slice(1);
  const last = (rest.length > 1 ? rest.filter((p) => p.length > 1) : rest).join('');
  return `${canonFirst(first)} ${last}`;
}
