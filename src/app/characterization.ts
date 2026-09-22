import { create } from 'zustand';
import bundled from '@data/characterization.json';
import { emptyCharacterization, validateCharacterization, type CharacterizationFile } from '@/engine/data/characterizationSchema';
import { SKIN_TONES } from '@data/legacy';
import { loadJSON, saveJSON } from './storage';

// Skin-tone assignments. The source of truth is data/characterization.json in
// the repo (bundled into every build). The editor saves back to that file:
//  - `npm run dev`: the dev server writes the file directly;
//  - deployed: api/characterization.ts commits it via the GitHub API (needs
//    the EDITOR_KEY the owner configured in Vercel).
// Nothing is kept in browser storage except the editor key itself.

export const DEFAULT_SKIN = '#b07a4a'; // legacy fallback tone (skinHexFor)

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error' | 'needs-key' | 'unavailable'; message?: string };

interface CharStore {
  file: CharacterizationFile;
  dirty: boolean;
  save: SaveState;
  setSkin: (key: string, skin: number | null) => void;
  refresh: () => Promise<void>;
  persist: (editorKey?: string) => Promise<void>;
  importFile: (data: unknown) => void;
}

const initial = (() => {
  try {
    return validateCharacterization(bundled);
  } catch {
    return emptyCharacterization();
  }
})();

export const EDITOR_KEY_STORAGE = 'editorKey';

export const useCharacterization = create<CharStore>((set, get) => ({
  file: initial,
  dirty: false,
  save: { status: 'idle' },
  setSkin: (key, skin) => {
    const entries = { ...get().file.entries };
    if (skin === null) delete entries[key];
    else entries[key] = { skin };
    set({ file: { version: 1, entries }, dirty: true, save: { status: 'idle' } });
  },
  refresh: async () => {
    // Pick up edits committed since this build was made.
    try {
      const res = await fetch('/api/characterization', { cache: 'no-store' });
      if (!res.ok) return;
      const data = validateCharacterization(await res.json());
      if (!get().dirty) set({ file: data });
    } catch {
      /* offline or no API: the bundled file stands */
    }
  },
  persist: async (editorKey) => {
    set({ save: { status: 'saving' } });
    const key = editorKey ?? loadJSON<string>(EDITOR_KEY_STORAGE) ?? '';
    try {
      const res = await fetch('/api/characterization', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-editor-key': key },
        body: JSON.stringify(get().file),
      });
      if (res.status === 401) {
        set({ save: { status: 'needs-key', message: 'Enter the editor key to save to the game data.' } });
        return;
      }
      if (res.status === 404 || res.status === 501) {
        set({ save: { status: 'unavailable', message: 'Saving is not configured on this deployment. Export the file instead.' } });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; mode?: string; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (editorKey) saveJSON(EDITOR_KEY_STORAGE, editorKey);
      set({
        dirty: false,
        save: { status: 'saved', message: body.mode === 'dev-file' ? 'Saved to data/characterization.json.' : 'Committed to the repo. The next deploy includes it.' },
      });
    } catch (e) {
      set({ save: { status: 'error', message: `Save failed: ${(e as Error).message}` } });
    }
  },
  importFile: (data) => {
    const incoming = validateCharacterization(data);
    set({ file: { version: 1, entries: { ...get().file.entries, ...incoming.entries } }, dirty: true });
  },
}));

export function skinHexFor(personKey: string): string {
  const e = useCharacterization.getState().file.entries[personKey];
  return e ? SKIN_TONES[e.skin]?.hex ?? DEFAULT_SKIN : DEFAULT_SKIN;
}
