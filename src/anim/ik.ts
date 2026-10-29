import * as THREE from 'three';

// Analytic two-bone IK (TECH_PLAN §9.2): thigh-calf-foot and upper arm-
// forearm-hand. Solves in world space and writes local rotations, blended
// by `weight`, so it layers on top of whatever the clips posed.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dirAT = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _bNew = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _orig = new THREE.Quaternion();
const _dp = new THREE.Vector3();
const _f2 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _goal = new THREE.Vector3();
const _ds = new THREE.Vector3();

/**
 * Rotate `bone` in world space so that world direction `from` turns into `to`, blended by weight.
 * (Round 16) `fresh`: the caller has the bone's and its ancestors' world matrices up to date (the animator does: every
 * edit it makes is followed by the bone's updateMatrixWorld), so they're read as they stand. getWorldQuaternion
 * recomputes every ancestor's matrix first, to the same values; it was a sixth of the animator's cost (docs/anim/FEET16.md).
 */
export function rotateBoneWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight = 1, fresh = false): void {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(_from.copy(from).normalize(), _to.copy(to).normalize());
  if (fresh) bone.matrixWorld.decompose(_dp, _wq, _ds);
  else bone.getWorldQuaternion(_wq);
  if (bone.parent) {
    if (fresh) bone.parent.matrixWorld.decompose(_dp, _pq, _ds);
    else bone.parent.getWorldQuaternion(_pq);
  } else _pq.identity();
  _orig.copy(bone.quaternion);
  // local' = parent⁻¹ · q · world
  bone.quaternion.copy(_pq.invert()).multiply(_q).multiply(_wq);
  if (weight < 1) bone.quaternion.copy(_orig.slerp(bone.quaternion, weight));
  bone.updateMatrixWorld(true);
}

/**
 * Put `end` at `target` by rotating `upper` and `lower`; the middle joint
 * bends toward `pole` (a world point, e.g. in front of the knee). Returns the
 * distance left between `end` and `target` (0 when reachable).
 */
export function solveTwoBone(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, weight = 1, fresh = false): number {
  if (weight <= 0) return 0;
  // (Round 16) `fresh`: the world matrices are up to date (rotateBoneWorld).
  const wp = fresh ? (o: THREE.Object3D, v: THREE.Vector3) => v.setFromMatrixPosition(o.matrixWorld) : (o: THREE.Object3D, v: THREE.Vector3) => o.getWorldPosition(v);
  wp(upper, _a);
  wp(lower, _b);
  wp(end, _c);
  _t.copy(target);
  const la = _a.distanceTo(_b);
  const lb = _b.distanceTo(_c);
  const want = THREE.MathUtils.clamp(_a.distanceTo(_t), Math.abs(la - lb) + 1e-4, la + lb - 1e-4);
  _dirAT.subVectors(_t, _a).normalize();
  // Bend plane: toward the pole, perpendicular to the line to the target.
  _perp.subVectors(pole, _a);
  _perp.addScaledVector(_dirAT, -_perp.dot(_dirAT));
  if (_perp.lengthSq() < 1e-10) {
    _perp.subVectors(_b, _a);
    _perp.addScaledVector(_dirAT, -_perp.dot(_dirAT));
  }
  _perp.normalize();
  // Law of cosines: the angle at the root between the target line and the upper bone.
  const cosA = THREE.MathUtils.clamp((la * la + want * want - lb * lb) / (2 * la * want), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _bNew.copy(_a).addScaledVector(_dirAT, la * cosA).addScaledVector(_perp, la * sinA);
  // Upper bone: old direction (a→b) to new (a→b').
  rotateBoneWorld(upper, _f2.subVectors(_b, _a), _t2.subVectors(_bNew, _a), weight, fresh);
  // Lower bone: re-read after the upper moved, then aim at the target.
  wp(lower, _b);
  wp(end, _c);
  const goal = _goal.copy(_a).addScaledVector(_dirAT, want);
  rotateBoneWorld(lower, _f2.subVectors(_c, _b), _t2.subVectors(goal, _b), weight, fresh);
  wp(end, _c);
  return _c.distanceTo(target);
}
