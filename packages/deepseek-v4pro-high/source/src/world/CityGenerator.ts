import * as THREE from 'three';

/** Deterministic PRNG (mulberry32) for a stable, reproducible skyline. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates the background city skyline: many distant buildings (concrete and
 * glass) rendered as instanced meshes. These are purely visual and are not
 * colliders. The playable corridor is kept clear so the route stays readable.
 */
export class CityGenerator {
  generate(scene: THREE.Scene): void {
    const rng = mulberry32(1337);

    const corridorX0 = -45;
    const corridorX1 = 295;
    const corridorZ0 = -18;
    const corridorZ1 = 18;

    const whiteGeo = new THREE.BoxGeometry(1, 1, 1);
    const glassGeo = new THREE.BoxGeometry(1, 1, 1);

    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xe7ebef,
      roughness: 0.95,
      metalness: 0.02,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x9fd0ef,
      roughness: 0.15,
      metalness: 0.9,
    });

    const whiteList: { pos: THREE.Vector3; scale: THREE.Vector3; shade: number }[] = [];
    const glassList: { pos: THREE.Vector3; scale: THREE.Vector3; shade: number }[] = [];

    const count = 240;
    for (let i = 0; i < count; i++) {
      const x = (rng() - 0.5) * 820;
      const z = (rng() - 0.5) * 820;

      // keep the play corridor clear
      if (x > corridorX0 - 10 && x < corridorX1 + 10 && z > corridorZ0 - 10 && z < corridorZ1 + 10) {
        continue;
      }

      const isGlass = rng() < 0.34;
      const sx = 6 + rng() * 20;
      const sz = 6 + rng() * 20;
      const top = isGlass ? 24 + rng() * 56 : 4 + rng() * 34;
      const base = -60;
      const sy = top - base;
      const cy = (top + base) / 2;

      const shade = 0.82 + rng() * 0.18;
      const entry = {
        pos: new THREE.Vector3(x, cy, z),
        scale: new THREE.Vector3(sx, sy, sz),
        shade,
      };
      if (isGlass) glassList.push(entry);
      else whiteList.push(entry);
    }

    this.placeInstances(scene, whiteGeo, whiteMat, whiteList, true);
    this.placeInstances(scene, glassGeo, glassMat, glassList, false);
  }

  private placeInstances(
    scene: THREE.Scene,
    geo: THREE.BoxGeometry,
    mat: THREE.MeshStandardMaterial,
    list: { pos: THREE.Vector3; scale: THREE.Vector3; shade: number }[],
    tint: boolean,
  ): void {
    if (list.length === 0) {
      geo.dispose();
      mat.dispose();
      return;
    }

    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const color = new THREE.Color();

    list.forEach((b, i) => {
      m.compose(b.pos, q, b.scale);
      mesh.setMatrixAt(i, m);
      if (tint) {
        color.setScalar(b.shade);
        mesh.setColorAt(i, color);
      }
    });

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }
}
