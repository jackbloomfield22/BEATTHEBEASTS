// Corrections layer (BRIEF "Never edit legacy values in place"). Legacy data
// stays byte-identical; fixes are records in data/corrections.json applied at
// load time. A correction whose `old` value doesn't match the legacy value is
// rejected, so a correction can never silently apply to the wrong thing.

export type CorrectionOp = 'set' | 'delete' | 'exclude';

export interface Correction {
  /** Legacy entry id (data/legacy/ids.json). */
  id: string;
  op: CorrectionOp;
  /** Dotted path within the entry, e.g. "s.c". Omitted for `exclude`. */
  field?: string;
  old?: unknown;
  new?: unknown;
  reason: string;
  source: string;
  conf: 'verified' | 'reference' | 'estimated';
}

export interface CorrectionsFile {
  version: 1;
  corrections: Correction[];
}

export interface AppliedCorrection extends Correction {
  name: string;
}

interface Entry {
  id: string;
  n: string;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown, del: boolean): void {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    o[k] = { ...(o[k] as Record<string, unknown>) };
    o = o[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1]!;
  if (del) delete o[last];
  else o[last] = value;
}

/**
 * Apply corrections to a list of legacy entries. Returns corrected copies
 * (legacy objects are never mutated), the ids excluded from rating pools, and
 * the list of corrections applied (for RATINGS_REPORT.md).
 */
export function applyCorrections<T extends Entry>(
  entries: readonly T[],
  file: CorrectionsFile,
): { entries: T[]; excluded: Set<string>; applied: AppliedCorrection[] } {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const patched = new Map<string, T>();
  const excluded = new Set<string>();
  const applied: AppliedCorrection[] = [];
  for (const c of file.corrections) {
    const base = byId.get(c.id);
    if (!base) continue; // correction targets another dataset
    if (c.op === 'exclude') {
      excluded.add(c.id);
      applied.push({ ...c, name: base.n });
      continue;
    }
    if (!c.field) throw new Error(`correction for ${c.id}: missing field`);
    const current = patched.get(c.id) ?? base;
    const was = getPath(base, c.field);
    if (JSON.stringify(was) !== JSON.stringify(c.old)) {
      throw new Error(`correction for ${c.id} ${c.field}: expected old value ${JSON.stringify(c.old)}, legacy has ${JSON.stringify(was)}`);
    }
    const copy = structuredClone(current) as unknown as Record<string, unknown>;
    setPath(copy, c.field, c.new, c.op === 'delete');
    patched.set(c.id, copy as unknown as T);
    applied.push({ ...c, name: base.n });
  }
  return { entries: entries.map((e) => patched.get(e.id) ?? e), excluded, applied };
}

export function validateCorrectionsFile(input: unknown): CorrectionsFile {
  const f = input as CorrectionsFile;
  if (!f || f.version !== 1 || !Array.isArray(f.corrections)) throw new Error('corrections: bad file');
  for (const c of f.corrections) {
    if (!c.id || !c.op || !c.reason || !c.source || !c.conf) throw new Error(`corrections: incomplete record ${JSON.stringify(c)}`);
    if (!['set', 'delete', 'exclude'].includes(c.op)) throw new Error(`corrections: bad op ${c.op}`);
    if (c.op !== 'exclude' && !c.field) throw new Error(`corrections: ${c.id} needs a field`);
  }
  return f;
}
