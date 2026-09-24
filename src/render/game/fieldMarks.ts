import * as THREE from 'three';
import { HALF_W } from '../world/constants';

// The line of scrimmage (blue) and the line to gain (yellow), drawn on the
// turf like a broadcast's virtual lines (GDD §11.4): flat strips just above
// the grass, unlit so the grade doesn't dull them, faded at the sidelines.

function strip(color: number, opacity: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(HALF_W * 2, 0.16, 32, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  m.position.y = 0.06;
  return m;
}

export function createFieldMarks(): { group: THREE.Group; los: THREE.Mesh; gain: THREE.Mesh } {
  const group = new THREE.Group();
  group.name = 'fieldMarks';
  const los = strip(0x3f8cff, 0.75);
  const gain = strip(0xffd400, 0.8);
  group.add(los, gain);
  return { group, los, gain };
}
