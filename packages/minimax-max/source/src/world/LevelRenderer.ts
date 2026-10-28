import {
  BoxGeometry,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { Level } from './Level';
import type { MaterialKey, MaterialSet } from './Materials';

/**
 * Turns the level description into instanced meshes.
 *
 * Every block of the level shares one unit cube geometry, so the whole
 * rooftop city only needs a handful of draw calls.
 */
export function buildLevelMeshes(level: Level, materials: MaterialSet): Group {
  const group = new Group();
  group.name = 'level';

  const geometry = new BoxGeometry(1, 1, 1);
  const buckets = new Map<MaterialKey, Matrix4[]>();
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();

  for (const block of level.blocks) {
    position.set(block.x, block.y, block.z);
    euler.set(0, block.rotY, 0);
    quaternion.setFromEuler(euler);
    scale.set(block.w, block.h, block.d);
    matrix.compose(position, quaternion, scale);
    let bucket = buckets.get(block.mat);
    if (!bucket) {
      bucket = [];
      buckets.set(block.mat, bucket);
    }
    bucket.push(matrix.clone());
  }

  for (const [key, matrices] of buckets) {
    const mesh = new InstancedMesh(geometry, materials[key], matrices.length);
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `level-${key}`;
    group.add(mesh);
  }

  // Poles (antennas, pipes) share a single cylinder geometry.
  if (level.poles.length > 0) {
    const poleBuckets = new Map<MaterialKey, Matrix4[]>();
    for (const pole of level.poles) {
      position.set(pole.x, pole.y, pole.z);
      euler.set(pole.rotX, 0, pole.rotZ);
      quaternion.setFromEuler(euler);
      scale.set(pole.r, pole.h, pole.r);
      matrix.compose(position, quaternion, scale);
      let bucket = poleBuckets.get(pole.mat);
      if (!bucket) {
        bucket = [];
        poleBuckets.set(pole.mat, bucket);
      }
      bucket.push(matrix.clone());
    }
    const poleGeometry = new CylinderGeometry(1, 1, 1, 10, 1);
    for (const [key, matrices] of poleBuckets) {
      const mesh = new InstancedMesh(poleGeometry, materials[key], matrices.length);
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  return group;
}
