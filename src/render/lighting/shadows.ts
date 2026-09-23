import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

// Cascaded shadow maps for the key light (sun or moon). One wide shadow map
// can't cover a 300 m bowl and a cliff and still resolve a player: its
// texels come out ~8 cm, and a grazing golden-hour sun turns the rock relief
// into blocky, dithered patches. Cascades split the view frustum so near
// ground gets centimeter texels and the far cliff a coarse map.
//
// three's CSM addon owns the key light: it creates one directional light per
// cascade, and each lit material has to be set up for it. Our materials
// already patch their shaders (atmosphere, weather, crowd), so the addon's
// onBeforeCompile hook is chained after ours rather than replacing it.

// three r186 rotates its 5 PCF taps per pixel with interleaved gradient
// noise, which only resolves under temporal anti-aliasing. We don't run TAA,
// so on half-lit faces (a grazing sun on rock) the noise shows as a
// checkerboard. A fixed tap pattern gives smooth hardware-filtered edges.
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replaceAll('interleavedGradientNoise( gl_FragCoord.xy ) * PI2', '0.0');

export interface ShadowRig {
  csm: CSM;
  /** Make a material cascade-aware (idempotent). */
  attach(mat: THREE.Material): void;
  /** Attach every lit material under `root`. */
  attachTree(root: THREE.Object3D): void;
  /** Key light color, intensity and direction (toward the light). */
  setKey(color: THREE.Color, intensity: number, dirToLight: THREE.Vector3): void;
  update(): void;
  dispose(): void;
}

export function createShadowRig(opts: { camera: THREE.PerspectiveCamera; parent: THREE.Object3D; mapSize: number; cascades: number; maxFar?: number; fade?: boolean }): ShadowRig {
  const csm = new CSM({
    camera: opts.camera,
    parent: opts.parent,
    cascades: opts.cascades,
    // Shadows to 700 m: the bowl, the cliff and the headland; beyond that the
    // aerial perspective carries the depth.
    maxFar: opts.maxFar ?? 700,
    mode: 'practical',
    shadowMapSize: opts.mapSize,
    shadowBias: -0.0003,
    lightNear: 1,
    lightFar: 2500,
    lightMargin: 220,
  });
  // Fading between cascades samples two maps in the blend band: High only.
  csm.fade = opts.fade ?? true;
  for (const l of csm.lights) {
    l.shadow.normalBias = 0.25;
    // Filter radius in texels: soft enough to hide texel steps on the far cascades.
    l.shadow.radius = 2;
  }

  // Every material this rig patched, with its own hook, so dispose() can put
  // it back exactly. (A quality change rebuilds the rig; materials still
  // carrying the old rig's defines and hook render with stale cascades.)
  const attached = new Map<THREE.Material, THREE.Material['onBeforeCompile']>();
  const attach = (mat: THREE.Material) => {
    if (attached.has(mat) || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
    const mine = mat.onBeforeCompile;
    attached.set(mat, mine);
    csm.setupMaterial(mat);
    const theirs = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      mine.call(mat, shader, renderer);
      theirs.call(mat, shader, renderer);
    };
    mat.needsUpdate = true;
  };

  return {
    csm,
    attach,
    attachTree(root) {
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const x of Array.isArray(m) ? m : [m]) attach(x);
      });
    },
    setKey(color, intensity, dirToLight) {
      csm.lightDirection.copy(dirToLight).multiplyScalar(-1).normalize();
      for (const l of csm.lights) {
        l.color.copy(color);
        l.intensity = intensity;
      }
    },
    update() {
      csm.updateFrustums();
      csm.update();
    },
    dispose() {
      for (const [mat, hook] of attached) {
        mat.onBeforeCompile = hook;
        if (mat.defines) {
          delete mat.defines.USE_CSM;
          delete mat.defines.CSM_CASCADES;
          delete mat.defines.CSM_FADE;
        }
        mat.needsUpdate = true;
      }
      attached.clear();
      csm.remove();
      csm.dispose();
    },
  };
}
