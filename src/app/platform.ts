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

/**
 * A ?video recording's game time: the frames the recorder asked for, 1/N s
 * each (Stage's __btbRenderFrame counts them and hands R3F's clock `t`).
 * Everything that steps per frame in a recording steps by `step()`: 1/N s
 * inside the asked-for frame, nothing in any other redraw. So the sim, the
 * animation, the cameras, the play clock and the shader clocks all move
 * exactly one frame step per recorded frame (a recording that ran fast:
 * docs/m7/MONTAGE.md, "Harness note"). Inert without ?video.
 */
export const videoTime = {
  frames: 0,
  get t(): number {
    return urlFlags.video ? this.frames / urlFlags.video : 0;
  },
  step(): number {
    return urlFlags.video && videoGate.open ? 1 / urlFlags.video : 0;
  },
};

export const urlFlags = (() => {
  const p = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  return {
    dev: p.has('dev'),
    perf: p.has('perf'),
    seed: p.get('seed'),
    vfx: p.get('vfx'), // dev: loop an effect preview (render/vfx/effects.ts ids)
    vfxAge: p.has('vfxAge') ? Number(p.get('vfxAge')) : 0, // backdate preview bursts (s)
    fly: p.has('fly'), // free flythrough camera (render/cameras/FlyCamera.tsx)
    shot: p.get('shot'), // screenshot harness: jump straight to a named state
    // Video recording (tools/shots/video.spec.ts): every rendered frame is 1/N s of game time, cameras ease as in play.
    video: p.has('video') ? Number(p.get('video')) || 30 : null,
    pops: p.has('pops'), // log animation pops (render/game/popMeter.ts)
    pad: p.has('pad'), // button prompts held on the gamepad's glyphs (screenshots and dev)
    oldHeads: p.has('oldheads'), // A/B: the heads at their pre-M6.6 size (render/players/bodyShape.ts headScale)
    wear: p.has('wear') ? Number(p.get('wear')) : null, // screenshots: every player's kit worn this much (0..1; render/players/playerAsset.ts updateWear)
    lighting: p.get('lighting'),
    quality: p.get('quality'),
    noIntro: p.has('nointro'),
    lineup: p.has('lineup'), // dev: 22 players at the line of scrimmage (render/players/Lineup.tsx)
    // Fixed camera for screenshots and dev: x,y,z,lookX,lookY,lookZ[,fov].
    cam: p.get('cam')?.split(',').map(Number) ?? null,
    // Dev and recordings: a close camera on one player through the play: slot[,dx,dy,h,fov] (the eye's offset from him in yd along and across the field, its height in m; render/game/GameCamera.tsx).
    follow: p.get('follow'),
    // Ambient crowd energy 0..1 (screenshots of a quiet or a rocking bowl).
    crowd: p.has('crowd') ? Number(p.get('crowd')) : null,
    shotTime: p.has('t') ? Number(p.get('t')) : null, // freeze the cinematic clock (screenshots)
  };
})();

/**
 * Video recording: true only inside the frame the recorder asked for
 * (Stage's __btbRenderFrame). Chromium draws extra frames while it takes a
 * screenshot; the Beasts' drive montage (M7) steps nothing in those, so a
 * recording keeps its 1/N s a frame.
 */
export const videoGate = { open: false };
