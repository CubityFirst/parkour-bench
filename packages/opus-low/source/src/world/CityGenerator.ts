import * as THREE from 'three';
import { GeometryBuilder, Materials } from './Materials';
import { GROUND_Y } from './Level';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Background city surrounding the playable route. Buildings are merged into
 * a handful of meshes (one per material); rooftop clutter uses an InstancedMesh.
 */
export function generateCity(mats: Materials): THREE.Group {
  const rand = mulberry32(1337);
  const group = new THREE.Group();
  const facade = new GeometryBuilder(4, 3.5);
  const glass = new GeometryBuilder(3, 3);
  const roofs = new GeometryBuilder(6, 6);
  const clutter: THREE.Matrix4[] = [];

  for (let gx = -340; gx <= 340; gx += 30) {
    for (let gz = 160; gz >= -680; gz -= 30) {
      const x = gx + (rand() - 0.5) * 8, z = gz + (rand() - 0.5) * 8;
      // Keep the corridor around the playable route clear.
      if (Math.abs(x) < 32 && z < 30 && z > -340) continue;
      const w = 12 + rand() * 12, d = 12 + rand() * 12;
      const dist = Math.hypot(x, z + 150);
      const isTower = rand() < 0.3;
      let top = -30 + rand() * 32;
      if (isTower) top = 10 + rand() * (dist > 150 ? 130 : 70);
      else if (dist > 200) top += rand() * 30;
      if (Math.abs(x) < 50 && z < 40 && z > -340) top = Math.min(top, -4 - rand() * 10);
      const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
      (isTower ? glass : facade).addBox(x0, GROUND_Y, z0, x1, top, z1, { sides: true, top: false });
      roofs.addBox(x0, top - 0.2, z0, x1, top, z1, { sides: false, top: true });
      if (!isTower) {
        for (let i = 0; i < 3; i++) {
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(x0 + 2 + rand() * (w - 4), top + 0.6, z0 + 2 + rand() * (d - 4)),
            new THREE.Quaternion(),
            new THREE.Vector3(1 + rand() * 2, 1.2, 1 + rand() * 2),
          );
          clutter.push(m);
        }
      }
    }
  }
  for (const mesh of [facade.build(mats.facade, false), glass.build(mats.glass, false), roofs.build(mats.roof, false)]) {
    mesh.receiveShadow = false;
    group.add(mesh);
  }

  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.gray, clutter.length);
  clutter.forEach((m, i) => inst.setMatrixAt(i, m));
  group.add(inst);

  // Street level far below.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND_Y, -200);
  group.add(ground);
  return group;
}
