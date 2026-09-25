import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Locker props, modeled in code: helmet, hanging jersey, hanger, cleats,
// gloves, towel. Sizes are real gear (a helmet shell ~0.3 m long, a size-13
// cleat ~0.32 m, a jersey ~0.75 m from collar to hem on the hanger). All
// geometry is built once and shared by every locker.

/** Football helmet: a shell (scaled sphere cut at the face and neck), ear holes, a center stripe and a facemask. */
export function helmetGeometry(): { shell: THREE.BufferGeometry; stripe: THREE.BufferGeometry; mask: THREE.BufferGeometry } {
  // Shell: sphere with the face opening and the neck cut away. Facing +Z.
  const shell = new THREE.SphereGeometry(0.15, 40, 28, Math.PI * 0.18, Math.PI * 1.64, 0, Math.PI * 0.74);
  shell.rotateY(Math.PI / 2); // the opening (phi gap) toward +Z
  shell.scale(0.95, 0.92, 1.12);
  // Flare the back rim and flatten the jaw a touch.
  const p = shell.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    if (y < -0.04) p.setZ(i, z * (1 + (-0.04 - y) * 0.8));
  }
  shell.computeVertexNormals();
  // Stripe: a thin band over the crown, front to back.
  const stripe = new THREE.TorusGeometry(0.1565, 0.012, 6, 40, Math.PI * 1.05);
  stripe.rotateY(Math.PI / 2);
  stripe.rotateX(-Math.PI * 0.02);
  stripe.scale(0.95, 0.93, 1.12);
  stripe.scale(0.55, 1, 1); // flatten the tube sideways into a band
  // Facemask: three horizontal bars and two uprights, bent around the face.
  const bars: THREE.BufferGeometry[] = [];
  const bar = (pts: [number, number, number][]) => bars.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q))), 20, 0.0065, 6, false));
  for (const [y, r] of [
    [-0.02, 0.15],
    [-0.065, 0.14],
    [-0.105, 0.12],
  ] as const) {
    bar([
      [-0.13, y + 0.02, 0.05],
      [-0.09, y, r * 0.9],
      [0, y - 0.005, r * 1.18],
      [0.09, y, r * 0.9],
      [0.13, y + 0.02, 0.05],
    ]);
  }
  for (const x of [-0.04, 0.04]) {
    bar([
      [x, 0.0, 0.17],
      [x * 1.05, -0.06, 0.168],
      [x * 1.1, -0.11, 0.14],
    ]);
  }
  const mask = mergeGeometries(bars)!;
  return { shell, stripe, mask };
}

/**
 * A jersey on a hanger: a grid (so it can drape) with the silhouette cut out
 * by the texture's alpha. Curved around the hanger's shoulders and hanging
 * slightly bowed, with a few soft folds.
 */
export function jerseyGeometry(width = 0.66): THREE.BufferGeometry {
  const h = width * 1.25;
  const g = new THREE.PlaneGeometry(width, h, 24, 30);
  g.translate(0, -h / 2, 0); // the collar at y = 0
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const u = x / (width / 2); // -1..1
    const v = -y / h; // 0 collar .. 1 hem
    // Shoulders wrap around the hanger and the sides fall away from the viewer.
    let z = -0.1 * u * u * (1 - 0.6 * v);
    // Folds: shallow vertical waves, stronger toward the hem.
    z += 0.012 * Math.sin(u * 7.5 + 1.3) * v + 0.008 * Math.sin(u * 13 - 0.4) * v * v;
    // The hem kicks out a little where it isn't held.
    z += 0.02 * v * v;
    p.setZ(i, z);
  }
  g.computeVertexNormals();
  return g;
}

/** A hanger: hook and shoulder bar. */
export function hangerGeometry(width = 0.44): THREE.BufferGeometry {
  const hook = new THREE.TorusGeometry(0.03, 0.0045, 6, 16, Math.PI * 1.4);
  hook.rotateZ(-Math.PI * 0.2);
  hook.translate(0, 0.07, 0);
  const neck = new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6);
  neck.translate(0, 0.025, 0);
  const arm = new THREE.CylinderGeometry(0.009, 0.009, width / 2 + 0.02, 8);
  const l = arm.clone();
  l.rotateZ(Math.PI / 2 - 0.35);
  l.translate(-width / 4, -0.035, 0);
  const r = arm.clone();
  r.rotateZ(-(Math.PI / 2 - 0.35));
  r.translate(width / 4, -0.035, 0);
  return mergeGeometries([hook, neck, l, r].map((x) => x.toNonIndexed()))!;
}

/** One cleat, toe toward +Z: an upper (lofted ellipses) on a sole plate with studs. */
export function cleatGeometry(): { upper: THREE.BufferGeometry; sole: THREE.BufferGeometry } {
  // Upper: a capsule stretched into a shoe and cut flat at the bottom.
  const upper = new THREE.CapsuleGeometry(0.052, 0.2, 8, 16);
  upper.rotateX(Math.PI / 2);
  const p = upper.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i); // -0.15..0.15, toe at +z
    let y = p.getY(i);
    const heel = THREE.MathUtils.smoothstep(-z, 0.0, 0.15); // 1 at the heel
    const toe = THREE.MathUtils.smoothstep(z, 0.05, 0.15);
    y = y * (0.55 + 0.9 * heel) * (1 - 0.35 * toe);
    p.setY(i, Math.max(y, -0.018) + 0.035);
    p.setX(i, p.getX(i) * (0.78 + 0.15 * (1 - heel)));
  }
  upper.computeVertexNormals();
  const plate = new THREE.BoxGeometry(0.088, 0.012, 0.31).toNonIndexed();
  plate.translate(0, 0.012, 0);
  const studs: THREE.BufferGeometry[] = [plate];
  for (const [x, z] of [
    [-0.03, 0.11],
    [0.03, 0.11],
    [-0.032, 0.05],
    [0.032, 0.05],
    [0, 0.13],
    [-0.025, -0.09],
    [0.025, -0.09],
  ] as const) {
    const s = new THREE.CylinderGeometry(0.006, 0.009, 0.012, 6).toNonIndexed();
    s.translate(x, 0.006, z);
    studs.push(s);
  }
  return { upper, sole: mergeGeometries(studs)! };
}

/** A receiver's glove lying flat, fingers toward +Z (a hand outline, extruded thin). */
export function gloveGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.045, 0);
  s.lineTo(0.045, 0);
  s.lineTo(0.05, 0.1);
  // Fingers.
  const fingers: [number, number][] = [
    [0.036, 0.19],
    [0.012, 0.205],
    [-0.012, 0.2],
    [-0.034, 0.18],
  ];
  let x0 = 0.05;
  for (const [fx, fy] of fingers) {
    s.lineTo(x0 - 0.002, 0.1);
    s.lineTo(fx + 0.01, fy - 0.01);
    s.quadraticCurveTo(fx, fy + 0.008, fx - 0.01, fy - 0.01);
    s.lineTo(fx - 0.011, 0.1);
    x0 = fx - 0.011;
  }
  s.lineTo(-0.048, 0.095);
  // Thumb.
  s.lineTo(-0.085, 0.13);
  s.quadraticCurveTo(-0.098, 0.12, -0.09, 0.105);
  s.lineTo(-0.05, 0.05);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2); // lying flat, fingers toward -Z → flip below
  g.rotateY(Math.PI);
  return g;
}

/** A towel folded over the shelf's front edge: a strip bent 180° around a small radius, hanging on the front. */
export function towelGeometry(width = 0.24, top = 0.2, drop = 0.19): THREE.BufferGeometry {
  const segs = 28;
  const g = new THREE.PlaneGeometry(width, 1, 6, segs);
  const p = g.attributes.position as THREE.BufferAttribute;
  // Over the shelf's front edge (z = 0, top at y = 0): flat on top, a
  // quarter turn around the edge, then hanging straight down in front.
  const e = 0.012;
  const r = 0.025;
  const bend = (Math.PI / 2) * r;
  const total = top + bend + drop;
  for (let i = 0; i < p.count; i++) {
    const t = (0.5 - p.getY(i)) * total;
    const x = p.getX(i);
    let y: number;
    let z: number;
    if (t < top) {
      y = e;
      z = -top + t;
    } else if (t < top + bend) {
      const a = (t - top) / r;
      y = e - r + r * Math.cos(a);
      z = r * Math.sin(a);
    } else {
      y = e - r - (t - top - bend);
      z = r;
    }
    // A soft ripple along the hanging part.
    z += 0.006 * Math.sin(x * 40 + t * 9) * Math.min(1, Math.max(0, t - top) * 4);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}
