import { useEffect, useState } from 'react';
import { useApp } from '@/app/appStore';
import { getSettings } from '@/app/settings';
import { enterFullscreen } from '@/app/platform';
import { Audio } from '@/audio/audio';

/** Studio sting (silent: audio can't start before the first input). Any input skips. */
export function StudioIntro() {
  const go = useApp((s) => s.go);
  const setShot = useApp((s) => s.setShot);
  const sceneReady = useApp((s) => s.sceneReady);
  const progress = useApp((s) => s.bootProgress);
  const [minDone, setMinDone] = useState(false);

  useEffect(() => {
    setShot('title');
    const t = setTimeout(() => setMinDone(true), 5200);
    const skip = () => {
      Audio.unlock(); // a keypress is a user gesture: take the chance
      setMinDone(true);
    };
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('mousedown', skip, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('mousedown', skip);
    };
  }, [setShot]);

  useEffect(() => {
    if (minDone && sceneReady) go('title');
  }, [minDone, sceneReady, go]);

  return (
    <div className="studio-intro">
      <div className="studio-mark">
        <svg viewBox="0 0 120 120" className="studio-claw" aria-hidden>
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M${34 + i * 22} 18 C ${46 + i * 22} 46, ${44 + i * 22} 78, ${30 + i * 22} 104`} style={{ animationDelay: `${0.25 + i * 0.18}s` }} />
          ))}
        </svg>
        <div className="studio-name">COMFORTABLE CAVE</div>
        <div className="studio-sub">Interactive</div>
      </div>
      <div className="boot-bar">
        <span style={{ transform: `scaleX(${sceneReady ? 1 : Math.max(0.08, progress)})` }} />
      </div>
    </div>
  );
}

/** "Press any key" over the live flyover. The press unlocks audio and requests fullscreen. */
export function TitleScreen() {
  const go = useApp((s) => s.go);
  const setShot = useApp((s) => s.setShot);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setShot('title');
    let armed = false;
    const arm = setTimeout(() => (armed = true), 400); // ignore the key that skipped the intro
    const press = (e: Event) => {
      if (!armed || leaving) return;
      if (e instanceof KeyboardEvent && ['Tab', 'Alt', 'Meta', 'Control', 'Shift'].includes(e.key)) return;
      Audio.unlock();
      Audio.titleSting();
      Audio.startAmbient();
      if (getSettings().display.fullscreen) void enterFullscreen();
      setLeaving(true);
      setTimeout(() => go('main'), 650);
    };
    window.addEventListener('keydown', press);
    window.addEventListener('mousedown', press);
    // Any gamepad button counts too.
    let raf = 0;
    const poll = () => {
      const pads = navigator.getGamepads?.() ?? [];
      if (pads.some((p) => p?.buttons.some((b) => b.pressed))) press(new Event('gamepad'));
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      clearTimeout(arm);
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', press);
      window.removeEventListener('mousedown', press);
    };
  }, [go, setShot, leaving]);

  return (
    <div className={`title-screen ${leaving ? 'leaving' : ''}`}>
      <div className="title-logo">
        <div className="title-kicker">The Contenders vs</div>
        <h1 className="title-word">
          <span>Beat the</span>
          <span className="title-beasts">Beasts</span>
        </h1>
      </div>
      <div className="press-any">Press any key</div>
      <div className="title-foot">Independent project · not affiliated with the NFL</div>
    </div>
  );
}
