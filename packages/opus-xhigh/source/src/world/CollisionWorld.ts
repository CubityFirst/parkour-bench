/**
 * CollisionWorld — a static set of axis-aligned boxes with a uniform-grid
 * broadphase.
 *
 * Every piece of playable geometry in Rooftop Flow is built from axis-aligned
 * boxes, which keeps collision exact, cheap and easy to reason about. The
 * player is also an AABB, so movement is resolved one axis at a time with
 * swept tests ("how far can this box move along X before touching
 * anything?"). Swept tests clamp the movement to the first contact, so
 * nothing can tunnel through thin geometry no matter how fast the player is
 * moving.
 */

export type Axis = 0 | 1 | 2;

/** Optional gameplay meaning attached to a collider. */
export type ColliderTag = 'solid' | 'roof' | 'wallrun' | 'vault' | 'slide' | 'ledge' | 'background';

export interface Collider {
  readonly id: number;
  readonly min: [number, number, number];
  readonly max: [number, number, number];
  readonly tag: ColliderTag;
}

export interface SurfaceHit {
  /** Height of the walkable top surface that was found. */
  y: number;
  collider: Collider;
}

/** Contact tolerance used by all overlap tests (metres). */
export const COLLISION_EPSILON = 1e-4;

const CELL_SIZE = 16;
const GRID_OFFSET = 4096;

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private readonly cells = new Map<number, Collider[]>();
  private readonly stamps: number[] = [];
  private queryStamp = 1;
  private readonly queryResult: Collider[] = [];

  /** Adds a solid box and returns it. Boxes with zero/negative size are ignored. */
  add(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    tag: ColliderTag = 'solid',
  ): Collider | null {
    if (maxX - minX <= 1e-6 || maxY - minY <= 1e-6 || maxZ - minZ <= 1e-6) return null;
    const collider: Collider = {
      id: this.colliders.length,
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      tag,
    };
    this.colliders.push(collider);
    this.stamps.push(0);

    const cx0 = Math.floor(minX / CELL_SIZE);
    const cx1 = Math.floor(maxX / CELL_SIZE);
    const cz0 = Math.floor(minZ / CELL_SIZE);
    const cz1 = Math.floor(maxZ / CELL_SIZE);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const key = cellKey(cx, cz);
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(collider);
      }
    }
    return collider;
  }

  clear(): void {
    this.colliders.length = 0;
    this.stamps.length = 0;
    this.cells.clear();
  }

  /**
   * Returns every collider whose grid cells intersect the XZ footprint of the
   * given box. The returned array is reused between calls — copy it if you
   * need to keep it.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number): readonly Collider[] {
    const out = this.queryResult;
    out.length = 0;
    const stamp = ++this.queryStamp;
    const cx0 = Math.floor(minX / CELL_SIZE);
    const cx1 = Math.floor(maxX / CELL_SIZE);
    const cz0 = Math.floor(minZ / CELL_SIZE);
    const cz1 = Math.floor(maxZ / CELL_SIZE);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.cells.get(cellKey(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (this.stamps[c.id] === stamp) continue;
          this.stamps[c.id] = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Swept move of `box` along one axis. Returns the distance the box can
   * actually travel (same sign as `delta`, never longer). The box itself is
   * not modified. If `hit` is provided, the blocking collider is written to
   * `hit.collider`.
   */
  sweepAxis(min: number[], max: number[], axis: Axis, delta: number, hit?: { collider: Collider | null }): number {
    if (hit) hit.collider = null;
    if (delta === 0) return 0;

    // Broadphase over the swept volume.
    let qMinX = min[0];
    let qMaxX = max[0];
    let qMinZ = min[2];
    let qMaxZ = max[2];
    if (axis === 0) {
      if (delta > 0) qMaxX += delta;
      else qMinX += delta;
    } else if (axis === 2) {
      if (delta > 0) qMaxZ += delta;
      else qMinZ += delta;
    }
    const candidates = this.query(qMinX, qMinZ, qMaxX, qMaxZ);

    const a1 = axis === 0 ? 1 : 0;
    const a2 = axis === 2 ? 1 : 2;
    let allowed = delta;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      // Must overlap on the two other axes to be able to block us.
      if (c.max[a1] <= min[a1] + COLLISION_EPSILON || c.min[a1] >= max[a1] - COLLISION_EPSILON) continue;
      if (c.max[a2] <= min[a2] + COLLISION_EPSILON || c.min[a2] >= max[a2] - COLLISION_EPSILON) continue;
      if (delta > 0) {
        // Only boxes fully ahead of us count; boxes we already overlap are
        // ignored so an embedded player can always move out.
        if (c.min[axis] >= max[axis] - COLLISION_EPSILON) {
          const d = c.min[axis] - max[axis];
          if (d < allowed) {
            allowed = d;
            if (hit) hit.collider = c;
          }
        }
      } else if (c.max[axis] <= min[axis] + COLLISION_EPSILON) {
        const d = c.max[axis] - min[axis];
        if (d > allowed) {
          allowed = d;
          if (hit) hit.collider = c;
        }
      }
    }
    // Contact epsilon can produce tiny wrong-way values; never move backwards.
    if (delta > 0 && allowed < 0) allowed = 0;
    if (delta < 0 && allowed > 0) allowed = 0;
    return allowed;
  }

  /** True if the given box overlaps any collider (touching does not count). */
  overlaps(min: number[], max: number[]): Collider | null {
    const candidates = this.query(min[0], min[2], max[0], max[2]);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (
        c.max[0] > min[0] + COLLISION_EPSILON &&
        c.min[0] < max[0] - COLLISION_EPSILON &&
        c.max[1] > min[1] + COLLISION_EPSILON &&
        c.min[1] < max[1] - COLLISION_EPSILON &&
        c.max[2] > min[2] + COLLISION_EPSILON &&
        c.min[2] < max[2] - COLLISION_EPSILON
      ) {
        return c;
      }
    }
    return null;
  }

  /** Returns the collider containing the point, if any. */
  pointInside(x: number, y: number, z: number): Collider | null {
    const candidates = this.query(x, z, x, z);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (x > c.min[0] && x < c.max[0] && y > c.min[1] && y < c.max[1] && z > c.min[2] && z < c.max[2]) return c;
    }
    return null;
  }

  /**
   * Looks straight down from (x, fromY, z) and returns the highest top surface
   * within `maxDrop`. Returns `null` when nothing is found, or when the start
   * point itself is inside solid geometry (then `blocked` is set on `out`).
   */
  surfaceBelow(x: number, z: number, fromY: number, maxDrop: number, out?: { blocked: boolean }): SurfaceHit | null {
    if (out) out.blocked = false;
    const candidates = this.query(x, z, x, z);
    let best: SurfaceHit | null = null;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (x <= c.min[0] || x >= c.max[0] || z <= c.min[2] || z >= c.max[2]) continue;
      if (c.min[1] < fromY && c.max[1] > fromY) {
        if (out) out.blocked = true;
        return null;
      }
      const top = c.max[1];
      if (top <= fromY && top >= fromY - maxDrop && (!best || top > best.y)) {
        best = { y: top, collider: c };
      }
    }
    return best;
  }
}

function cellKey(cx: number, cz: number): number {
  return (cx + GRID_OFFSET) * 8192 + (cz + GRID_OFFSET);
}
