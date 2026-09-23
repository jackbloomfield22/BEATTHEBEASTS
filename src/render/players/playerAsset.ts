import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createPlayerMaterial, setPlayerLook, type PlayerLook } from './playerMaterial';
import { bodyShape, type BodyShape } from './bodyShape';
import { loadGlyphAtlas } from './glyphAtlas';

// The player asset (tools/blender/build_character.py → public/assets/
// characters/player.glb): one armature and three LOD skinned meshes sharing
// it. Every Player is a clone with its own skeleton, material uniforms and
// morph weights; geometry is shared.

export const PLAYER_URL = `${import.meta.env.BASE_URL}assets/characters/player.glb`;
/** Screen-space switch points (camera distance in m at the default 40° lens) for LOD 1 and 2. */
export const LOD_DISTANCES = [0, 22, 55];

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

export interface PlayerOptions extends PlayerLook {
  heightM: number;
  weightKg: number;
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
  private lod = -1;

  constructor(asset: PlayerAsset, opts: PlayerOptions) {
    this.root = cloneSkinned(asset.scene);
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
    this.shape = bodyShape(opts.heightM, opts.weightKg);
    this.applyShape();
    this.setLod(0);
  }

  setLook(look: PlayerLook): void {
    setPlayerLook(this.material, look);
  }

  setBody(heightM: number, weightKg: number): void {
    this.shape = bodyShape(heightM, weightKg);
    this.applyShape();
  }

  private applyShape(): void {
    const s = this.shape;
    this.root.scale.setScalar(s.scale);
    for (const m of [...this.lods, this.shadowProxy]) {
      const dict = m.morphTargetDictionary;
      const inf = m.morphTargetInfluences;
      if (!dict || !inf) continue;
      inf[dict.heavy!] = s.heavy;
      inf[dict.lean!] = s.lean;
      inf[dict.belly!] = s.belly;
    }
  }

  /** Show one LOD (0 High, 1 Medium, 2 Low); the others stay hidden. */
  setLod(i: number): void {
    if (i === this.lod) return;
    this.lod = i;
    this.lods.forEach((m, k) => (m.visible = k === i));
  }

  /** Pick the LOD from the camera distance (bias > 1 prefers lower detail, per quality tier). */
  updateLod(cameraPos: THREE.Vector3, bias = 1): void {
    const d = cameraPos.distanceTo(this.root.position) * bias;
    this.setLod(d > LOD_DISTANCES[2]! ? 2 : d > LOD_DISTANCES[1]! ? 1 : 0);
  }
}
