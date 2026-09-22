// Skin-tone (characterization) assignments. Source of truth is
// data/characterization.json in the repo, edited through the in-game editor
// (Settings → Characterization). Keyed by person key (name for now; person ids
// replace names once data/people.json lands in milestone 2).

export const SKIN_TONE_COUNT = 5;

export interface CharacterizationEntry {
  skin: number; // index into SKIN_TONES (0 = lightest … 4 = deepest)
}

export interface CharacterizationFile {
  version: 1;
  entries: Record<string, CharacterizationEntry>;
}

export function emptyCharacterization(): CharacterizationFile {
  return { version: 1, entries: {} };
}

/** Validates and normalizes (sorted keys, so diffs in the repo stay small). */
export function validateCharacterization(input: unknown): CharacterizationFile {
  if (!input || typeof input !== 'object') throw new Error('characterization: not an object');
  const obj = input as { version?: unknown; entries?: unknown };
  if (obj.version !== 1) throw new Error('characterization: unsupported version');
  if (!obj.entries || typeof obj.entries !== 'object') throw new Error('characterization: missing entries');
  const out: Record<string, CharacterizationEntry> = {};
  for (const key of Object.keys(obj.entries as object).sort()) {
    const e = (obj.entries as Record<string, unknown>)[key] as { skin?: unknown } | undefined;
    const skin = e?.skin;
    if (typeof key !== 'string' || key.length === 0 || key.length > 120) throw new Error(`characterization: bad key ${key}`);
    if (typeof skin !== 'number' || !Number.isInteger(skin) || skin < 0 || skin >= SKIN_TONE_COUNT) {
      throw new Error(`characterization: bad skin for ${key}`);
    }
    out[key] = { skin };
  }
  return { version: 1, entries: out };
}
