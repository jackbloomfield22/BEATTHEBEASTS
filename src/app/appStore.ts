import { create } from 'zustand';

// App-level state machine (TECH_PLAN §4.2). Game states arrive in later
// milestones; the 3D scene persists across every state.

export type Screen = 'intro' | 'title' | 'main' | 'settings' | 'characterization' | 'howto' | 'practice' | 'draft' | 'game' | 'results' | 'history';

/** Named camera shots the persistent scene can fly between. */
export type CameraShot = 'intro' | 'title' | 'menu' | 'daily' | 'practice' | 'settings' | 'history' | 'characterization';

interface AppState {
  screen: Screen;
  history: Screen[];
  shot: CameraShot;
  sceneReady: boolean;
  bootProgress: number; // 0..1
  perfOpen: boolean;
  toast: { id: number; text: string } | null;
  go: (s: Screen) => void;
  back: () => void;
  setShot: (s: CameraShot) => void;
  setSceneReady: () => void;
  setBootProgress: (p: number) => void;
  togglePerf: () => void;
  showToast: (text: string) => void;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  screen: 'intro',
  history: [],
  shot: 'intro',
  sceneReady: false,
  bootProgress: 0,
  perfOpen: false,
  toast: null,
  go: (s) => set({ screen: s, history: [...get().history, get().screen] }),
  back: () => {
    const h = [...get().history];
    const prev = h.pop();
    if (prev && prev !== 'intro' && prev !== 'title') set({ screen: prev, history: h });
    else set({ screen: 'main', history: [] });
  },
  setShot: (shot) => {
    if (get().shot !== shot) set({ shot });
  },
  setSceneReady: () => set({ sceneReady: true, bootProgress: 1 }),
  setBootProgress: (p) => set({ bootProgress: Math.max(get().bootProgress, p) }),
  togglePerf: () => set({ perfOpen: !get().perfOpen }),
  showToast: (text) => {
    const id = ++toastId;
    set({ toast: { id, text } });
    setTimeout(() => get().toast?.id === id && set({ toast: null }), 2600);
  },
}));
