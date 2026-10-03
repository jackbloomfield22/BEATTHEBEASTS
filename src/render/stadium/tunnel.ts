import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TUNNEL } from '../world/constants';

// The Contenders' tunnel mouth (M7, the tunnel reveal; GDD §12.1: "the
// tunnel is cut into the rock under the north stands"). A covered portal
// from the field wall out onto the apron, so the camera that walked out of
// the locker room's corridor comes out of a real tunnel into the bowl, and
// the team runs out of it. Built to match the room's corridor (render/locker
// room.ts): graphite walls, a strip-lit ceiling, a lime rule down the floor
// and a lime frame round the opening, the visitors' color, no marks.
//
// Cost: four meshes (shell, lining, light strips, lime trim), ~400
// triangles; only the shell casts a shadow (it puts the inside in shade, so
// the team comes out of the dark into the sun). No lights: the strips are
// emissive and the inside is lit by the sky like everything else.

const T = TUNNEL;
/** Wall and roof thickness (m). */
const WALL = 0.55;

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** A plane facing `n` (one of ±x, ±y, ±z), centered at c, size w × h. */
function panel(c: [number, number, number], w: number, h: number, n: 'x+' | 'x-' | 'y-' | 'y+' | 'z+'): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (n === 'x+') g.rotateY(Math.PI / 2);
  else if (n === 'x-') g.rotateY(-Math.PI / 2);
  else if (n === 'y-') g.rotateX(Math.PI / 2);
  else if (n === 'y+') g.rotateX(-Math.PI / 2);
  return g.translate(...c);
}

const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;

export function buildTunnel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tunnel';
  const hw = T.width / 2;
  const x0 = T.x - hw;
  const x1 = T.x + hw;
  const depth = T.mouth - T.back;
  const zc = (T.back + T.mouth) / 2;
  const top = T.height + WALL;

  // The shell: two side walls, the roof slab, and a deeper fascia round the
  // mouth (the portal's face reads as a frame, not a box's thin edge).
  const shell = merge([
    box(x0 - WALL, x0, 0, top, T.back, T.mouth),
    box(x1, x1 + WALL, 0, top, T.back, T.mouth),
    box(x0 - WALL, x1 + WALL, T.height, top, T.back, T.mouth),
    box(x0 - WALL - 0.25, x0 - WALL, 0, top + 0.25, T.mouth - 0.9, T.mouth),
    box(x1 + WALL, x1 + WALL + 0.25, 0, top + 0.25, T.mouth - 0.9, T.mouth),
    box(x0 - WALL - 0.25, x1 + WALL + 0.25, top, top + 0.25, T.mouth - 0.9, T.mouth),
  ]);
  // Board-formed concrete, a shade darker than the bowl's (it sits in the stand's shadow most of the day).
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x6b6862, roughness: 0.86, metalness: 0 });
  const shellMesh = new THREE.Mesh(shell, shellMat);
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;

  // The lining: graphite walls and ceiling, a dark rubber floor, the back
  // wall black (the corridor runs on into the dark under the stands).
  const lining = merge([
    panel([x0 + 0.01, T.height / 2, zc], depth, T.height, 'x+'),
    panel([x1 - 0.01, T.height / 2, zc], depth, T.height, 'x-'),
    panel([T.x, T.height - 0.01, zc], T.width, depth, 'y-'),
    panel([T.x, 0.025, zc + 0.15], T.width, depth + 0.3, 'y+'),
    panel([T.x, T.height / 2, T.back + 0.02], T.width, T.height, 'z+'),
  ]);
  // A faint self-light stands in for the strips' bounce (no light in the loop for it).
  const liningMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, emissive: 0x16171a, emissiveIntensity: 1, roughness: 0.9, metalness: 0 });
  const liningMesh = new THREE.Mesh(lining, liningMat);
  liningMesh.receiveShadow = true;

  // Ceiling strips every 2 m (as in the room's corridor), the brightest thing in the tunnel.
  const strips: THREE.BufferGeometry[] = [];
  for (let z = T.back + 1.2; z < T.mouth - 0.4; z += 2) strips.push(panel([T.x, T.height - 0.03, z], 2.2, 0.22, 'y-'));
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff4e6, emissiveIntensity: 3.2, roughness: 1 });
  const stripMesh = new THREE.Mesh(merge(strips), stripMat);

  // Lime: the frame round the opening and the rule down the floor (the room's door and corridor wear the same).
  const f = 0.09;
  const z = T.mouth + 0.005;
  const trim = merge([
    box(x0 - f, x0, 0, T.height + f, z - 0.02, z + 0.02),
    box(x1, x1 + f, 0, T.height + f, z - 0.02, z + 0.02),
    box(x0 - f, x1 + f, T.height, T.height + f, z - 0.02, z + 0.02),
    panel([T.x, 0.03, zc + 0.1], 0.12, depth + 0.2, 'y+'),
  ]);
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9cff1a, emissiveIntensity: 1.6, roughness: 1 });
  const trimMesh = new THREE.Mesh(trim, trimMat);

  g.add(shellMesh, liningMesh, stripMesh, trimMesh);
  return g;
}
