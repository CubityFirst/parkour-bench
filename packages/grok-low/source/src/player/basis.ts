import * as THREE from "three";

/** World up. Not a scratch vector — never mutated. */
export const UP = new THREE.Vector3(0, 1, 0);

/**
 * Camera-relative planar basis.
 * `right = forward × up`. Canonical check: forward (0,0,−1) → right (1,0,0).
 * Callers own `outFwd` and `outRight`; this writes both and nothing else.
 */
export function planarBasis(camera: THREE.Object3D, outFwd: THREE.Vector3, outRight: THREE.Vector3): void {
  camera.getWorldDirection(outFwd);
  outFwd.y = 0;
  if (outFwd.lengthSq() < 1e-8) outFwd.set(0, 0, -1);
  else outFwd.normalize();
  outRight.crossVectors(outFwd, UP);
  if (outRight.lengthSq() < 1e-8) outRight.set(1, 0, 0);
  else outRight.normalize();
}

/** The view rig the game and the control self-test both use. Yaw, then pitch, then roll, then camera. */
export function createViewRig(aspect = 1): {
  yaw: THREE.Object3D;
  pitch: THREE.Object3D;
  roll: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
} {
  const yaw = new THREE.Object3D();
  const pitch = new THREE.Object3D();
  const roll = new THREE.Object3D();
  const camera = new THREE.PerspectiveCamera(78, aspect, 0.08, 700);
  yaw.add(pitch);
  pitch.add(roll);
  roll.add(camera);
  return { yaw, pitch, roll, camera };
}
