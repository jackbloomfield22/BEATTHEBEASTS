import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { YARD } from '../world/constants';

// Goalposts (M6: field goals and PATs). NFL dimensions: the crossbar 10 ft
// high over the end line, uprights 18 ft 6 in apart and 35 ft above the
// bar, on a gooseneck from a padded base post 2 yd behind the end line.
// Painted yellow like every pro post; no markings.

const FT = 0.3048;
const R = 0.07; // 5.5 in tube, a little heavier than the real 4 in so it reads from the broadcast camera

function tube(points: THREE.Vector3[], r = R): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.05), 24, r, 10, false);
}

/** One goalpost, the end line at z = 0, the field toward -z. */
function goalpost(): { steel: THREE.BufferGeometry; pad: THREE.BufferGeometry } {
  const bar = 10 * FT;
  const half = (18.5 * FT) / 2;
  const top = bar + 35 * FT;
  const back = 2 * YARD;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const parts = [
    // Base post and the gooseneck out over the end line.
    tube([v(0, 0, back), v(0, bar - 0.9, back), v(0, bar - 0.25, back - 0.3), v(0, bar, back - 1.1), v(0, bar, 0)], R * 1.4),
    // Crossbar.
    new THREE.CylinderGeometry(R, R, half * 2, 12).rotateZ(Math.PI / 2).translate(0, bar, 0),
    // Uprights.
    new THREE.CylinderGeometry(R * 0.85, R, top - bar, 12).translate(-half, bar + (top - bar) / 2, 0),
    new THREE.CylinderGeometry(R * 0.85, R, top - bar, 12).translate(half, bar + (top - bar) / 2, 0),
  ];
  const steel = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  const pad = new THREE.CylinderGeometry(0.22, 0.22, 2, 16).translate(0, 1, back);
  return { steel, pad };
}

export function buildGoalposts(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'goalposts';
  const { steel, pad } = goalpost();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf1c613, roughness: 0.45, metalness: 0.2 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.8 });
  const endLine = 60 * YARD; // end lines are 60 yd from midfield
  for (const s of [-1, 1]) {
    const post = new THREE.Group();
    const m = new THREE.Mesh(steel, yellow);
    m.castShadow = true;
    const p = new THREE.Mesh(pad, padMat);
    p.castShadow = true;
    post.add(m, p);
    // North (s = -1) sits at z = −60 yd facing +z (toward the field); south mirrors it.
    post.position.z = s * endLine;
    post.rotation.y = s < 0 ? Math.PI : 0;
    g.add(post);
  }
  return g;
}
