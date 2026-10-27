import * as THREE from 'three';

export type SolidKind = 'roof' | 'obstacle' | 'wall' | 'ceiling';

export interface Solid {
  box: THREE.Box3;
  kind: SolidKind;
  vaultable?: boolean;
  runnable?: boolean;
}

const EPSILON = 0.001;

export class CollisionWorld {
  solids: Solid[] = [];

  add(center: THREE.Vector3, size: THREE.Vector3, kind: SolidKind, options: { vaultable?: boolean; runnable?: boolean } = {}): Solid {
    const solid: Solid = { box: new THREE.Box3().setFromCenterAndSize(center, size), kind, ...options };
    this.solids.push(solid);
    return solid;
  }

  moveHorizontal(position: THREE.Vector3, delta: number, axis: 'x' | 'z', radius: number, height: number): boolean {
    if (!delta) return false;
    const previous = position[axis];
    position[axis] += delta;
    let hit = false;
    const other = axis === 'x' ? 'z' : 'x';
    for (const { box } of this.solids) {
      if (position.y + height <= box.min.y + EPSILON || position.y >= box.max.y - EPSILON) continue;
      if (position[other] + radius <= box.min[other] || position[other] - radius >= box.max[other]) continue;
      if (position[axis] + radius <= box.min[axis] || position[axis] - radius >= box.max[axis]) continue;
      if (delta > 0 && previous + radius <= box.min[axis] + 0.08) {
        position[axis] = Math.min(position[axis], box.min[axis] - radius);
        hit = true;
      } else if (delta < 0 && previous - radius >= box.max[axis] - 0.08) {
        position[axis] = Math.max(position[axis], box.max[axis] + radius);
        hit = true;
      }
    }
    return hit;
  }

  moveVertical(position: THREE.Vector3, delta: number, radius: number, height: number): 'ground' | 'ceiling' | null {
    const previous = position.y;
    let target = previous + delta;
    let result: 'ground' | 'ceiling' | null = null;
    for (const { box } of this.solids) {
      if (position.x + radius <= box.min.x || position.x - radius >= box.max.x ||
          position.z + radius <= box.min.z || position.z - radius >= box.max.z) continue;
      if (delta <= 0 && previous >= box.max.y - 0.04 && target <= box.max.y) {
        if (result !== 'ground' || box.max.y > target) {
          target = box.max.y;
          result = 'ground';
        }
      } else if (delta > 0 && previous + height <= box.min.y + 0.04 && target + height >= box.min.y) {
        if (result !== 'ceiling' || box.min.y - height < target) {
          target = box.min.y - height;
          result = 'ceiling';
        }
      }
    }
    position.y = target;
    return result;
  }

  hasRoom(position: THREE.Vector3, radius: number, height: number): boolean {
    return !this.solids.some(({ box }) =>
      position.x + radius > box.min.x + EPSILON && position.x - radius < box.max.x - EPSILON &&
      position.z + radius > box.min.z + EPSILON && position.z - radius < box.max.z - EPSILON &&
      position.y + height > box.min.y + EPSILON && position.y < box.max.y - EPSILON,
    );
  }

  groundBelow(position: THREE.Vector3, radius: number, distance: number): number | null {
    let best: number | null = null;
    for (const { box } of this.solids) {
      if (position.x + radius <= box.min.x || position.x - radius >= box.max.x ||
          position.z + radius <= box.min.z || position.z - radius >= box.max.z) continue;
      if (box.max.y <= position.y + 0.05 && box.max.y >= position.y - distance && (best === null || box.max.y > best)) best = box.max.y;
    }
    return best;
  }
}
