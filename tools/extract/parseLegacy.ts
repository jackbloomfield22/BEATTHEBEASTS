// Parses legacy/beat-the-beasts.jsx with @babel/parser and evaluates the
// top-level pure-literal `const` declarations in isolation (no code is run).
//
// Shared by the extractor (tools/extract/extract-legacy.ts), the data
// validation report (tools/reports/validate-data.ts) and the drift test
// (tests/data-drift.test.ts), so all three read the legacy file the same way.
//
// Must stay runnable under `node --experimental-strip-types`: erasable TS only,
// `.ts` extensions on relative imports.

import { parse } from '@babel/parser';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LEGACY_PATH = fileURLToPath(new URL('../../legacy/beat-the-beasts.jsx', import.meta.url));

/** The constants the extractor emits. Each must be a pure literal in legacy. */
export const EXTRACTED_CONSTANTS = [
  'PLAYERS', 'DEFENSE', 'UNITS', 'YEAR_DEFENSES',
  'ERA_BASE', 'DEF_ERA_BASE', 'LEAGUE_AVG_PA', 'SCORE_K', 'REF_ERA',
  'TEAM_COLORS', 'TEAM_NICKS', 'SKIN_TONES', 'POS_HEX', 'DECADE_HEX', 'C',
  'DECADES', 'SLOT_ORDER', 'POSITIONS', 'ROUNDS', 'NUM_DRIVES', 'TEAM_NAME',
] as const;
export type ExtractedName = (typeof EXTRACTED_CONSTANTS)[number];

export type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal };

export interface LegacyParse {
  /** SHA-256 (hex) of the legacy file bytes. */
  sha256: string;
  /** Every top-level const whose initializer is a pure literal, evaluated. */
  constants: Record<string, Literal>;
  /** 1-based source line of each evaluated constant's declaration. */
  lines: Record<string, number>;
}

interface Node {
  type: string;
  [key: string]: unknown;
}

class NotLiteral extends Error {}

function evalLiteral(node: Node): Literal {
  switch (node.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value as string | number | boolean;
    case 'NullLiteral':
      return null;
    case 'UnaryExpression': {
      const arg = evalLiteral(node.argument as Node);
      if (typeof arg !== 'number') throw new NotLiteral('unary on non-number');
      if (node.operator === '-') return -arg;
      if (node.operator === '+') return +arg;
      throw new NotLiteral(`unary ${String(node.operator)}`);
    }
    case 'TemplateLiteral': {
      const exprs = node.expressions as Node[];
      const quasis = node.quasis as { value: { cooked: string } }[];
      if (exprs.length !== 0 || quasis.length !== 1 || !quasis[0]) throw new NotLiteral('template with expressions');
      return quasis[0].value.cooked;
    }
    case 'ArrayExpression': {
      const out: Literal[] = [];
      for (const el of node.elements as (Node | null)[]) {
        if (!el || el.type === 'SpreadElement') throw new NotLiteral('hole/spread in array');
        out.push(evalLiteral(el));
      }
      return out;
    }
    case 'ObjectExpression': {
      const out: { [key: string]: Literal } = {};
      for (const prop of node.properties as Node[]) {
        if (prop.type !== 'ObjectProperty' || prop.computed) throw new NotLiteral(`object member ${prop.type}`);
        const key = prop.key as Node;
        let name: string;
        if (key.type === 'Identifier') name = key.name as string;
        else if (key.type === 'StringLiteral' || key.type === 'NumericLiteral') name = String(key.value);
        else throw new NotLiteral(`key ${key.type}`);
        if (Object.prototype.hasOwnProperty.call(out, name)) throw new Error(`duplicate key ${name} in object literal`);
        out[name] = evalLiteral(prop.value as Node);
      }
      return out;
    }
    default:
      throw new NotLiteral(node.type);
  }
}

export function parseLegacySource(source: string): LegacyParse {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const constants: Record<string, Literal> = {};
  const lines: Record<string, number> = {};
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'VariableDeclaration' || stmt.kind !== 'const') continue;
    for (const decl of stmt.declarations) {
      if (decl.id.type !== 'Identifier' || !decl.init) continue;
      try {
        constants[decl.id.name] = evalLiteral(decl.init as unknown as Node);
        lines[decl.id.name] = decl.loc?.start.line ?? -1;
      } catch (e) {
        if (!(e instanceof NotLiteral)) throw e;
      }
    }
  }
  for (const name of EXTRACTED_CONSTANTS) {
    if (!(name in constants)) throw new Error(`legacy constant ${name} not found or not a pure literal`);
  }
  const sha256 = createHash('sha256').update(source, 'utf8').digest('hex');
  return { sha256, constants, lines };
}

export function parseLegacyFile(path: string = LEGACY_PATH): LegacyParse {
  const buf = readFileSync(path);
  const parsed = parseLegacySource(buf.toString('utf8'));
  // Hash the raw bytes (identical to hashing the utf8 string for valid utf8).
  parsed.sha256 = createHash('sha256').update(buf).digest('hex');
  return parsed;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** Lowercase ASCII slug: diacritics stripped, runs of non-alphanumerics → '-'. */
export function slug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface NaturalKeyed {
  n: string;
  t: string;
  d: string;
}

/**
 * Natural key of an entry. Players and defenders are identified by
 * name+team+decade (unique in legacy). A unit is identified by its
 * team+decade (the draft pool it belongs to): legacy has two TEN 1990s OL
 * units under different names ("Tennessee Titans", "Tennessee Oilers/Titans").
 */
export type NaturalKeyKind = 'person' | 'unit';

export function naturalKey(kind: NaturalKeyKind, e: NaturalKeyed): string {
  return kind === 'unit' ? `${e.t}|${e.d}` : `${e.n}|${e.t}|${e.d}`;
}

/**
 * Stable id per entry: `<dataset>:<slug(name)>:<team>:<decade>`, with `~2`,
 * `~3`… appended (in legacy array order) when the natural key repeats.
 */
export function makeIds(dataset: string, kind: NaturalKeyKind, entries: readonly NaturalKeyed[]): string[] {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return entries.map((e) => {
    const nk = naturalKey(kind, e);
    const count = (seen.get(nk) ?? 0) + 1;
    seen.set(nk, count);
    const base = `${dataset}:${slug(e.n)}:${e.t}:${e.d}`;
    const id = count === 1 ? base : `${base}~${count}`;
    if (used.has(id)) throw new Error(`id collision: ${id}`);
    used.add(id);
    return id;
  });
}

/** Dataset names used in ids and in data/legacy/ids.json. */
export const ID_DATASETS = {
  players: 'players',
  defense: 'defense',
  olUnits: 'ol-units',
  defUnits: 'def-units',
} as const;

// ---------------------------------------------------------------------------
// Canonical serialization (used for dataset hashes)
// ---------------------------------------------------------------------------

/** JSON with object keys sorted recursively; numbers/strings as JSON.stringify prints them. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite number');
    if (Object.is(value, -0)) return '-0';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Removes the fields the extractor adds (id, legacyIndex) from each entry. */
export function stripAdded<T extends object>(entries: readonly T[]): Record<string, unknown>[] {
  return entries.map((e) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) if (k !== 'id' && k !== 'legacyIndex') out[k] = v;
    return out;
  });
}
