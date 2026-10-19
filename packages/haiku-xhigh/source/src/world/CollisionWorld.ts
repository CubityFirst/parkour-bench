export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A static axis-aligned box the player can collide with.
 * The flags describe how parkour interacts with the box; they are set in Level.ts.
 */
export interface BoxCollider {
  min: Vec3;
  max: Vec3;
  /** Vertical face that can be wall-run. Only tall surfaces should set this. */
  wallRun?: boolean;
  /** Low obstacle that E can vault over. */
  vaultable?: boolean;
  /** Ledge that the player can mantle onto when they bump into it while airborne. */
  climbable?: boolean;
}

/** Penetration tolerance: faces that merely touch do not count as overlapping. */
export const EPS = 1e-4;

export function overlapsBox(min: Vec3, max: Vec3, b: BoxCollider): boolean {
  return (
    min.x < b.max.x - EPS &&
    max.x > b.min.x + EPS &&
    min.y < b.max.y - EPS &&
    max.y > b.min.y + EPS &&
    min.z < b.max.z - EPS &&
    max.z > b.min.z + EPS
  );
}

/** True if the point lies inside the (inclusive) box [min, max]. */
export function containsPoint(p: Vec3, min: Vec3, max: Vec3): boolean {
  return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;
}

/**
 * Static collision world. Colliders never move, so the physics engine can
 * sweep against them directly without a broadphase.
 */
export class CollisionWorld {
  readonly boxes: BoxCollider[] = [];

  add(box: BoxCollider): void {
    this.boxes.push(box);
  }

  /** True if the given AABB overlaps any collider. */
  overlaps(min: Vec3, max: Vec3): boolean {
    for (const b of this.boxes) {
      if (overlapsBox(min, max, b)) return true;
    }
    return false;
  }
}
