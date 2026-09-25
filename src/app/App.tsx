import { useCallback, useEffect, useRef, useState } from 'react';
import { Stage } from '@/render/Stage';
import { initSettings, defaultSettings, useSettings, getSettings, type QualityPreset } from './settings';
import { defaultBindings } from '@/input/actions';
import { Input } from '@/input/InputManager';
import { useApp, type CameraShot, type Screen } from './appStore';
import { enterFullscreen, exitFullscreen, hasWebGL2, isFullscreen, isUnsupportedDevice, onFullscreenChange, urlFlags } from './platform';
import { Audio } from '@/audio/audio';
import { StudioIntro, TitleScreen } from '@/ui/screens/IntroTitle';
import { MainMenu } from '@/ui/screens/MainMenu';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { HowToScreen } from '@/ui/screens/HowToScreen';
import { CharacterizationScreen } from '@/ui/screens/CharacterizationScreen';
import { PracticeScreen } from '@/ui/screens/PracticeScreen';
import { DraftScreen } from '@/ui/screens/DraftScreen';
import { FpsCounter, PerfScreen } from '@/dev/PerfOverlay';
import { AppBoundary, StageBoundary } from './Recovery';
import '@/ui/styles/menus.css';

initSettings(() => defaultSettings(defaultBindings('kb'), defaultBindings('pad')));

// Screenshot / dev harness: ?shot=<camera shot>&screen=<screen> jumps straight in.
if (urlFlags.shot) useApp.setState({ shot: urlFlags.shot as CameraShot });
const screenParam = new URLSearchParams(location.search).get('screen') as Screen | null;
if (screenParam) useApp.setState({ screen: screenParam });
else if (urlFlags.noIntro || getSettings().gameplay.skipIntros) useApp.setState({ screen: 'title' });
if (urlFlags.perf) useApp.setState({ perfOpen: true });
if (urlFlags.quality && ['low', 'medium', 'high', 'ultra'].includes(urlFlags.quality)) {
  useSettings.getState().applyPreset(urlFlags.quality as QualityPreset);
}

// Dev handles for the browser tests (e2e/) and the console.
if (import.meta.env.DEV) Object.assign(window, { __btbSettings: useSettings, __btbApp: useApp });

useApp.subscribe((s) => {
  if (s.sceneReady) (window as unknown as { __btbReady?: boolean }).__btbReady = true;
});

/** Push settings into the systems that consume them. */
function useSettingsEffects() {
  const settings = useSettings((s) => s.settings);
  useEffect(() => {
    Input.setBindings(settings.controls.keyboard, settings.controls.gamepad);
  }, [settings.controls.keyboard, settings.controls.gamepad]);
  useEffect(() => {
    Audio.setVolumes(settings.audio);
  }, [settings.audio]);
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.accessibility.uiScale));
  }, [settings.accessibility.uiScale]);
  useEffect(() => {
    const vis = () => settings.audio.muteUnfocused && Audio.setSuspended(document.hidden);
    const blur = () => settings.audio.muteUnfocused && Audio.setSuspended(true);
    const focus = () => Audio.setSuspended(false);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
    };
  }, [settings.audio.muteUnfocused]);
}

const QUALITY_ORDER: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/**
 * Keep the 3D stage alive: remount it after a renderer error or a lost WebGL
 * context (GPU reset, driver timeout), and step the preset down a tier if it
 * keeps failing, so the menus never sit over a dead black canvas.
 */
function useStageRecovery() {
  const [key, setKey] = useState(0);
  const recent = useRef<number[]>([]);
  const remount = useCallback((why: string) => {
    const now = performance.now();
    recent.current = [...recent.current.filter((t) => now - t < 60_000), now];
    const st = useSettings.getState();
    const preset = st.settings.graphics.preset;
    if (recent.current.length >= 2 && preset !== 'custom' && preset !== 'low') {
      const lower = QUALITY_ORDER[QUALITY_ORDER.indexOf(preset) - 1]!;
      st.applyPreset(lower);
      useApp.getState().showToast(`${why}. Graphics lowered to ${lower[0]!.toUpperCase()}${lower.slice(1)}.`);
    } else {
      useApp.getState().showToast(`${why}. Restarting the renderer.`);
    }
    setKey((k) => k + 1);
  }, []);
  const onCrash = useCallback(() => setTimeout(() => remount('The renderer hit an error'), 250), [remount]);
  const onContextLost = useCallback(
    (canvas: HTMLCanvasElement) => {
      // Give the browser a moment to restore the context, then rebuild the
      // stage on a fresh canvas either way (three can't rebuild every GPU
      // resource in place).
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        remount('The graphics device was reset');
      };
      canvas.addEventListener('webglcontextrestored', go, { once: true });
      setTimeout(go, 1500);
    },
    [remount],
  );
  return { key, onCrash, onContextLost };
}

/** The fullscreen keybind (F11 by default, or Alt+Enter). */
function toggleFullscreen(): void {
  const on = !isFullscreen();
  useSettings.getState().set((d) => void (d.display.fullscreen = on));
  void (on ? enterFullscreen() : exitFullscreen());
}

export function App() {
  const [gate] = useState(() => (isUnsupportedDevice() ? 'device' : !hasWebGL2() ? 'webgl' : null));
  if (gate === 'device') return <DesktopGate />;
  if (gate === 'webgl') return <NoWebGL />;
  return (
    <AppBoundary>
      <Game />
    </AppBoundary>
  );
}

function Game() {
  const screen = useApp((s) => s.screen);
  const toast = useApp((s) => s.toast);
  const togglePerf = useApp((s) => s.togglePerf);
  const stage = useStageRecovery();
  useSettingsEffects();

  useEffect(() => {
    Input.start();
    return Input.onAction((id, info) => {
      if (id === 'global.perf') togglePerf();
      if (id === 'global.fullscreen' && !info.repeat) toggleFullscreen();
    });
  }, [togglePerf]);

  useEffect(() => {
    // Alt+Enter, the other PC convention (not rebindable: it's a chord).
    const altEnter = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'Enter' && !e.repeat) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', altEnter, { capture: true });
    // Keep the Display setting in step when the browser leaves fullscreen
    // on its own (held Esc, F11 in the browser, a window manager).
    const off = onFullscreenChange((fs) => {
      if (getSettings().display.fullscreen !== fs) useSettings.getState().set((d) => void (d.display.fullscreen = fs));
    });
    return () => {
      window.removeEventListener('keydown', altEnter, { capture: true });
      off();
    };
  }, []);

  return (
    <>
      <StageBoundary key={stage.key} onCrash={stage.onCrash}>
        <Stage onContextLost={stage.onContextLost} />
      </StageBoundary>
      <div className="ui-root">
        {screen === 'intro' ? <StudioIntro /> : null}
        {screen === 'title' ? <TitleScreen /> : null}
        {screen === 'main' ? <MainMenu /> : null}
        {screen === 'settings' ? <SettingsScreen /> : null}
        {screen === 'howto' ? <HowToScreen /> : null}
        {screen === 'characterization' ? <CharacterizationScreen /> : null}
        {screen === 'practice' ? <PracticeScreen /> : null}
        {screen === 'draft' ? <DraftScreen /> : null}
        {toast ? (
          <div className="toast" key={toast.id}>
            {toast.text}
          </div>
        ) : null}
        <FpsCounter />
        <PerfScreen />
      </div>
    </>
  );
}

function DesktopGate() {
  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="gate-logo">
          <span>Beat the</span>
          <span className="gate-beasts">Beasts</span>
        </div>
        <p className="gate-text">Beat the Beasts is built for keyboard and mouse or a controller.</p>
        <p className="gate-sub">Open it on a desktop or laptop to play.</p>
        <a className="gate-link" href="?forceDesktop">Continue anyway</a>
      </div>
    </div>
  );
}

function NoWebGL() {
  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="gate-logo">
          <span>Beat the</span>
          <span className="gate-beasts">Beasts</span>
        </div>
        <p className="gate-text">This browser can't start the 3D renderer (WebGL 2 is unavailable or disabled).</p>
        <p className="gate-sub">Use a current version of Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is turned on.</p>
      </div>
    </div>
  );
}
