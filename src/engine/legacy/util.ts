// Small numeric helpers, ported verbatim from legacy/beat-the-beasts.jsx:
// round1/pct 4178–4179, clampN 4290, eraEquiv 4294–4297, ratio 4827,
// bestBy 4923. Legacy Math.pow is kept on purpose (bit-identical to legacy on
// the same JS engine; see TECH_PLAN §4.4).

import { ERA_BASE, DEF_ERA_BASE, REF_ERA } from '@data/legacy/tables';
import type { DefEraBase, EraBase } from '@data/legacy/types';

export const round1 = (x: number): number => Math.round(x * 10) / 10;
export const pct = (x: number): number => Math.round(x);

export const clampN = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/**
 * Convert a raw era stat into modern-equivalent production. The compression
 * exponent (<1) keeps extreme outliers from exploding while preserving dominance.
 */
export const eraEquiv = (raw: number | null | undefined, base: number | null | undefined, ref: number, compress = 0.85): number => {
  if (!base || raw == null) return ref;
  return ref * Math.pow(Math.max(0.05, raw / base), compress);
};

export const ratio = (raw: number, base: number): number => (base > 0 ? raw / base : 1);

export const bestBy = <T, K extends keyof T>(arr: readonly T[], key: K): T[] =>
  [...arr].sort((a, b) => (b[key] as unknown as number) - (a[key] as unknown as number));

/** ERA_BASE / DEF_ERA_BASE indexable by any decade string (missing → undefined, as in legacy). */
export const ERA: Readonly<Record<string, EraBase | undefined>> = ERA_BASE;
export const DEF_ERA: Readonly<Record<string, DefEraBase | undefined>> = DEF_ERA_BASE;

/** Legacy `REF = ERA_BASE[REF_ERA]` (4168). */
export const REF: EraBase = ERA_BASE[REF_ERA] as EraBase;
