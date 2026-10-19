import { Vector3 } from 'three';

export interface Collider {
  min: Vector3;
  max: Vector3;
  kind: 'solid' | 'vault' | 'wallrun';
  name?: string;
}

/** Static, axis-aligned solids. The controller filters locally before resolving motion. */
export class CollisionWorld {
  readonly colliders: Collider[] = [];

  add(center: Vector3, size: Vector3, kind: Collider['kind'] = 'solid', name?: string): Collider {
    const half = size.clone().multiplyScalar(0.5);
    const collider = { min: center.clone().sub(half), max: center.clone().add(half), kind, name };
    this.colliders.push(collider);
    return collider;
  }
}
