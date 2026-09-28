// Web Audio graph: master -> {music, sfx, crowd, ui, ambience} buses, with the volumes
// from settings. Milestone 1 synthesizes the UI sounds and a coastal ambient
// bed (surf, wind, distant crowd murmur) in-house. Recorded crowd, pads and
// music arrive with licensed sources in later milestones (see CREDITS.md).

type Bus = 'music' | 'sfx' | 'crowd' | 'ui' | 'ambience';
const BUSES: Bus[] = ['music', 'sfx', 'crowd', 'ui', 'ambience'];

/**
 * The coastal bed's levels (gain on its bus before the bus volume), M6.6.
 * Playtest 1: "ocean ambience is too loud in the menus". The surf ran at
 * 0.22 swelling ±0.14 (0.08 to 0.36) on the SFX bus: in the menus, where
 * nothing else plays, the loudest thing in the room, and the SFX slider
 * (not the Crowd slider, whose description claimed the ambience) was the
 * only way to turn it down. Now 12 dB down at the default volumes (0.1 on
 * an Ambience bus at 60% against 0.22 on SFX at 80%: 0.036 against 0.14),
 * with a gentler swell, on its own bus with its own slider: a bed you
 * notice when you listen for it.
 */
export const AMBIENT_LEVELS = {
  surf: { gain: 0.1, swell: 0.05 },
  wind: { gain: 0.025, swell: 0.014 },
  murmur: { gain: 0.05, swell: 0.015 },
} as const;

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8, crowd: 0.8, ui: 0.7, ambience: 0.6 };
  private noise!: AudioBuffer;
  private ambient: { stop: () => void } | null = null;
  private lastHover = 0;

  /** Must be called from a user gesture (browsers block audio before that). */
  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      this.master.connect(comp).connect(ctx.destination);
      for (const b of BUSES) {
        const g = ctx.createGain();
        g.connect(this.master);
        this.buses[b] = g;
      }
      this.noise = this.makeNoise(4);
      this.applyVolumes();
    }
    void this.ctx.resume();
  }

  setVolumes(v: { master: number; music: number; sfx: number; crowd: number; ui: number; ambience: number }): void {
    this.volumes = { master: v.master, music: v.music, sfx: v.sfx, crowd: v.crowd, ui: v.ui, ambience: v.ambience };
    this.applyVolumes();
  }

  setSuspended(s: boolean): void {
    if (!this.ctx) return;
    void (s ? this.ctx.suspend() : this.ctx.resume());
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Perceptual (squared) curve so sliders feel linear.
    this.master.gain.setTargetAtTime(this.volumes.master ** 2, t, 0.05);
    for (const b of BUSES) this.buses[b].gain.setTargetAtTime(this.volumes[b] ** 2, t, 0.05);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let seed = 1234567 + ch * 7919;
      for (let i = 0; i < d.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        d[i] = seed / 2147483648 - 1;
      }
    }
    return buf;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, bus: Bus, glideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.buses[bus]);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseHit(dur: number, freq: number, q: number, gain: number, bus: Bus, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.02);
  }

  uiHover(): void {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastHover < 35) return;
    this.lastHover = now;
    this.noiseHit(0.035, 5200, 2.5, 0.12, 'ui');
    this.tone(1900, 0.03, 'sine', 0.035, 'ui');
  }

  uiSelect(): void {
    this.noiseHit(0.06, 2400, 1.2, 0.18, 'ui');
    this.tone(660, 0.09, 'triangle', 0.08, 'ui', 990);
    this.tone(1320, 0.12, 'sine', 0.04, 'ui', undefined, 0.035);
  }

  uiBack(): void {
    this.noiseHit(0.05, 1500, 1.2, 0.14, 'ui');
    this.tone(520, 0.1, 'triangle', 0.07, 'ui', 330);
  }

  uiTick(): void {
    this.noiseHit(0.02, 3800, 4, 0.1, 'ui');
  }

  uiError(): void {
    this.tone(180, 0.16, 'square', 0.03, 'ui', 140);
  }

  /**
   * Pads meeting (synthesized: a band of noise for the crack of the pads, a
   * sine thump underneath), by the hit's force; a big hit adds a deeper
   * thump and the crowd's roar swelling after it.
   */
  hit(force: number, big: boolean): void {
    if (!this.ctx) return;
    const k = Math.min(1, force / 10);
    this.noiseHit(0.09 + 0.05 * k, 900 + 500 * k, 0.9, 0.12 + 0.2 * k, 'sfx');
    this.tone(70 + 30 * k, 0.16, 'sine', 0.12 + 0.15 * k, 'sfx', 45);
    if (big) {
      this.tone(48, 0.35, 'sine', 0.3, 'sfx', 32);
      this.noiseHit(1.4, 700, 0.5, 0.18, 'crowd', 0.12);
    }
  }

  /** Foot on the ball (M6.6): a leather thock, `delay` s from now (the kick's contact after the snap). A mis-hit sounds thinner. */
  kickThump(delay: number, clean: boolean): void {
    if (!this.ctx) return;
    this.noiseHit(0.05, clean ? 1300 : 2100, 1.4, clean ? 0.34 : 0.24, 'sfx', delay);
    this.tone(clean ? 92 : 120, 0.13, 'sine', clean ? 0.32 : 0.2, 'sfx', 58, delay);
  }

  /** The crowd on a kick's result: a roar for a make (or a big punt), a groan for a miss. */
  kickCrowd(good: boolean): void {
    if (!this.ctx) return;
    if (good) this.noiseHit(1.8, 650, 0.45, 0.22, 'crowd');
    else {
      this.noiseHit(1.1, 380, 0.6, 0.14, 'crowd');
      this.tone(150, 0.9, 'sawtooth', 0.012, 'crowd', 95);
    }
  }

  /** The play clock's last five seconds: a dry tick each second. */
  playClockTick(): void {
    this.noiseHit(0.03, 3200, 5, 0.09, 'ui');
  }

  /** An official's whistle (the flag, the end of a quarter). */
  whistle(): void {
    if (!this.ctx) return;
    this.tone(2950, 0.42, 'sine', 0.05, 'sfx', 3050);
    this.tone(3400, 0.42, 'sine', 0.025, 'sfx', 3480);
  }

  /** Stadium horn + sub hit for the title reveal. */
  titleSting(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.tone(55, 1.6, 'sine', 0.35, 'sfx', 42);
    this.noiseHit(0.9, 180, 0.7, 0.35, 'sfx');
    for (const [f, d] of [[110, 0], [164.8, 0.02], [220, 0.04]] as const) this.tone(f, 2.2, 'sawtooth', 0.018, 'music', f * 0.995, d);
  }

  /** Coastal cliff ambience: surf swells, wind, distant stadium murmur. */
  startAmbient(): void {
    const ctx = this.ctx;
    if (!ctx || this.ambient) return;
    const nodes: AudioScheduledSourceNode[] = [];
    const mk = (freq: number, q: number, gain: number, type: BiquadFilterType, bus: Bus, lfoRate: number, lfoDepth: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lg = ctx.createGain();
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(this.buses[bus]);
      src.start(0, Math.random() * 3);
      lfo.start();
      nodes.push(src, lfo);
      return g;
    };
    const fadeIn = (g: GainNode, to: number) => {
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(to, ctx.currentTime + 3);
    };
    // Surf: low-passed noise with slow swell. Wind: band-passed, gusting. Both on the ambience bus (Settings, Audio, Ambience).
    const L = AMBIENT_LEVELS;
    fadeIn(mk(420, 0.4, L.surf.gain, 'lowpass', 'ambience', 0.09, L.surf.swell), L.surf.gain);
    fadeIn(mk(900, 0.6, L.wind.gain, 'bandpass', 'ambience', 0.23, L.wind.swell), L.wind.gain);
    // Distant crowd murmur inside the bowl (the crowd's bus).
    fadeIn(mk(520, 1.1, L.murmur.gain, 'bandpass', 'crowd', 0.05, L.murmur.swell), L.murmur.gain);
    this.ambient = {
      stop: () => {
        nodes.forEach((n) => {
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        });
        this.ambient = null;
      },
    };
  }
}

export const Audio = new AudioEngine();
