/**
 * Axis-aligned box collision world.
 *
 * Every solid piece of the playable level is registered here as an AABB.
 * The player is also treated as an AABB (a square footprint with variable
 * height), which keeps the movement code simple, fast and very predictable.
 */

export interface ColliderFlags {
  /** Ledge recovery may not grab this box (e.g. overhead ducts meant to be slid under). */
  noMantle?: boolean;
  /** Wall running is not allowed along this box. */
  noWallRun?: boolean;
}

export interface Collider {
  id: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  flags: ColliderFlags;
}

/** Tolerance used so that touching surfaces do not count as overlapping. */
export const COLLISION_EPS = 1e-4;

export class CollisionWorld {
  readonly colliders: Collider[] = [];

  add(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    flags: ColliderFlags = {},
  ): Collider {
    const c: Collider = {
      id: this.colliders.length,
      minX: Math.min(minX, maxX),
      minY: Math.min(minY, maxY),
      minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
      maxZ: Math.max(minZ, maxZ),
      flags,
    };
    this.colliders.push(c);
    return c;
  }

  /** Collects every collider that strictly overlaps the given box. */
  overlapping(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    out: Collider[],
  ): Collider[] {
    out.length = 0;
    const e = COLLISION_EPS;
    for (const c of this.colliders) {
      if (
        maxX > c.minX + e &&
        minX < c.maxX - e &&
        maxY > c.minY + e &&
        minY < c.maxY - e &&
        maxZ > c.minZ + e &&
        minZ < c.maxZ - e
      ) {
        out.push(c);
      }
    }
    return out;
  }

  /** True when no collider overlaps the given box. */
  isFree(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const e = COLLISION_EPS;
    for (const c of this.colliders) {
      if (
        maxX > c.minX + e &&
        minX < c.maxX - e &&
        maxY > c.minY + e &&
        minY < c.maxY - e &&
        maxZ > c.minZ + e &&
        minZ < c.maxZ - e
      ) {
        return false;
      }
    }
    return true;
  }

  /** Colliders whose horizontal footprint contains the point (x, z). */
  atPoint(x: number, z: number, out: Collider[]): Collider[] {
    out.length = 0;
    for (const c of this.colliders) {
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) out.push(c);
    }
    return out;
  }

  /**
   * Highest walkable surface below `fromY` under the footprint centred on (x, z).
   * Returns -Infinity when there is nothing below.
   */
  groundBelow(x: number, z: number, halfWidth: number, fromY: number): number {
    let best = -Infinity;
    for (const c of this.colliders) {
      if (
        x + halfWidth > c.minX &&
        x - halfWidth < c.maxX &&
        z + halfWidth > c.minZ &&
        z - halfWidth < c.maxZ &&
        c.maxY <= fromY + COLLISION_EPS &&
        c.maxY > best
      ) {
        best = c.maxY;
      }
    }
    return best;
  }
}
