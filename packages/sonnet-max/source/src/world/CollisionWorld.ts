/**
 * Axis-aligned box collision world with a uniform XZ spatial hash.
 *
 * Every solid in the level (roof slabs, building bodies, crates, ducts, wall-run panels ...) is one
 * `Collider`. Keeping everything axis-aligned keeps the player physics trivial to reason about:
 * wall normals are always +-X / +-Z, and tops are always flat.
 */

/** Collider behaviour flags. */
export const Flag = {
  None: 0,
  /** The vertical faces of this collider can be wall-run. */
  WallRun: 1,
  /** The collider is never offered as a vault / mantle target. */
  NoGrab: 2,
} as const;

export class Collider {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  flags: number;
  id: number;
  label: string;
  /** Scratch value used to de-duplicate query results without allocating a Set. */
  stamp = 0;

  constructor(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    flags: number = Flag.None,
    label = '',
  ) {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
    this.flags = flags;
    this.id = 0;
    this.label = label;
  }
}

export interface RayHit {
  collider: Collider | null;
  /** Distance along the ray to the entry point. */
  t: number;
  /** Distance along the ray to the exit point. */
  tExit: number;
  /** Surface normal at the entry point (axis aligned). */
  nx: number;
  ny: number;
  nz: number;
}

export function createRayHit(): RayHit {
  return { collider: null, t: 0, tExit: 0, nx: 0, ny: 0, nz: 0 };
}

const CELL = 8;
const KEY_OFFSET = 2048;

function cellKey(ix: number, iz: number): number {
  return (ix + KEY_OFFSET) * 8192 + (iz + KEY_OFFSET);
}

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private readonly cells = new Map<number, Collider[]>();
  private stampCounter = 0;

  add(collider: Collider): Collider {
    collider.id = this.colliders.length;
    this.colliders.push(collider);
    const ix0 = Math.floor(collider.minX / CELL);
    const ix1 = Math.floor(collider.maxX / CELL);
    const iz0 = Math.floor(collider.minZ / CELL);
    const iz1 = Math.floor(collider.maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = cellKey(ix, iz);
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

  addBox(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    flags: number = Flag.None,
    label = '',
  ): Collider {
    return this.add(new Collider(minX, minY, minZ, maxX, maxY, maxZ, flags, label));
  }

  /** Returns the first collider strictly overlapping the box, or null. */
  firstOverlap(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
  ): Collider | null {
    const ix0 = Math.floor(minX / CELL);
    const ix1 = Math.floor(maxX / CELL);
    const iz0 = Math.floor(minZ / CELL);
    const iz1 = Math.floor(maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this.cells.get(cellKey(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i]!;
          if (
            minX < c.maxX &&
            maxX > c.minX &&
            minY < c.maxY &&
            maxY > c.minY &&
            minZ < c.maxZ &&
            maxZ > c.minZ
          ) {
            return c;
          }
        }
      }
    }
    return null;
  }

  /** Appends every distinct collider strictly overlapping the box to `out`. */
  collectOverlaps(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    out: Collider[],
  ): number {
    const stamp = ++this.stampCounter;
    const start = out.length;
    const ix0 = Math.floor(minX / CELL);
    const ix1 = Math.floor(maxX / CELL);
    const iz0 = Math.floor(minZ / CELL);
    const iz1 = Math.floor(maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this.cells.get(cellKey(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i]!;
          if (c.stamp === stamp) continue;
          if (
            minX < c.maxX &&
            maxX > c.minX &&
            minY < c.maxY &&
            maxY > c.minY &&
            minZ < c.maxZ &&
            maxZ > c.minZ
          ) {
            c.stamp = stamp;
            out.push(c);
          }
        }
      }
    }
    return out.length - start;
  }

  /**
   * Casts a ray against every collider near the ray and returns the nearest entry.
   * Rays are expected to be short (a few metres) except for occasional sun-visibility checks.
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    hit: RayHit,
  ): boolean {
    hit.collider = null;
    const stamp = ++this.stampCounter;
    const ex = ox + dx * maxDist;
    const ez = oz + dz * maxDist;
    const ix0 = Math.floor(Math.min(ox, ex) / CELL);
    const ix1 = Math.floor(Math.max(ox, ex) / CELL);
    const iz0 = Math.floor(Math.min(oz, ez) / CELL);
    const iz1 = Math.floor(Math.max(oz, ez) / CELL);
    let bestT = maxDist;
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this.cells.get(cellKey(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i]!;
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          // Slab test.
          let tMin = 0;
          let tMax = bestT;
          let nx = 0;
          let ny = 0;
          let nz = 0;
          let ok = true;

          if (Math.abs(dx) < 1e-9) {
            if (ox <= c.minX || ox >= c.maxX) ok = false;
          } else {
            let t1 = (c.minX - ox) / dx;
            let t2 = (c.maxX - ox) / dx;
            let n = -1;
            if (t1 > t2) {
              const tmp = t1;
              t1 = t2;
              t2 = tmp;
              n = 1;
            }
            if (t1 > tMin) {
              tMin = t1;
              nx = n;
              ny = 0;
              nz = 0;
            }
            if (t2 < tMax) tMax = t2;
            if (tMin > tMax) ok = false;
          }
          if (ok) {
            if (Math.abs(dy) < 1e-9) {
              if (oy <= c.minY || oy >= c.maxY) ok = false;
            } else {
              let t1 = (c.minY - oy) / dy;
              let t2 = (c.maxY - oy) / dy;
              let n = -1;
              if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
                n = 1;
              }
              if (t1 > tMin) {
                tMin = t1;
                nx = 0;
                ny = n;
                nz = 0;
              }
              if (t2 < tMax) tMax = t2;
              if (tMin > tMax) ok = false;
            }
          }
          if (ok) {
            if (Math.abs(dz) < 1e-9) {
              if (oz <= c.minZ || oz >= c.maxZ) ok = false;
            } else {
              let t1 = (c.minZ - oz) / dz;
              let t2 = (c.maxZ - oz) / dz;
              let n = -1;
              if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
                n = 1;
              }
              if (t1 > tMin) {
                tMin = t1;
                nx = 0;
                ny = 0;
                nz = n;
              }
              if (t2 < tMax) tMax = t2;
              if (tMin > tMax) ok = false;
            }
          }
          if (ok && tMin <= bestT) {
            bestT = tMin;
            hit.collider = c;
            hit.t = tMin;
            hit.tExit = tMax;
            hit.nx = nx;
            hit.ny = ny;
            hit.nz = nz;
          }
        }
      }
    }
    return hit.collider !== null;
  }

  /** Highest surface under (x, z) within `maxDrop` below `fromY`; null when nothing is there. */
  surfaceBelow(x: number, z: number, halfWidth: number, fromY: number, maxDrop: number): number | null {
    const list: Collider[] = [];
    this.collectOverlaps(x - halfWidth, fromY - maxDrop, z - halfWidth, x + halfWidth, fromY, z + halfWidth, list);
    let best: number | null = null;
    for (const c of list) {
      if (c.maxY <= fromY + 1e-6 && (best === null || c.maxY > best)) best = c.maxY;
    }
    return best;
  }
}
