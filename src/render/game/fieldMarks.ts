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

/**
 * The landing reticle (M5.5): where the throw would come down while the user
 * holds a receiver's icon. The ring's radius is the throw's error cone (one
 * sigma, scaled per frame), the dot the intended spot. Lime, the HUD accent.
 */
function landing(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'landing';
  const mat = new THREE.MeshBasicMaterial({ color: 0xaaff00, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), mat);
  ring.name = 'cone';
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24).rotateX(-Math.PI / 2), mat);
  ring.renderOrder = dot.renderOrder = 3;
  g.add(ring, dot);
  g.position.y = 0.07;
  g.visible = false;
  return g;
}

export function createFieldMarks(): { group: THREE.Group; los: THREE.Mesh; gain: THREE.Mesh; land: THREE.Group } {
  const group = new THREE.Group();
  group.name = 'fieldMarks';
  const los = strip(0x3f8cff, 0.75);
  const gain = strip(0xffd400, 0.8);
  const land = landing();
  group.add(los, gain, land);
  return { group, los, gain, land };
}
