import * as THREE from 'three';

/**
 * Axis aligned bounding box used for every solid piece of the level.
 * Plain numbers instead of Vector3s keep the broad-phase cheap.
 */
export interface Collider {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Can be vaulted over (waist height obstacles). */
  vaultable: boolean;
  /** Visually marked as a wall-run surface. */
  wallrun: boolean;
  /** Kind of surface, used for audio + footstep reactions. */
  kind: 'roof' | 'wall' | 'prop' | 'duct' | 'glass' | 'parapet';
  id: number;
}

export interface ColliderOptions {
  vaultable?: boolean;
  wallrun?: boolean;
  kind?: Collider['kind'];
}

/**
 * Static collision geometry of the playable level.
 *
 * The world is intentionally simple: a flat list of AABBs, queried with a
 * linear broad-phase. The playable level only contains a few hundred boxes,
 * which is far cheaper than maintaining a BVH and keeps movement completely
 * deterministic.
 */
export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private nextId = 1;
  /** Scratch list reused by queries to avoid per-frame allocations. */
  readonly scratch: Collider[] = [];

  add(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    options: ColliderOptions = {}
  ): Collider {
    const collider: Collider = {
      minX: Math.min(minX, maxX),
      minY: Math.min(minY, maxY),
      minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
      maxZ: Math.max(minZ, maxZ),
      vaultable: options.vaultable ?? false,
      wallrun: options.wallrun ?? false,
      kind: options.kind ?? 'wall',
      id: this.nextId++,
    };
    this.colliders.push(collider);
    return collider;
  }

  /** Adds a box from its centre and full size. */
  addBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    options: ColliderOptions = {}
  ): Collider {
    return this.add(
      cx - sx / 2,
      cy - sy / 2,
      cz - sz / 2,
      cx + sx / 2,
      cy + sy / 2,
      cz + sz / 2,
      options
    );
  }

  /** Returns all colliders overlapping the given AABB (reuses `scratch`). */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Collider[] {
    const out = this.scratch;
    out.length = 0;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (
        c.maxX <= minX ||
        c.minX >= maxX ||
        c.maxY <= minY ||
        c.minY >= maxY ||
        c.maxZ <= minZ ||
        c.minZ >= maxZ
      ) {
        continue;
      }
      out.push(c);
    }
    return out;
  }

  /**
   * Highest solid surface below `y` at the given XZ position.
   * Returns `-Infinity` when nothing is below.
   */
  groundHeightAt(x: number, z: number, y: number): number {
    let best = -Infinity;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (x < c.minX - 0.02 || x > c.maxX + 0.02) continue;
      if (z < c.minZ - 0.02 || z > c.maxZ + 0.02) continue;
      if (c.maxY <= y + 0.02 && c.maxY > best) best = c.maxY;
    }
    return best;
  }

  /** True when the given box overlaps anything solid. */
  isBlocked(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number
  ): boolean {
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (
        c.maxX <= minX ||
        c.minX >= maxX ||
        c.maxY <= minY ||
        c.minY >= maxY ||
        c.maxZ <= minZ ||
        c.minZ >= maxZ
      ) {
        continue;
      }
      return true;
    }
    return false;
  }

  /** True when the vertical space above `y` at (x,z) is free (used for mantles). */
  hasHeadroom(x: number, z: number, y: number, height: number, radius: number): boolean {
    return !this.isBlocked(
      x - radius,
      y + 0.05,
      z - radius,
      x + radius,
      y + height,
      z + radius
    );
  }
}

/** Helper used by the level builder to translate a collider into a mesh box. */
export function colliderCenterY(c: Collider): number {
  return (c.minY + c.maxY) * 0.5;
}

export function colliderSize(c: Collider, out: THREE.Vector3): THREE.Vector3 {
  return out.set(c.maxX - c.minX, c.maxY - c.minY, c.maxZ - c.minZ);
}
