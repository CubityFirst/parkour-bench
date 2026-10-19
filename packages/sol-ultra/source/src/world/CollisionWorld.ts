import { Box3, Vector3, type Object3D } from 'three';

export type ColliderKind = 'solid' | 'vault' | 'wallrun';

export interface Collider {
  box: Box3;
  kind: ColliderKind;
  mesh?: Object3D;
}

/** Static, axis-aligned geometry shared by movement and level construction. */
export class CollisionWorld {
  readonly colliders: Collider[] = [];

  addBox(center: Vector3, size: Vector3, kind: ColliderKind = 'solid'): Collider {
    const collider: Collider = { box: new Box3().setFromCenterAndSize(center, size), kind };
    this.colliders.push(collider);
    return collider;
  }

  intersects(box: Box3): boolean {
    return this.colliders.some(({ box: other }) =>
      box.min.x < other.max.x - 0.0001 && box.max.x > other.min.x + 0.0001 &&
      box.min.y < other.max.y - 0.0001 && box.max.y > other.min.y + 0.0001 &&
      box.min.z < other.max.z - 0.0001 && box.max.z > other.min.z + 0.0001,
    );
  }
}
