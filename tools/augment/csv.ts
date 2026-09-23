// Minimal RFC 4180 CSV reader for the nflverse files (no npm dependency).
//
// Handles quoted fields with embedded commas, doubled quotes and newlines,
// CRLF or LF line endings, and a trailing newline. nflverse writes plain
// UTF-8 CSV with a header row, which is all this needs to support.

import { readFileSync } from 'node:fs';

export interface Csv {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Column index by name; throws for a missing column so schema drift fails loudly. */
  col(name: string): number;
  /** Column index by name, or -1 when absent. */
  has(name: string): number;
}

export function parseCsv(text: string): Csv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  const n = text.length;
  let inQuotes = false;
  while (i < n) {
    const ch = text.charCodeAt(i);
    if (inQuotes) {
      if (ch === 34 /* " */) {
        if (text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      // Copy a run of non-quote characters at once.
      const next = text.indexOf('"', i);
      const end = next === -1 ? n : next;
      field += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === 34) {
      inQuotes = true;
      i++;
    } else if (ch === 44 /* , */) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === 10 /* \n */ || ch === 13 /* \r */) {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += ch === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    } else {
      // Copy a run of plain characters up to the next delimiter.
      let j = i + 1;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 44 || c === 10 || c === 13 || c === 34) break;
        j++;
      }
      field += text.slice(i, j);
      i = j;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  const index = new Map<string, number>();
  header.forEach((h, k) => index.set(h, k));
  return {
    header,
    rows,
    col(name: string): number {
      const k = index.get(name);
      if (k === undefined) throw new Error(`CSV column "${name}" missing (have: ${header.join(', ')})`);
      return k;
    },
    has(name: string): number {
      return index.get(name) ?? -1;
    },
  };
}

export function readCsv(path: string): Csv {
  return parseCsv(readFileSync(path, 'utf8'));
}

/** Parse a numeric cell; empty or "NA" → null. */
export function num(cell: string | undefined): number | null {
  if (cell === undefined || cell === '' || cell === 'NA') return null;
  const v = Number(cell);
  return Number.isFinite(v) ? v : null;
}

/** Parse a string cell; empty or "NA" → null. */
export function str(cell: string | undefined): string | null {
  if (cell === undefined || cell === '' || cell === 'NA') return null;
  return cell;
}
