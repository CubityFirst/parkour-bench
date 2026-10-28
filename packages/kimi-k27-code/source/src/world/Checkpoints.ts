import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld.js';

export interface CheckpointDef {
  position: THREE.Vector3;
  radius: number;
  index: number;
}

export class Checkpoints {
  list: CheckpointDef[] = [];
  triggers: THREE.Mesh[] = [];
  private material: THREE.MeshBasicMaterial;
  private ringGeo: THREE.RingGeometry;

  constructor(private world: CollisionWorld, private root: THREE.Object3D) {
    this.material = new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
    this.ringGeo = new THREE.RingGeometry(0.7, 1, 32);
  }

  add(position: THREE.Vector3, radius = 2, index: number) {
    this.list.push({ position: position.clone(), radius, index });
    const ring = new THREE.Mesh(this.ringGeo, this.material.clone());
    ring.position.copy(position);
    ring.position.y += 0.05;
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(radius);
    this.root.add(ring);
    this.triggers.push(ring);

    // Invisible collision box for ray queries (not used directly, but keeps list consistent)
    const r = radius;
    this.world.addBox(
      new THREE.Vector3(position.x - r, position.y - 2, position.z - r),
      new THREE.Vector3(position.x + r, position.y + 2, position.z + r),
      'trigger',
      { type: 'checkpoint', index }
    );
  }

  checkPlayer(pos: THREE.Vector3, currentIndex: number): number | null {
    for (let i = 0; i < this.list.length; i++) {
      const cp = this.list[i];
      if (cp.index <= currentIndex) continue;
      const dx = pos.x - cp.position.x;
      const dz = pos.z - cp.position.z;
      if (dx * dx + dz * dz <= cp.radius * cp.radius) {
        return cp.index;
      }
    }
    return null;
  }

  reset() {
    this.triggers.forEach((t) => this.root.remove(t));
    this.triggers.length = 0;
    this.list.length = 0;
  }
}
