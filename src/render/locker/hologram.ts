import * as THREE from 'three';
import type { AnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import { KITS } from '../players/kits';
import { bodyFromImperial } from '../players/bodyShape';
import { jerseyName } from '../players/glyphs';
import { playerVariety, type Position } from '../players/variety';
import { Player, type PlayerAsset } from '../players/playerAsset';

// The drafted man as a hologram in front of his locker, playing his
// signature move once (M6 brief): QB drop and throw, WR release, RB cut,
// lineman into a stance. It's the game's own player rig and clips, drawn as
// light: an additive fresnel shell in the position's color with scan lines,
// fading up on a floor projector and dissolving out when the move ends.
//
// The signature clips are `sig_<pos>` (tools/blender, in place). Until a clip
// exists the move is sequenced from the base set (stance, set, get-off,
// drop, throw, juke).

export type SigPos = 'QB' | 'RB' | 'WR' | 'TE' | 'OL';

const HOLO_GLSL_PARS = /* glsl */ `
uniform vec3 uHoloColor;
uniform float uHoloAlpha;
uniform float uHoloTime;
`;
const HOLO_GLSL_OUT = /* glsl */ `
{
  vec3 hv = normalize(vViewPosition);
  float fres = pow(1.0 - abs(dot(normalize(normal), hv)), 2.2);
  // Scan lines drift up the body; a slow flicker.
  float scan = 0.75 + 0.25 * sin(gl_FragCoord.y * 0.9 - uHoloTime * 14.0);
  float flick = 0.9 + 0.1 * sin(uHoloTime * 37.0) * sin(uHoloTime * 11.0);
  vec3 hc = uHoloColor * (0.1 + 1.9 * fres) * scan * flick;
  gl_FragColor = vec4(hc * uHoloAlpha, 1.0);
}
`;

export class Hologram {
  readonly root = new THREE.Group();
  private player: Player | null = null;
  private animator: PlayerAnimator | null = null;
  private uniforms = { uHoloColor: { value: new THREE.Color() }, uHoloAlpha: { value: 0 }, uHoloTime: { value: 0 } };
  private t = -1;
  private seq: { at: number; run: (a: PlayerAnimator) => void }[] = [];
  private duration = 0;
  private speedAt: (t: number) => number = () => 0;
  readonly pad: THREE.Mesh;

  constructor(
    private asset: PlayerAsset,
    private lib: AnimLibrary,
  ) {
    // Floor projector: a lime ring that lights before the figure appears.
    const ring = new THREE.RingGeometry(0.42, 0.5, 48).rotateX(-Math.PI / 2);
    this.pad = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.pad.position.y = 0.005;
    this.root.add(this.pad);
    this.root.visible = false;
  }

  /** Play one man's signature move in `color`. */
  play(p: { name: string; pos: SigPos; num: number; heightIn: number; weightLb: number }, color: THREE.Color): void {
    this.dispose();
    const body = bodyFromImperial(p.heightIn || 74, p.weightLb || 220);
    const vpos: Position = p.pos === 'OL' ? 'OL' : p.pos;
    const player = new Player(this.asset, { kit: KITS.blackoutLime!, skin: '#8d5524', number: p.num, name: jerseyName(p.name), variety: playerVariety(vpos, body.heightM, body.weightKg, p.name), ...body });
    const mat = player.material;
    const prev = mat.onBeforeCompile;
    const u = this.uniforms;
    mat.onBeforeCompile = (shader, r) => {
      prev.call(mat, shader, r);
      Object.assign(shader.uniforms, u);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${HOLO_GLSL_PARS}`).replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${HOLO_GLSL_OUT}`);
    };
    const key = mat.customProgramCacheKey.bind(mat);
    mat.customProgramCacheKey = () => `${key()}|holo`;
    mat.transparent = true;
    mat.blending = THREE.AdditiveBlending;
    mat.depthWrite = false;
    mat.side = THREE.FrontSide;
    player.shadowProxy.visible = false;
    player.setLod(0);
    u.uHoloColor.value.copy(color).multiplyScalar(2.2);
    (this.pad.material as THREE.MeshBasicMaterial).color.copy(color);
    this.root.add(player.root);
    this.player = player;
    const a = new PlayerAnimator(player, this.lib);
    this.animator = a;
    this.plan(p.pos, a);
    a.update(10, { speed: 0 });
    this.t = 0;
    this.root.visible = true;
  }

  /** The move: the authored signature clip, or a sequence of base clips. */
  private plan(pos: SigPos, a: PlayerAnimator): void {
    const sig = `sig_${pos.toLowerCase()}`;
    const has = (n: string) => !!this.lib.meta[n];
    this.speedAt = () => 0;
    const lead = 0.45; // the figure resolves before it moves
    if (has(sig)) {
      a.setStance('stance_idle');
      this.seq = [{ at: lead, run: (x) => x.play(sig, { now: true }) }];
      this.duration = lead + this.lib.meta[sig]!.duration + 0.5;
      return;
    }
    const d = (n: string) => this.lib.meta[n]?.duration ?? 0.8;
    switch (pos) {
      case 'QB':
        a.setStance('stance_qb_center');
        this.seq = [
          { at: lead, run: (x) => x.play('qb_drop_uc5', { now: true }) },
          { at: lead + d('qb_drop_uc5') - 0.1, run: (x) => x.play('qb_throw', { now: true }) },
        ];
        this.duration = lead + d('qb_drop_uc5') + d('qb_throw') + 0.4;
        break;
      case 'WR':
        a.setStance('stance_wr_2pt');
        this.seq = [{ at: lead, run: (x) => x.play('getoff_wr_2pt', { now: true }) }];
        this.speedAt = (t) => (t > lead + 0.2 && t < lead + 1.3 ? 7 : 0);
        this.duration = lead + 1.9;
        break;
      case 'RB':
        a.setStance('stance_rb_2pt');
        this.seq = [
          { at: lead, run: (x) => x.play('getoff_rb_2pt', { now: true }) },
          { at: lead + 0.75, run: (x) => x.play('juke_r', { now: true }) },
        ];
        this.speedAt = (t) => (t > lead + 0.2 && t < lead + 1.5 ? 6.5 : 0);
        this.duration = lead + 2.0;
        break;
      case 'TE':
        a.setStance('stance_idle');
        this.seq = [
          { at: lead, run: (x) => x.play('set_ol_3pt', { now: true }) },
          { at: lead + d('set_ol_3pt') + 0.25, run: (x) => x.play('getoff_ol_3pt', { now: true }) },
        ];
        this.duration = lead + d('set_ol_3pt') + d('getoff_ol_3pt') + 0.6;
        break;
      case 'OL':
        a.setStance('stance_idle');
        this.seq = [{ at: lead, run: (x) => x.play('set_ol_3pt', { now: true }) }];
        this.duration = lead + d('set_ol_3pt') + 1.0;
        break;
    }
  }

  get active(): boolean {
    return this.t >= 0;
  }

  update(dt: number): void {
    if (this.t < 0 || !this.animator) return;
    const t0 = this.t;
    this.t += dt;
    const t = this.t;
    for (const s of this.seq) if (t0 < s.at && t >= s.at) s.run(this.animator);
    // In place: the move plays where the projector is (root motion isn't applied).
    this.animator.update(dt, { speed: this.speedAt(t) });
    const fadeIn = Math.min(1, t / 0.4);
    const fadeOut = Math.min(1, Math.max(0, (this.duration - t) / 0.45));
    this.uniforms.uHoloAlpha.value = fadeIn * fadeOut;
    this.uniforms.uHoloTime.value = t;
    (this.pad.material as THREE.MeshBasicMaterial).opacity = Math.min(1, t / 0.2) * Math.min(1, (this.duration + 0.3 - t) / 0.3);
    if (t > this.duration + 0.3) this.dispose();
  }

  dispose(): void {
    if (this.player) {
      this.root.remove(this.player.root);
      this.player.material.dispose();
    }
    this.player = null;
    this.animator = null;
    this.t = -1;
    this.root.visible = false;
  }
}
