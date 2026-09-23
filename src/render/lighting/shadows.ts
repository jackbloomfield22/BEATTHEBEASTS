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

export function createShadowRig(opts: { camera: THREE.PerspectiveCamera; parent: THREE.Object3D; mapSize: number; cascades: number }): ShadowRig {
  const csm = new CSM({
    camera: opts.camera,
    parent: opts.parent,
    cascades: opts.cascades,
    // Shadows to 700 m: the bowl, the cliff and the headland; beyond that the
    // aerial perspective carries the depth.
    maxFar: 700,
    mode: 'practical',
    shadowMapSize: opts.mapSize,
    shadowBias: -0.0003,
    lightNear: 1,
    lightFar: 2500,
    lightMargin: 220,
  });
  csm.fade = true;
  for (const l of csm.lights) l.shadow.normalBias = 0.25;

  const attach = (mat: THREE.Material) => {
    if (mat.userData.csm || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
    const mine = mat.onBeforeCompile;
    csm.setupMaterial(mat);
    const theirs = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      mine.call(mat, shader, renderer);
      theirs.call(mat, shader, renderer);
    };
    mat.userData.csm = true;
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
      csm.remove();
      csm.dispose();
    },
  };
}
