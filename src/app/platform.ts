// Fullscreen, keyboard lock and device checks.

type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };

export const isFullscreen = (): boolean => !!document.fullscreenElement;

/**
 * Enter fullscreen (must be called from a user gesture). On Chromium, also
 * lock Escape so it reaches the game (pause); holding Esc still exits
 * fullscreen, which is the browser's own escape hatch. Safari has no keyboard
 * lock, so there Esc leaves fullscreen and the game auto-pauses instead
 * (GDD §15 D6).
 */
export async function enterFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const kb = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    await kb?.lock?.(['Escape', 'F1', 'F2', 'F3', 'Tab']).catch(() => undefined);
  } catch {
    /* denied (iframe, user setting): the game still runs windowed */
  }
}

export async function exitFullscreen(): Promise<void> {
  try {
    (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard?.unlock?.();
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}

export function onFullscreenChange(cb: (fs: boolean) => void): () => void {
  const h = () => cb(isFullscreen());
  document.addEventListener('fullscreenchange', h);
  return () => document.removeEventListener('fullscreenchange', h);
}

/** Phones and tablets get the "built for keyboard and mouse" screen. */
export function isUnsupportedDevice(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.has('forceDesktop')) return false;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const noFine = !matchMedia('(any-pointer: fine)').matches;
  const small = Math.min(screen.width, screen.height) < 600;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && noFine);
  return (coarse && noFine) || (mobileUA && (small || noFine));
}

export function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export const urlFlags = (() => {
  const p = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  return {
    dev: p.has('dev'),
    perf: p.has('perf'),
    seed: p.get('seed'),
    shot: p.get('shot'), // screenshot harness: jump straight to a named state
    lighting: p.get('lighting'),
    quality: p.get('quality'),
    noIntro: p.has('nointro'),
    // Fixed camera for screenshots and dev: x,y,z,lookX,lookY,lookZ[,fov].
    cam: p.get('cam')?.split(',').map(Number) ?? null,
    // Ambient crowd energy 0..1 (screenshots of a quiet or a rocking bowl).
    crowd: p.has('crowd') ? Number(p.get('crowd')) : null,
    shotTime: p.has('t') ? Number(p.get('t')) : null, // freeze the cinematic clock (screenshots)
  };
})();
