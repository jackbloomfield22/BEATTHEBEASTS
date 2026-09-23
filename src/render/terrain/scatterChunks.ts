import * as THREE from 'three';

// Instanced scatter split into spatial chunks. One InstancedMesh per layer has
// a single bounding sphere around every plant on the headland, so it is never
// frustum culled and a caster renders in full into every shadow cascade. Per
// chunk, each mesh gets a tight sphere: the main camera and each cascade only
// draw the chunks they can see. A layer may also carry a far-LOD geometry that
// replaces its variants for whole chunks beyond `lodDistance`.

export interface ScatterLayer {
  name: string;
  /** Full-detail geometries; a chunk's instances are dealt across them in turn. */
  variants: THREE.BufferGeometry[];
  /** Low-detail stand-in drawn for chunks beyond lodDistance (optional). */
  far?: THREE.BufferGeometry;
  lodDistance?: number;
  matrices: THREE.Matrix4[];
  tints: THREE.Color[];
  castShadow: boolean;
}

export interface ChunkedScatter {
  group: THREE.Group;
  /** Pick each chunk's level of detail from the camera position (call per frame). */
  update(camera: THREE.Vector3): void;
  /** Draw this share (0..1) of every chunk's instances; placement order is random, so a prefix thins evenly. */
  setDensity(d: number): void;
  /** Draw calls with every chunk visible at its nearest level (tests and budgets). */
  readonly meshCount: number;
}

interface Chunk {
  near: THREE.InstancedMesh[];
  far: THREE.InstancedMesh | null;
  center: THREE.Vector3;
  radius: number;
  lodDistance: number;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], tints: THREE.Color[], cast: boolean, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, tints[i]!);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.userData.fullCount = mats.length;
  mesh.name = name;
  return mesh;
}

export function buildChunkedScatter(material: THREE.Material, layers: ScatterLayer[], chunkSize: number): ChunkedScatter {
  const group = new THREE.Group();
  const chunks: Chunk[] = [];
  const all: THREE.InstancedMesh[] = [];
  const p = new THREE.Vector3();
  for (const layer of layers) {
    const buckets = new Map<string, number[]>();
    layer.matrices.forEach((m, i) => {
      p.setFromMatrixPosition(m);
      const key = `${Math.floor(p.x / chunkSize)},${Math.floor(p.z / chunkSize)}`;
      const list = buckets.get(key) ?? [];
      list.push(i);
      buckets.set(key, list);
    });
    for (const [key, idx] of buckets) {
      const k = layer.variants.length;
      const near = layer.variants.map((geo, v) => {
        const mine = idx.filter((_, j) => j % k === v);
        return instanced(geo, material, mine.map((i) => layer.matrices[i]!), mine.map((i) => layer.tints[i]!), layer.castShadow, `${layer.name}:${key}:${v}`);
      });
      const far = layer.far ? instanced(layer.far, material, idx.map((i) => layer.matrices[i]!), idx.map((i) => layer.tints[i]!), layer.castShadow, `${layer.name}:${key}:far`) : null;
      const sphere = new THREE.Sphere();
      const box = new THREE.Box3();
      for (const i of idx) box.expandByPoint(p.setFromMatrixPosition(layer.matrices[i]!));
      box.getBoundingSphere(sphere);
      for (const m of near) group.add(m);
      if (far) {
        far.visible = false;
        group.add(far);
      }
      all.push(...near, ...(far ? [far] : []));
      chunks.push({ near, far, center: sphere.center, radius: sphere.radius, lodDistance: layer.lodDistance ?? Infinity });
    }
  }
  return {
    group,
    meshCount: chunks.reduce((n, c) => n + c.near.length, 0),
    update(camera) {
      for (const c of chunks) {
        if (!c.far) continue;
        const near = camera.distanceTo(c.center) - c.radius < c.lodDistance;
        for (const m of c.near) m.visible = near;
        c.far.visible = !near;
      }
    },
    setDensity(d) {
      for (const m of all) m.count = Math.round((m.userData.fullCount as number) * d);
    },
  };
}
