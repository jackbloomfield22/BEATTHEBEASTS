import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The spectator: a small procedural person (built here, no third-party
// assets) rendered once at startup into an atlas of card images, one per view
// direction and pose. The crowd (crowd.ts) draws every seat as a card that
// picks the right cell, so 30,000+ people cost two triangles each while still
// showing heads, shoulders, arms and real lighting.
//
// Two atlases share one layout (DIRS columns × POSES rows of CELL_W×CELL_H):
//   mask:   R shirt, G skin, B hair, A coverage (pants/shoes = A − R − G − B)
//   normal: view-space normal of the card (xy in RG, z in B), A coverage
// Masks instead of colors keep mipmaps meaningful (a far card averages to its
// person's mixed colors), and every instance picks its own palette.

export const DIRS = 8;
export const POSES = 4; // 0 seated, 1 standing, 2 arms up, 3 clapping
export const CELL_W = 128;
export const CELL_H = 256;
/** World size of a card (meters): wide enough for raised arms, tall enough for a standing adult. */
export const CARD_W = 1.1;
export const CARD_H = 2.2;

type Mask = [number, number, number, number];
const SHIRT: Mask = [1, 0, 0, 1];
const SKIN: Mask = [0, 1, 0, 1];
const HAIR: Mask = [0, 0, 1, 1];
const PANTS: Mask = [0, 0, 0, 1];

function part(geo: THREE.BufferGeometry, mask: Mask, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.toNonIndexed();
  g.applyMatrix4(m);
  const n = g.attributes.position!.count;
  const arr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) arr.set(mask, i * 4);
  g.setAttribute('mask', new THREE.BufferAttribute(arr, 4));
  g.deleteAttribute('uv');
  return g;
}

const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** A limb from `a` to `b` as a capsule of radius r. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mask: Mask): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len), 3, 8);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return part(g, mask, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
}

/** The person in a pose, feet at y = 0 (seated: pelvis on a 0.45 m seat), facing +Z. */
export function buildPerson(pose: number): THREE.BufferGeometry {
  const seated = pose === 0;
  const parts: THREE.BufferGeometry[] = [];
  const hipY = seated ? 0.47 : 0.92;
  const torsoLen = 0.52;
  const shoulderY = hipY + torsoLen;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Legs (pants), shoes.
  for (const side of [-1, 1]) {
    const hip = V(0.1 * side, hipY, 0);
    if (seated) {
      const knee = V(0.11 * side, hipY + 0.02, 0.42);
      const ankle = V(0.12 * side, 0.08, 0.46);
      parts.push(limb(hip, knee, 0.075, PANTS), limb(knee, ankle, 0.06, PANTS));
      parts.push(part(new THREE.BoxGeometry(0.1, 0.08, 0.24), PANTS, M(0.12 * side, 0.04, 0.52)));
    } else {
      const knee = V(0.1 * side, 0.48, 0.02);
      const ankle = V(0.1 * side, 0.08, 0);
      parts.push(limb(hip, knee, 0.075, PANTS), limb(knee, ankle, 0.06, PANTS));
      parts.push(part(new THREE.BoxGeometry(0.1, 0.08, 0.24), PANTS, M(0.1 * side, 0.04, 0.06)));
    }
  }
  // Torso: a slightly tapered capsule, shoulders broader than the waist.
  const torso = new THREE.CapsuleGeometry(0.17, torsoLen - 0.2, 4, 12);
  parts.push(part(torso, SHIRT, M(0, hipY + torsoLen / 2, 0, seated ? -0.12 : 0, 0, 0, 1.15, 1, 0.72)));
  // Neck, head, hair cap.
  parts.push(part(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), SKIN, M(0, shoulderY + 0.06, 0)));
  parts.push(part(new THREE.SphereGeometry(0.105, 14, 10), SKIN, M(0, shoulderY + 0.2, 0.01, 0, 0, 0, 1, 1.12, 1.02)));
  // Hair shell: crown, sides down to the ears and the back of the head,
  // framing the face from the front.
  // Tilted back so the front rim sits at the hairline (~6 cm above the eyes), not over them.
  parts.push(part(new THREE.SphereGeometry(0.113, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), HAIR, M(0, shoulderY + 0.222, -0.006, -0.5, 0, 0, 1.06, 1.18, 1.1)));
  parts.push(part(new THREE.SphereGeometry(0.1, 12, 8), HAIR, M(0, shoulderY + 0.19, -0.035, 0, 0, 0, 1.04, 1.1, 0.9)));
  // Arms by pose.
  for (const side of [-1, 1]) {
    const sh = V(0.21 * side, shoulderY - 0.04, 0);
    let elbow: THREE.Vector3;
    let hand: THREE.Vector3;
    if (pose === 2) {
      // Arms up, celebrating.
      elbow = V(0.3 * side, shoulderY + 0.24, 0.04);
      hand = V(0.34 * side, shoulderY + 0.52, 0.08);
    } else if (pose === 3) {
      // Clapping in front of the chest.
      elbow = V(0.24 * side, shoulderY - 0.26, 0.14);
      hand = V(0.04 * side, shoulderY - 0.12, 0.3);
    } else if (seated) {
      elbow = V(0.23 * side, shoulderY - 0.28, 0.06);
      hand = V(0.16 * side, hipY + 0.06, 0.3);
    } else {
      elbow = V(0.25 * side, shoulderY - 0.3, 0.0);
      hand = V(0.24 * side, shoulderY - 0.58, 0.06);
    }
    parts.push(limb(sh, elbow, 0.055, SHIRT), limb(elbow, hand, 0.045, SKIN));
    parts.push(part(new THREE.SphereGeometry(0.05, 8, 6), SKIN, new THREE.Matrix4().makeTranslation(hand.x, hand.y, hand.z)));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  for (const p of parts) p.dispose();
  return g;
}

const bakeVert = /* glsl */ `
attribute vec4 mask;
varying vec4 vMask;
varying vec3 vN;
void main() {
  vMask = mask;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const bakeFragMask = /* glsl */ `
varying vec4 vMask;
void main() { gl_FragColor = vMask; }
`;
const bakeFragNormal = /* glsl */ `
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

export interface SpectatorAtlas {
  mask: THREE.Texture;
  normal: THREE.Texture;
  dispose(): void;
}

/** Render every pose from every direction into the two atlases (once, at startup). */
export function bakeSpectatorAtlas(gl: THREE.WebGLRenderer): SpectatorAtlas {
  const W = CELL_W * DIRS;
  const H = CELL_H * POSES;
  const opts: THREE.RenderTargetOptions = {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  };
  const maskRT = new THREE.WebGLRenderTarget(W, H, opts);
  const normalRT = new THREE.WebGLRenderTarget(W, H, opts);
  for (const rt of [maskRT, normalRT]) rt.texture.colorSpace = THREE.NoColorSpace;

  const scene = new THREE.Scene();
  const matMask = new THREE.ShaderMaterial({ vertexShader: bakeVert, fragmentShader: bakeFragMask, side: THREE.DoubleSide });
  const matNormal = new THREE.ShaderMaterial({ vertexShader: bakeVert, fragmentShader: bakeFragNormal, side: THREE.DoubleSide });
  const cam = new THREE.OrthographicCamera(-CARD_W / 2, CARD_W / 2, CARD_H, 0, -5, 5);
  cam.position.set(0, 0, 2);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();

  const prevTarget = gl.getRenderTarget();
  const prevClear = gl.getClearColor(new THREE.Color());
  const prevAlpha = gl.getClearAlpha();
  const prevAutoClear = gl.autoClear;
  // Each cell is one render into a viewport of the atlas; clear once per atlas.
  gl.autoClear = false;
  gl.setClearColor(0x000000, 0);
  for (const [rt, mat] of [
    [maskRT, matMask],
    [normalRT, matNormal],
  ] as const) {
    gl.setRenderTarget(rt);
    rt.viewport.set(0, 0, W, H);
    gl.clear(true, true, true);
    for (let pose = 0; pose < POSES; pose++) {
      const geo = buildPerson(pose);
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      for (let d = 0; d < DIRS; d++) {
        // Column d shows the person turned by −d·45°, i.e. the view from
        // d·45° around (0 = straight on, 4 = from behind).
        mesh.rotation.y = -(d / DIRS) * Math.PI * 2;
        mesh.updateMatrixWorld();
        const x = d * CELL_W;
        const y = (POSES - 1 - pose) * CELL_H; // row 0 (seated) at the top of the texture (uv v high)
        rt.viewport.set(x, y, CELL_W, CELL_H);
        gl.setRenderTarget(rt);
        gl.render(scene, cam);
      }
      scene.remove(mesh);
      geo.dispose();
    }
  }
  gl.autoClear = prevAutoClear;
  gl.setRenderTarget(prevTarget);
  gl.setClearColor(prevClear, prevAlpha);
  matMask.dispose();
  matNormal.dispose();
  return {
    mask: maskRT.texture,
    normal: normalRT.texture,
    dispose() {
      maskRT.dispose();
      normalRT.dispose();
    },
  };
}
