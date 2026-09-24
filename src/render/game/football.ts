import * as THREE from 'three';

// The ball: an official size football (11 in long, 22 in around the middle:
// a 0.14 m half-length and a 0.089 m radius), a prolate lathe with pointed
// tips, pebbled brown leather, white laces and the two stripes. Built here;
// no third-party model. The long axis is local +X.

const HALF = 0.142;
const R = 0.0855;

export function createFootball(): THREE.Group {
  const pts: THREE.Vector2[] = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = -1 + (2 * i) / N;
    // A football's profile is close to a circular arc (the "vesica"): r ∝ (1 − t²)^0.8 keeps the tips pointed.
    pts.push(new THREE.Vector2(R * Math.pow(Math.max(0, 1 - t * t), 0.8) + 0.002 * (1 - Math.abs(t)), t * HALF));
  }
  const body = new THREE.LatheGeometry(pts, 20);
  body.rotateZ(-Math.PI / 2);
  const leather = new THREE.MeshStandardMaterial({ color: 0x6a3519, roughness: 0.58, metalness: 0 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });
  const g = new THREE.Group();
  const m = new THREE.Mesh(body, leather);
  m.castShadow = true;
  g.add(m);
  // Laces: a spine along the top and eight cross stitches.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.006, 0.012), white);
  spine.position.set(0, R + 0.001, 0);
  g.add(spine);
  for (let k = 0; k < 8; k++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.005, 0.03), white);
    c.position.set(-0.044 + k * 0.0126, R + 0.001, 0);
    g.add(c);
  }
  // Stripes near each end (a ring just proud of the leather).
  for (const s of [-1, 1]) {
    const x = s * HALF * 0.62;
    const r = R * Math.pow(1 - 0.62 * 0.62, 0.8) + 0.0035;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.012, 20, 1, true), white);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = x;
    g.add(ring);
  }
  g.name = 'football';
  return g;
}
