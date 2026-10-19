import * as THREE from 'three';
import type { MaterialSet } from './Materials';

/** Distant skyline. Kept outside the playable footprint so missed jumps fall clean. */
export function buildCity(
  scene: THREE.Scene,
  mats: MaterialSet,
  avoid: { minX: number; maxX: number; minZ: number; maxZ: number },
): void {
  const count = 90;
  const concrete = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.cityConcrete, count);
  const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.cityGlass, count);
  concrete.castShadow = false;
  glass.castShadow = false;
  concrete.receiveShadow = true;
  glass.receiveShadow = true;

  const caps: THREE.Matrix4[] = [];
  let ci = 0;
  let gi = 0;
  const rand = mulberry(42);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  let guard = 0;
  while ((ci < count || gi < count) && guard < 800) {
    guard++;
    const x = (rand() * 2 - 1) * 230;
    const z = (rand() * 2 - 1) * 280 - 40;
    const w = 8 + rand() * 16;
    const d = 8 + rand() * 16;
    if (overlapsAvoid(x, z, w, d, avoid, 8)) continue;
    const top = 18 + rand() * 78;
    const glassBuilding = rand() > 0.45;
    p.set(x, top / 2, z);
    s.set(w, top, d);
    m.compose(p, q, s);
    if (glassBuilding && gi < count) {
      glass.setMatrixAt(gi++, m.clone());
    } else if (ci < count) {
      concrete.setMatrixAt(ci++, m.clone());
    }
    const cap = new THREE.Matrix4();
    cap.compose(new THREE.Vector3(x, top + 0.2, z), q, new THREE.Vector3(w + 0.6, 0.4, d + 0.6));
    caps.push(cap);
  }
  concrete.count = ci;
  glass.count = gi;
  scene.add(concrete, glass);

  if (caps.length) {
    const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.roof, caps.length);
    capMesh.castShadow = false;
    capMesh.receiveShadow = true;
    for (let i = 0; i < caps.length; i++) capMesh.setMatrixAt(i, caps[i]);
    scene.add(capMesh);
  }

  // A few soft clouds, basic material, no lighting cost.
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const cloudGeo = new THREE.SphereGeometry(1, 8, 6);
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Mesh(cloudGeo, cloudMat);
    c.position.set((i - 3) * 38, 78 + (i % 3) * 6, -40 - i * 28);
    c.scale.set(16 + (i % 3) * 4, 4.5, 8);
    scene.add(c);
  }
}

function overlapsAvoid(
  x: number,
  z: number,
  w: number,
  d: number,
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  pad: number,
): boolean {
  return !(
    x + w / 2 < a.minX - pad ||
    x - w / 2 > a.maxX + pad ||
    z + d / 2 < a.minZ - pad ||
    z - d / 2 > a.maxZ + pad
  );
}

function mulberry(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
