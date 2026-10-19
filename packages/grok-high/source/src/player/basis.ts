import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _look = new THREE.Vector3();
const _back = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Aim an object so its local −Z matches the look vector.
 *  Contract (also asserted by the sim self-test):
 *    yaw 0, pitch 0     → look (0, 0, −1), right (+1, 0, 0)
 *    yaw −π/2, pitch 0  → look (+1, 0, 0), right (0, 0, +1)
 *  Decreasing yaw turns the view to the right (toward +X from the default look).
 *  This is the only place yaw/pitch become a basis. Movement reads it back
 *  with readPlanarBasis.
 */
export function applyLook(obj: THREE.Object3D, yaw: number, pitch: number): void {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  _look.set(-s * cosP, sinP, -c * cosP);
  if (_look.lengthSq() < 1e-10) _look.set(0, 0, -1);
  else _look.normalize();
  _back.copy(_look).negate();
  _right.crossVectors(UP, _back);
  if (_right.lengthSq() < 1e-10) _right.set(1, 0, 0);
  else _right.normalize();
  _up.crossVectors(_back, _right).normalize();
  _m.makeBasis(_right, _up, _back);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.updateMatrixWorld();
}

/** Horizontal forward and right from an object aimed with applyLook.
 *  Reads the object's local −Z from the world matrix. Three.js cameras look
 *  down −Z; Object3D.getWorldDirection returns +Z, so the matrix is the source.
 */
export function readPlanarBasis(
  obj: THREE.Object3D,
  forward: THREE.Vector3,
  right: THREE.Vector3,
): void {
  obj.updateWorldMatrix(true, false);
  const e = obj.matrixWorld.elements;
  forward.set(-e[8], 0, -e[10]);
  if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
  else forward.normalize();
  right.crossVectors(forward, UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();
}
