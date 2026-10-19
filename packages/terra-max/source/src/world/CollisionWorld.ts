import * as THREE from 'three';

export type ColliderOptions = {
  id?: string;
  solid?: boolean;
  landing?: boolean;
  runnable?: boolean;
  vaultable?: boolean;
};

export type Collider = ColliderOptions & {
  box: THREE.Box3;
};

export type WallContact = {
  collider: Collider;
  normal: THREE.Vector3;
};

/**
 * A deliberately small collision layer. The runner is treated as a vertical
 * capsule footprint (a radius in X/Z and a height in Y), which is reliable for
 * the crisp, orthogonal architecture used by the course.
 */
export class CollisionWorld {
  readonly colliders: Collider[] = [];

  addBox(center: THREE.Vector3, size: THREE.Vector3, options: ColliderOptions = {}): Collider {
    const half = size.clone().multiplyScalar(0.5);
    const collider: Collider = {
      ...options,
      box: new THREE.Box3(center.clone().sub(half), center.clone().add(half)),
    };
    this.colliders.push(collider);
    return collider;
  }

  resolveHorizontal(position: THREE.Vector3, height: number, radius: number, dx: number, dz: number): void {
    if (dx !== 0) {
      position.x += dx;
      for (const collider of this.colliders) {
        if (!collider.solid || !this.intersectsBody(position, height, radius, collider.box)) continue;
        position.x = dx > 0 ? collider.box.min.x - radius : collider.box.max.x + radius;
      }
    }

    if (dz !== 0) {
      position.z += dz;
      for (const collider of this.colliders) {
        if (!collider.solid || !this.intersectsBody(position, height, radius, collider.box)) continue;
        position.z = dz > 0 ? collider.box.min.z - radius : collider.box.max.z + radius;
      }
    }
  }

  findGround(position: THREE.Vector3, radius: number, previousY: number, nextY: number): number | null {
    let ground: number | null = null;
    for (const collider of this.colliders) {
      if (!collider.landing || !this.overlapsXZ(position, radius, collider.box)) continue;
      const top = collider.box.max.y;
      if (previousY >= top - 0.03 && nextY <= top + 0.001 && (ground === null || top > ground)) {
        ground = top;
      }
    }
    return ground;
  }

  resolveCeiling(position: THREE.Vector3, height: number, radius: number, previousY: number, nextY: number): number | null {
    const previousHead = previousY + height;
    const nextHead = nextY + height;
    let ceiling: number | null = null;
    for (const collider of this.colliders) {
      if (!collider.solid || !this.overlapsXZ(position, radius, collider.box)) continue;
      if (previousHead <= collider.box.min.y + 0.01 && nextHead >= collider.box.min.y) {
        ceiling = ceiling === null ? collider.box.min.y : Math.min(ceiling, collider.box.min.y);
      }
    }
    return ceiling;
  }

  findRunnableWall(position: THREE.Vector3, height: number, radius: number): WallContact | null {
    let closest: WallContact | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const collider of this.colliders) {
      if (!collider.runnable) continue;
      const { box } = collider;
      if (position.y + height < box.min.y + 0.2 || position.y > box.max.y - 0.2) continue;

      if (position.z > box.min.z - radius && position.z < box.max.z + radius) {
        const leftDistance = Math.abs(position.x - box.min.x);
        const rightDistance = Math.abs(position.x - box.max.x);
        if (leftDistance <= radius + 0.32 && leftDistance < closestDistance) {
          closest = { collider, normal: new THREE.Vector3(-1, 0, 0) };
          closestDistance = leftDistance;
        }
        if (rightDistance <= radius + 0.32 && rightDistance < closestDistance) {
          closest = { collider, normal: new THREE.Vector3(1, 0, 0) };
          closestDistance = rightDistance;
        }
      }

      if (position.x > box.min.x - radius && position.x < box.max.x + radius) {
        const nearDistance = Math.abs(position.z - box.min.z);
        const farDistance = Math.abs(position.z - box.max.z);
        if (nearDistance <= radius + 0.32 && nearDistance < closestDistance) {
          closest = { collider, normal: new THREE.Vector3(0, 0, -1) };
          closestDistance = nearDistance;
        }
        if (farDistance <= radius + 0.32 && farDistance < closestDistance) {
          closest = { collider, normal: new THREE.Vector3(0, 0, 1) };
          closestDistance = farDistance;
        }
      }
    }
    return closest;
  }

  findVault(position: THREE.Vector3, height: number, forward: THREE.Vector3): Collider | null {
    let winner: Collider | null = null;
    let winnerDistance = Number.POSITIVE_INFINITY;
    for (const collider of this.colliders) {
      if (!collider.vaultable) continue;
      const center = collider.box.getCenter(new THREE.Vector3());
      const toObstacle = center.sub(position);
      const horizontal = new THREE.Vector3(toObstacle.x, 0, toObstacle.z);
      const distance = horizontal.length();
      if (distance < 0.2 || distance > 2.15 || horizontal.normalize().dot(forward) < 0.65) continue;
      if (collider.box.max.y - position.y > height * 0.72) continue;
      if (distance < winnerDistance) {
        winner = collider;
        winnerDistance = distance;
      }
    }
    return winner;
  }

  canStand(position: THREE.Vector3, height: number, radius: number): boolean {
    return !this.colliders.some((collider) => collider.solid && this.intersectsBody(position, height, radius, collider.box));
  }

  private intersectsBody(position: THREE.Vector3, height: number, radius: number, box: THREE.Box3): boolean {
    return (
      position.x + radius > box.min.x &&
      position.x - radius < box.max.x &&
      position.z + radius > box.min.z &&
      position.z - radius < box.max.z &&
      position.y + height > box.min.y + 0.001 &&
      position.y < box.max.y - 0.001
    );
  }

  private overlapsXZ(position: THREE.Vector3, radius: number, box: THREE.Box3): boolean {
    return position.x + radius > box.min.x && position.x - radius < box.max.x && position.z + radius > box.min.z && position.z - radius < box.max.z;
  }
}
