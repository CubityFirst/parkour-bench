import * as THREE from 'three';
import type { Box, Trigger, VaultTarget } from '../types';

const EPS = 0.0001;

export class CollisionWorld {
  solids: Box[] = [];
  triggers: Trigger[] = [];

  add(box: Box): Box { this.solids.push(box); return box; }

  containsXZ(box: Box, position: THREE.Vector3, radius: number): boolean {
    return position.x + radius > box.min.x && position.x - radius < box.max.x &&
      position.z + radius > box.min.z && position.z - radius < box.max.z;
  }

  move(position: THREE.Vector3, delta: THREE.Vector3, radius: number, height: number): { grounded: boolean; ceiling: boolean; hitX: boolean; hitZ: boolean } {
    const result = { grounded: false, ceiling: false, hitX: false, hitZ: false };
    position.x += delta.x;
    for (const box of this.solids) {
      if (!this.containsXZ(box, position, radius) || position.y + height <= box.min.y + EPS || position.y >= box.max.y - EPS) continue;
      if (delta.x > 0) position.x = box.min.x - radius - EPS;
      else if (delta.x < 0) position.x = box.max.x + radius + EPS;
      result.hitX = true;
    }
    position.z += delta.z;
    for (const box of this.solids) {
      if (!this.containsXZ(box, position, radius) || position.y + height <= box.min.y + EPS || position.y >= box.max.y - EPS) continue;
      if (delta.z > 0) position.z = box.min.z - radius - EPS;
      else if (delta.z < 0) position.z = box.max.z + radius + EPS;
      result.hitZ = true;
    }
    position.y += delta.y;
    for (const box of this.solids) {
      if (!this.containsXZ(box, position, radius)) continue;
      if (delta.y < 0 && position.y < box.max.y && position.y - delta.y >= box.max.y - EPS) {
        position.y = box.max.y;
        result.grounded = true;
      }
      if (delta.y > 0 && position.y + height > box.min.y && position.y + height - delta.y <= box.min.y + EPS) {
        position.y = box.min.y - height - EPS;
        result.ceiling = true;
      }
    }
    return result;
  }

  findRunnableWall(position: THREE.Vector3, radius: number): THREE.Vector3 | null {
    for (const box of this.solids) {
      if (!box.runnable || position.y + 0.4 < box.min.y || position.y > box.max.y) continue;
      const nearZ = position.z > box.min.z - radius && position.z < box.max.z + radius;
      const nearX = position.x > box.min.x - radius && position.x < box.max.x + radius;
      if (nearZ && Math.abs(position.x - box.min.x) < radius) return new THREE.Vector3(-1, 0, 0);
      if (nearZ && Math.abs(position.x - box.max.x) < radius) return new THREE.Vector3(1, 0, 0);
      if (nearX && Math.abs(position.z - box.min.z) < radius) return new THREE.Vector3(0, 0, -1);
      if (nearX && Math.abs(position.z - box.max.z) < radius) return new THREE.Vector3(0, 0, 1);
    }
    return null;
  }

  vaultAhead(position: THREE.Vector3, forward: THREE.Vector3, radius: number): VaultTarget | null {
    for (const box of this.solids) {
      if (!box.vaultable || box.max.y > position.y + 1.35 || box.max.y < position.y + 0.2) continue;
      const center = box.min.clone().add(box.max).multiplyScalar(0.5);
      const dx = center.x - position.x;
      const dz = center.z - position.z;
      if (Math.sqrt(dx * dx + dz * dz) > 1.75 || forward.x * dx + forward.z * dz < 0.15) continue;
      const target = center.add(forward.clone().multiplyScalar(1.35));
      // A vault clears the obstacle and lands back on the runner's current deck,
      // rather than placing the player on top of a waist-high prop.
      target.y = position.y;
      return { box, target };
    }
    return null;
  }

  ledgeAhead(position: THREE.Vector3, forward: THREE.Vector3): THREE.Vector3 | null {
    for (const box of this.solids) {
      const top = box.max.y;
      if (top < position.y + 0.25 || top > position.y + 2.25) continue;
      const center = box.min.clone().add(box.max).multiplyScalar(0.5);
      const offset = new THREE.Vector3(center.x - position.x, 0, center.z - position.z);
      if (offset.length() > 2.05 || offset.dot(forward) < 0.45) continue;
      const target = position.clone().add(forward.clone().multiplyScalar(1.25));
      target.y = top;
      if (target.x > box.min.x + 0.5 && target.x < box.max.x - 0.5 && target.z > box.min.z + 0.5 && target.z < box.max.z - 0.5) return target;
    }
    return null;
  }

  getTriggers(position: THREE.Vector3): Trigger[] {
    return this.triggers.filter((trigger) =>
      Math.abs(position.x - trigger.center.x) < trigger.size.x / 2 &&
      Math.abs(position.y - trigger.center.y) < trigger.size.y / 2 &&
      Math.abs(position.z - trigger.center.z) < trigger.size.z / 2
    );
  }
}
