import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createPlayerMaterial, setPlayerLook, type PlayerLook } from './playerMaterial';
import { urlFlags } from '@/app/platform';
import { bodyShape, headScale, type BodyShape } from './bodyShape';
import { loadGlyphAtlas } from './glyphAtlas';
import type { Variety } from './variety';
import { OFFICIAL_KIT, REFEREE_KIT } from './kits';

/** Bones whose rest position variety.ts scales: upperarm (shoulder width), forearm and hand (arm length). */
const PROPORTION_BONES = ['upperarm_l', 'upperarm_r', 'forearm_l', 'forearm_r', 'hand_l', 'hand_r'];
/** The variety shapes (tools/blender/lib/shapes.py) at rest, for a body with no Variety. */
const NO_VARIETY = { pads: 0, neck: 0, waist: 0, calves: 0, arms: 0 };
/** The reach correctives start off (the exporter's default weight is 1); updateReach drives them on the visible LOD. */
const NO_REACH = { reach_l: 0, reach_r: 0 };

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
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Turf wear (the character pass): each time a player goes down (his pelvis
 * under WEAR_DOWN of his height above the turf: a tackle, a dive, a pile),
 * his legs pick up WEAR_STEP.legs of grass and soil, the side he landed on
 * WEAR_STEP.torso (his chest's facing says which), and his helmet a few
 * scuffs. About ten trips to the turf soak a kit (a back's or a
 * receiver's game); a lineman who stays up stays cleaner. He has to be
 * back over WEAR_UP before the next trip counts. The shader draws it
 * (playerMaterial.ts uWear).
 */
/**
 * The arms-overhead correctives (tools/blender/lib/corrective.py, the
 * character pass): shape keys reach_l / reach_r fade in as the upper arm
 * rises past REACH_FROM degrees from the trunk's down axis and are full at
 * REACH_TO. Must match corrective.py REACH_FROM / REACH_TO, which the
 * build's skinning gate measures with.
 */
export const REACH_FROM = 105;
export const REACH_TO = 160;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Smoothstep weight of a reach corrective for an arm elevation (degrees). */
export function reachWeight(elevationDeg: number): number {
  const t = Math.min(1, Math.max(0, (elevationDeg - REACH_FROM) / (REACH_TO - REACH_FROM)));
  return t * t * (3 - 2 * t);
}

export const WEAR_DOWN = 0.22;
export const WEAR_UP = 0.4;
export const WEAR_STEP = { legs: 0.12, torso: 0.16, side: 0.09, helmet: 0.07 };

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
  /** Turf wear: legs, torso front, torso back, helmet scuffs (0..1); the material's uniform. */
  readonly wear: THREE.Vector4;
  private wearArmed = true;
  private wearKey = '';
  /** The chest's forward axis in the spine_04 bone's frame (from the rest pose). */
  private readonly chestFwd = new THREE.Vector3(0, 0, 1);

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
    this.wear = (this.material.userData.player as { uWear: { value: THREE.Vector4 } }).uWear.value;
    this.wearKey = `${opts.number ?? ''}|${opts.name ?? ''}`;
    if (urlFlags.wear !== null) this.wear.setScalar(Math.min(1, Math.max(0, urlFlags.wear)));
    const chest = this.bones.get('spine_04');
    if (chest) {
      // At rest, the chest faces the root's +Z; keep that axis in the bone's own frame.
      this.root.updateMatrixWorld(true);
      const rel = this.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(chest.getWorldQuaternion(_q));
      this.chestFwd.set(0, 0, 1).applyQuaternion(rel.invert());
    }
  }

  setLook(look: PlayerLook): void {
    setPlayerLook(this.material, look);
    // Another man in the kit (a substitution): he comes on clean.
    const key = `${look.number ?? ''}|${look.name ?? ''}`;
    if (key !== this.wearKey && urlFlags.wear === null) this.wear.set(0, 0, 0, 0);
    this.wearKey = key;
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
    // The head (helmet and mask) keeps closer to one real size than the body does (bodyShape.ts headScale).
    this.bones.get('head')?.scale.setScalar(urlFlags.oldHeads ? 1 : headScale(s.scale));
    // Every key the file carries is set: its default weight is 1 (the
    // exporter's), so a body without variety (an official) kept the
    // pads, neck, waist, calves and arms shapes all the way on.
    const weights: Record<string, number> = { heavy: s.heavy, lean: s.lean, belly: s.belly, ...NO_VARIETY, ...(v?.morph ?? {}), ...NO_REACH };
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

  /** The per-frame body updates that read the drawn pose: turf wear and the reach correctives (updateLod calls it). */
  tick(): void {
    this.updateWear();
    this.updateReach();
  }

  /**
   * The arms-overhead correctives, once a frame (from updateLod): each
   * arm's elevation from the drawn pose (shoulder to elbow against chest
   * to pelvis, the same measure as tools/blender/lib/corrective.py), on
   * the LOD on screen. Zero for nearly every frame of play; the shape only
   * comes in with an arm above the shoulder.
   */
  updateReach(): void {
    const m = this.lods[this.lod];
    const dict = m?.morphTargetDictionary;
    const inf = m?.morphTargetInfluences;
    if (!dict || !inf || dict.reach_l === undefined) return;
    const pelvis = this.bones.get('pelvis');
    const chest = this.bones.get('spine_04');
    if (!pelvis || !chest) return;
    const down = pelvis.getWorldPosition(_a).sub(chest.getWorldPosition(_b)).normalize();
    for (const side of ['l', 'r'] as const) {
      const up = this.bones.get(`upperarm_${side}`);
      const fore = this.bones.get(`forearm_${side}`);
      const k = dict[`reach_${side}`];
      if (!up || !fore || k === undefined) continue;
      const arm = fore.getWorldPosition(_c).sub(up.getWorldPosition(_b)).normalize();
      inf[k] = reachWeight(THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(arm.dot(down), -1, 1))));
    }
  }

  /**
   * Turf wear, once a frame (from updateLod): count a trip to the ground
   * when the pelvis drops under WEAR_DOWN of his height, and dirty the side
   * he landed on. Render-only, read from the drawn pose: the sim is untouched.
   */
  updateWear(): void {
    const pelvis = this.bones.get('pelvis');
    if (!pelvis || this.variant !== 'player') return;
    const h = BASE_HEIGHT_M * this.shape.scale;
    const y = pelvis.getWorldPosition(_v).y - this.root.position.y;
    if (y > WEAR_UP * h) this.wearArmed = true;
    if (!this.wearArmed || y > WEAR_DOWN * h) return;
    this.wearArmed = false;
    const chest = this.bones.get('spine_04');
    const facing = chest ? _v.copy(this.chestFwd).applyQuaternion(chest.getWorldQuaternion(_q)).y : 0;
    const w = this.wear;
    const add = (k: 'x' | 'y' | 'z' | 'w', d: number) => (w[k] = Math.min(1, w[k] + d));
    add('x', WEAR_STEP.legs);
    add('w', WEAR_STEP.helmet);
    if (facing < -0.35) add('y', WEAR_STEP.torso); // face down
    else if (facing > 0.35) add('z', WEAR_STEP.torso); // on his back
    else {
      add('y', WEAR_STEP.side);
      add('z', WEAR_STEP.side);
    }
  }

  /** Show one LOD (0 High, 1 Medium, 2 Low); the others stay hidden. */
  setLod(i: number): void {
    if (i === this.lod) return;
    const old = this.lods[this.lod];
    const d = old?.morphTargetDictionary;
    if (old?.morphTargetInfluences && d) for (const k of ['reach_l', 'reach_r']) if (d[k] !== undefined) old.morphTargetInfluences[d[k]!] = 0;
    this.lod = i;
    this.lods.forEach((m, k) => (m.visible = k === i));
  }

  /**
   * Pick the LOD from the player's height on screen. `viewportPx` is the
   * render target's height in pixels; bias > 1 prefers lower detail.
   */
  updateLod(camera: THREE.Camera, viewportPx: number, bias = 1): void {
    this.tick();
    this.setLod(lodForScreenHeight(screenHeightPx(camera, this.root.position, BASE_HEIGHT_M * this.shape.scale, viewportPx) / bias, this.lod));
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

/**
 * Hysteresis around the switch points (M6.5 #12): a player whose height
 * on screen hovers at a switch point (the broadcast camera puts players at
 * 50-70 px, right across the Medium/Low switch at 64) swapped meshes
 * back and forth as he ran, and the two LODs bend differently at the
 * shoulders and knees: the swap read as the body deforming. Moving to
 * another LOD now takes crossing the switch point by this factor.
 */
export const LOD_HYSTERESIS = 1.12;

/** The LOD for a height on screen; `current` (the LOD shown now) holds until the height clears a switch point by LOD_HYSTERESIS. */
export function lodForScreenHeight(px: number, current = -1): number {
  const plain = px >= LOD_SCREEN_PX[0] ? 0 : px >= LOD_SCREEN_PX[1] ? 1 : 2;
  if (current < 0 || plain === current) return plain;
  // Finer (plain < current) needs the height above the switch by the factor; coarser, below it by the factor.
  const k = plain < current ? 1 / LOD_HYSTERESIS : LOD_HYSTERESIS;
  const held = px * k >= LOD_SCREEN_PX[0] ? 0 : px * k >= LOD_SCREEN_PX[1] ? 1 : 2;
  return held === plain ? plain : current;
}
