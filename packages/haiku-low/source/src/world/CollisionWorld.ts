import { Vector3 } from 'three';

/** Axis-aligned solid volume. `wallRun` marks surfaces that can be ridden while airborne. */
export interface Box {
  readonly min: Vector3;
  readonly max: Vector3;
  readonly wallRun: boolean;
}

/** Static world geometry used for all collision queries. */
export class CollisionWorld {
  readonly boxes: Box[] = [];

  addBox(min: Vector3, max: Vector3, wallRun = false): void {
    this.boxes.push({ min: min.clone(), max: max.clone(), wallRun });
  }

  /** Returns the first box strictly overlapping [min, max] that passes the optional filter. */
  findOverlap(min: Vector3, max: Vector3, filter?: (box: Box) => boolean): Box | null {
    for (const box of this.boxes) {
      if (filter && !filter(box)) continue;
      if (
        box.min.x < max.x && box.max.x > min.x &&
        box.min.y < max.y && box.max.y > min.y &&
        box.min.z < max.z && box.max.z > min.z
      ) {
        return box;
      }
    }
    return null;
  }

  overlaps(min: Vector3, max: Vector3): boolean {
    return this.findOverlap(min, max) !== null;
  }
}
