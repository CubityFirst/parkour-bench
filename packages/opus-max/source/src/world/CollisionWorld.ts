/**
 * Static collision geometry for the whole level.
 *
 * Every solid is an axis-aligned box. That keeps the player physics simple and very
 * robust (no tunnelling through thin triangles, exact ledge heights for mantling), and
 * the rooftop architecture is naturally boxy anyway. Boxes are bucketed into a uniform
 * XZ grid so per-step queries only touch a handful of candidates.
 */

/** Per-collider behaviour flags. */
export const ColliderFlags = {
  NONE: 0,
  /** Cannot be wall-run on (props, railings, ducts). */
  NO_WALLRUN: 1 << 0,
  /** Cannot be grabbed/mantled (machinery, ducts, railings). */
  NO_GRAB: 1 << 1,
  /** The player never auto-steps onto it. */
  NO_STEP: 1 << 2,
  /** Metal surface (footstep sound). */
  METAL: 1 << 3,
} as const;

/** Combination used for small rooftop props. */
export const PROP_FLAGS = ColliderFlags.NO_WALLRUN | ColliderFlags.NO_GRAB;

export interface Collider {
  readonly id: number;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly flags: number;
  /** Internal: de-duplicates colliders that span several grid cells during a query. */
  stamp: number;
}

export interface RayHit {
  /** Distance along the (normalised) ray. */
  t: number;
  x: number;
  y: number;
  z: number;
  /** Outward normal of the face that was hit. */
  nx: number;
  ny: number;
  nz: number;
  collider: Collider;
}

const EMPTY: number[] = [];

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private readonly cellSize: number;
  private readonly cells = new Map<number, number[]>();
  private stampCounter = 0;
  private readonly rayList: Collider[] = [];
  private readonly pointList: Collider[] = [];

  constructor(cellSize = 8) {
    this.cellSize = cellSize;
  }

  add(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, flags = 0): Collider {
    const collider: Collider = { id: this.colliders.length, minX, minY, minZ, maxX, maxY, maxZ, flags, stamp: 0 };
    this.colliders.push(collider);
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs);
    const z1 = Math.floor(maxZ / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = this.key(cx, cz);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(collider.id);
      }
    }
    return collider;
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /** Fills `out` with every collider whose box overlaps the query box. */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: Collider[]): Collider[] {
    out.length = 0;
    const stamp = ++this.stampCounter;
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs);
    const z1 = Math.floor(maxZ / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const bucket = this.cells.get(this.key(cx, cz)) ?? EMPTY;
        for (let i = 0; i < bucket.length; i++) {
          const c = this.colliders[bucket[i]];
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (c.maxX < minX || c.minX > maxX || c.maxY < minY || c.minY > maxY || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Casts a ray and returns the nearest face hit within `maxDist`.
   * Rays that start inside a box ignore that box. Direction must be normalised.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, ignoreFlags = 0): RayHit | null {
    const ex = ox + dx * maxDist;
    const ey = oy + dy * maxDist;
    const ez = oz + dz * maxDist;
    const list = this.query(
      Math.min(ox, ex), Math.min(oy, ey), Math.min(oz, ez),
      Math.max(ox, ex), Math.max(oy, ey), Math.max(oz, ez),
      this.rayList,
    );
    let best: RayHit | null = null;
    let bestT = maxDist;
    for (const c of list) {
      if (c.flags & ignoreFlags) continue;
      let tEnter = -Infinity;
      let tExit = Infinity;
      let axis = -1;
      let sign = 0;
      // X slab
      if (Math.abs(dx) < 1e-9) {
        if (ox < c.minX || ox > c.maxX) continue;
      } else {
        const inv = 1 / dx;
        let t1 = (c.minX - ox) * inv;
        let t2 = (c.maxX - ox) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tEnter) { tEnter = t1; axis = 0; sign = dx > 0 ? -1 : 1; }
        if (t2 < tExit) tExit = t2;
      }
      // Y slab
      if (Math.abs(dy) < 1e-9) {
        if (oy < c.minY || oy > c.maxY) continue;
      } else {
        const inv = 1 / dy;
        let t1 = (c.minY - oy) * inv;
        let t2 = (c.maxY - oy) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tEnter) { tEnter = t1; axis = 1; sign = dy > 0 ? -1 : 1; }
        if (t2 < tExit) tExit = t2;
      }
      // Z slab
      if (Math.abs(dz) < 1e-9) {
        if (oz < c.minZ || oz > c.maxZ) continue;
      } else {
        const inv = 1 / dz;
        let t1 = (c.minZ - oz) * inv;
        let t2 = (c.maxZ - oz) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tEnter) { tEnter = t1; axis = 2; sign = dz > 0 ? -1 : 1; }
        if (t2 < tExit) tExit = t2;
      }
      if (tExit < tEnter || tEnter < 0 || tEnter > bestT || axis < 0) continue;
      bestT = tEnter;
      best = {
        t: tEnter,
        x: ox + dx * tEnter,
        y: oy + dy * tEnter,
        z: oz + dz * tEnter,
        nx: axis === 0 ? sign : 0,
        ny: axis === 1 ? sign : 0,
        nz: axis === 2 ? sign : 0,
        collider: c,
      };
    }
    return best;
  }

  /**
   * Highest top surface among boxes that contain the point (x, z) in plan view and whose
   * top lies within [yMin, yMax]. Returns -Infinity when there is none.
   */
  columnTop(x: number, z: number, yMin: number, yMax: number, ignoreFlags = 0): number {
    const list = this.query(x, yMin, z, x, yMax, z, this.pointList);
    let top = -Infinity;
    for (const c of list) {
      if (c.flags & ignoreFlags) continue;
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.maxY >= yMin && c.maxY <= yMax && c.maxY > top) top = c.maxY;
    }
    return top;
  }

  /** The collider that provides `columnTop` at a point (or null). */
  columnTopCollider(x: number, z: number, yMin: number, yMax: number): Collider | null {
    const list = this.query(x, yMin, z, x, yMax, z, this.pointList);
    let best: Collider | null = null;
    for (const c of list) {
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.maxY >= yMin && c.maxY <= yMax && (!best || c.maxY > best.maxY)) best = c;
    }
    return best;
  }

  /** True when no box occupies the vertical segment [y0, y1] above the point (x, z). */
  isColumnFree(x: number, z: number, y0: number, y1: number): boolean {
    const list = this.query(x, y0, z, x, y1, z, this.pointList);
    for (const c of list) {
      if (x <= c.minX || x >= c.maxX || z <= c.minZ || z >= c.maxZ) continue;
      if (c.maxY > y0 && c.minY < y1) return false;
    }
    return true;
  }

  /**
   * Highest top surface within [yMin, yMax] among boxes overlapping a circle in plan view.
   * Used for ground snapping and landing checks.
   */
  supportTop(x: number, z: number, radius: number, yMax: number, yMin: number): number {
    const list = this.query(x - radius, yMin, z - radius, x + radius, yMax, z + radius, this.pointList);
    let top = -Infinity;
    for (const c of list) {
      if (c.maxY < yMin || c.maxY > yMax) continue;
      if (!circleOverlapsRect(x, z, radius, c)) continue;
      if (c.maxY > top) top = c.maxY;
    }
    return top;
  }
}

/** Plan-view circle vs box footprint overlap test. */
export function circleOverlapsRect(x: number, z: number, r: number, c: Collider): boolean {
  const cx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
  const cz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}
