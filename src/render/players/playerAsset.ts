import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createPlayerMaterial, setPlayerLook, type PlayerLook } from './playerMaterial';
import { bodyShape, type BodyShape } from './bodyShape';
import { loadGlyphAtlas } from './glyphAtlas';
import type { Variety } from './variety';
import { OFFICIAL_KIT, REFEREE_KIT } from './kits';

/** Bones whose rest position variety.ts scales: upperarm (shoulder width), forearm and hand (arm length). */
const PROPORTION_BONES = ['upperarm_l', 'upperarm_r', 'forearm_l', 'forearm_r', 'hand_l', 'hand_r'];

// The player asset (tools/blender/build_character.py → public/assets/
// characters/player.glb): one armature and three LOD skinned meshes sharing
// it (and three more, official_lod<i>, for the officials: PlayerVariant).
// Every Player is a clone with its own skeleton, material uniforms and
// morph weights; geometry is shared.

export const PLAYER_URL = `${import.meta.env.BASE_URL}assets/characters/player.glb`;
/**
 * LOD switch points by the player's height on screen, in render-target pixels:
 * High (~25k triangles) above 240 px, Medium (~12k) above 64 px, Low (~3.6k)
 * below. The facemask bars and fingers the High LOD adds are under a pixel
 * below ~240 px; from the broadcast camera (~50-70 px a player at 1080p) all
 * 22 draw Medium or Low. By screen size rather than distance, a zoomed lens,
 * a small window or a lower resolution scale all pick the right detail.
 */
export const LOD_SCREEN_PX = [240, 64] as const;
const BASE_HEIGHT_M = 1.88;
const _camPos = new THREE.Vector3();

export interface PlayerAsset {
  scene: THREE.Group;
}

let pending: Promise<PlayerAsset> | null = null;

export function loadPlayerAsset(url = PLAYER_URL): Promise<PlayerAsset> {
  pending ??= Promise.all([new GLTFLoader().loadAsync(url), loadGlyphAtlas()]).then(([gltf]) => {
    gltf.scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      // The part id rides in TEXCOORD_0; give it its own name so the material
      // can read it without three treating it as a texture UV.
      const g = m.geometry;
      const uv = g.getAttribute('uv');
      if (uv) {
        g.setAttribute('aPart', uv);
        g.deleteAttribute('uv');
      }
      m.frustumCulled = false; // bounds don't follow the skeleton; the Player culls by root
      // The visible LODs don't cast; each Player adds a Low-LOD shadow proxy.
      m.castShadow = false;
      m.receiveShadow = true;
    });
    return { scene: gltf.scene };
  });
  return pending;
}

/** Draws nothing in the main pass: no color, no depth. */
const SHADOW_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

/**
 * Which body the asset's meshes dress: a player (player_lod<i>: pads,
 * helmet, facemasks) or an official (official_lod<i>: striped shirt,
 * cap, long pants; tools/blender/build_character.py). Same skeleton and
 * clips either way.
 */
export type PlayerVariant = 'player' | 'official';

export interface PlayerOptions extends PlayerLook {
  heightM: number;
  weightKg: number;
  /** Default 'player'. */
  variant?: PlayerVariant;
}

export interface OfficialOptions {
  skin: string;
  /** The referee wears the white cap. */
  referee?: boolean;
  heightM?: number;
  weightKg?: number;
}

/**
 * Spawn an official: the official meshes with the officials' kit (no
 * numbers or names). Animate him like any Player (ref_idle, ref_run and
 * the signal clips in anims.json).
 */
export function createOfficial(asset: PlayerAsset, opts: OfficialOptions): Player {
  return new Player(asset, {
    variant: 'official',
    kit: opts.referee ? REFEREE_KIT : OFFICIAL_KIT,
    skin: opts.skin,
    // An official's build: ~6'0", 200 lb unless given.
    heightM: opts.heightM ?? 1.83,
    weightKg: opts.weightKg ?? 91,
  });
}

/** One player on the field: a skinned clone, three LODs, its own look and body shape. */
export class Player {
  readonly root: THREE.Object3D;
  readonly lods: THREE.SkinnedMesh[];
  /**
   * Casts the player's shadow: the Low LOD, sharing the skeleton, with a
   * material that writes nothing on screen (three draws shadow maps with its
   * own depth material, so it still casts). A shadow can't show the
   * difference, and the cascades draw ~3.5k triangles per player instead of
   * up to 20k each. (Layers can't do this: three tests shadow casters against
   * the main camera's layers.)
   */
  readonly shadowProxy: THREE.SkinnedMesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly bones = new Map<string, THREE.Bone>();
  shape: BodyShape;
  variety: Variety | null = null;
  private lod = -1;
  /** Rest positions of the bones variety.ts re-proportions. */
  private readonly restPos = new Map<string, THREE.Vector3>();

  readonly variant: PlayerVariant;

  constructor(asset: PlayerAsset, opts: PlayerOptions) {
    this.root = cloneSkinned(asset.scene);
    this.variant = opts.variant ?? 'player';
    // Keep only this variant's meshes (the clone shares their geometry).
    const prefix = `${this.variant}_lod`;
    const other: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !o.name.startsWith(prefix)) other.push(o);
    });
    for (const o of other) o.removeFromParent();
    this.material = createPlayerMaterial(opts);
    this.lods = [];
    this.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.material = this.material;
        this.lods[Number(m.name.match(/lod(\d)/)?.[1] ?? 0)] = m;
      }
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });
    if (this.lods.length < 3 || this.lods.some((m) => !m)) throw new Error(`player asset has no ${prefix}0..2 meshes`);
    const low = this.lods[2]!;
    this.shadowProxy = new THREE.SkinnedMesh(low.geometry, SHADOW_ONLY);
    this.shadowProxy.name = 'shadow_proxy';
    this.shadowProxy.bind(low.skeleton, low.bindMatrix);
    this.shadowProxy.morphTargetInfluences = low.morphTargetInfluences?.slice();
    this.shadowProxy.morphTargetDictionary = low.morphTargetDictionary;
    this.shadowProxy.frustumCulled = false;
    this.shadowProxy.castShadow = true;
    this.shadowProxy.receiveShadow = false;
    this.shadowProxy.renderOrder = -1;
    low.parent!.add(this.shadowProxy);
    for (const n of PROPORTION_BONES) {
      const b = this.bones.get(n);
      if (b) this.restPos.set(n, b.position.clone());
    }
    this.shape = bodyShape(opts.heightM, opts.weightKg);
    this.variety = opts.variety ?? null;
    this.applyShape();
    this.setLod(0);
  }

  setLook(look: PlayerLook): void {
    setPlayerLook(this.material, look);
    this.variety = look.variety ?? null;
    this.applyShape();
  }

  setBody(heightM: number, weightKg: number): void {
    this.shape = bodyShape(heightM, weightKg);
    this.applyShape();
  }

  private applyShape(): void {
    const s = this.shape;
    const v = this.variety;
    this.root.scale.setScalar(s.scale);
    const weights: Record<string, number> = { heavy: s.heavy, lean: s.lean, belly: s.belly, ...(v?.morph ?? {}) };
    for (const m of [...this.lods, this.shadowProxy]) {
      const dict = m.morphTargetDictionary;
      const inf = m.morphTargetInfluences;
      if (!dict || !inf) continue;
      for (const [k, w] of Object.entries(weights)) if (dict[k] !== undefined) inf[dict[k]!] = w;
    }
    // Proportions (clips don't key these bones' positions; library.ts):
    // shoulder width moves the arm out along the clavicle, arm length
    // stretches the upper arm and forearm (each bone's position is its
    // parent's length along the parent's axis).
    for (const [n, rest] of this.restPos) {
      const b = this.bones.get(n)!;
      b.position.copy(rest);
      if (!v) continue;
      if (n.startsWith('upperarm_')) b.position.multiplyScalar(1 + v.shoulder / Math.max(rest.length(), 1e-3));
      else b.position.multiplyScalar(v.arm);
    }
  }

  /** Show one LOD (0 High, 1 Medium, 2 Low); the others stay hidden. */
  setLod(i: number): void {
    if (i === this.lod) return;
    this.lod = i;
    this.lods.forEach((m, k) => (m.visible = k === i));
  }

  /**
   * Pick the LOD from the player's height on screen. `viewportPx` is the
   * render target's height in pixels; bias > 1 prefers lower detail.
   */
  updateLod(camera: THREE.Camera, viewportPx: number, bias = 1): void {
    this.setLod(lodForScreenHeight(screenHeightPx(camera, this.root.position, BASE_HEIGHT_M * this.shape.scale, viewportPx) / bias));
  }
}

/** Height on screen (px) of an upright object `heightM` tall standing at `pos`. */
export function screenHeightPx(camera: THREE.Camera, pos: THREE.Vector3, heightM: number, viewportPx: number): number {
  const d = Math.max(0.1, camera.getWorldPosition(_camPos).distanceTo(pos));
  const cam = camera as THREE.PerspectiveCamera;
  if (!cam.isPerspectiveCamera) return viewportPx;
  const view = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / cam.zoom;
  return (heightM / view) * viewportPx;
}

export function lodForScreenHeight(px: number): number {
  return px >= LOD_SCREEN_PX[0] ? 0 : px >= LOD_SCREEN_PX[1] ? 1 : 2;
}
