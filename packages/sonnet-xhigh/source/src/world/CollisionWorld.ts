/**
 * CollisionWorld - axis-aligned box world with a uniform XZ grid broadphase.
 *
 * Every solid thing in the level (rooftops, walls, vents, railings...) is an AABB.
 * That keeps player collision simple and robust: the player is also an AABB and
 * is resolved one axis at a time (see PlayerPhysics).
 *
 * This module is intentionally free of any Three.js / DOM dependency so the
 * movement code can also be run headless (see scripts/verify-level.ts).
 */

export interface BoxFlags {
  /** Vertical surface the player is allowed to wall-run on. */
  wallRun?: boolean;
  /** Obstacle that must never be vaulted (e.g. thin railing that leads to a drop). */
  noVault?: boolean;
  /** Free-form label for debugging. */
  label?: string;
}

export interface Box {
  readonly id: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  flags: BoxFlags;
  /** Query de-duplication stamp (internal). */
  stamp: number;
}

export interface RayHit {
  box: Box | null;
  /** Distance along the ray. */
  t: number;
  /** Surface normal of the face that was hit (axis aligned). */
  nx: number;
  ny: number;
  nz: number;
}

const CELL = 8;

function cellIndex(v: number): number {
  return Math.floor(v / CELL);
}

function cellKey(ix: number, iz: number): number {
  // Levels are small; this packs two signed 16 bit cell coordinates into one number.
  return (ix + 32768) * 65536 + (iz + 32768);
}

export class CollisionWorld {
  readonly boxes: Box[] = [];
  private grid = new Map<number, Box[]>();
  private stampCounter = 0;
  private nextId = 1;

  add(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    flags: BoxFlags = {},
  ): Box {
    const box: Box = {
      id: this.nextId++,
      minX, minY, minZ, maxX, maxY, maxZ,
      flags,
      stamp: 0,
    };
    this.boxes.push(box);
    const x0 = cellIndex(minX), x1 = cellIndex(maxX);
    const z0 = cellIndex(minZ), z1 = cellIndex(maxZ);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = cellKey(ix, iz);
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(box);
      }
    }
    return box;
  }

  /** Collects every box whose AABB strictly overlaps the given region. */
  query(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    out: Box[],
  ): Box[] {
    out.length = 0;
    const stamp = ++this.stampCounter;
    const x0 = cellIndex(minX), x1 = cellIndex(maxX);
    const z0 = cellIndex(minZ), z1 = cellIndex(maxZ);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.grid.get(cellKey(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (b.stamp === stamp) continue;
          b.stamp = stamp;
          if (
            minX < b.maxX && maxX > b.minX &&
            minY < b.maxY && maxY > b.minY &&
            minZ < b.maxZ && maxZ > b.minZ
          ) {
            out.push(b);
          }
        }
      }
    }
    return out;
  }

  private readonly scratch: Box[] = [];

  /** True if any box overlaps the region (optionally ignoring one box). */
  overlaps(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    ignore?: Box | null,
  ): boolean {
    const hits = this.query(minX, minY, minZ, maxX, maxY, maxZ, this.scratch);
    for (let i = 0; i < hits.length; i++) {
      if (hits[i] !== ignore) return true;
    }
    return false;
  }

  /**
   * Ray vs. box world (slab method). Direction does not need to be normalised
   * but `maxDist` is expressed in units of the direction vector length.
   */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
    out: RayHit,
    filter?: (b: Box) => boolean,
  ): boolean {
    const ex = ox + dx * maxDist, ey = oy + dy * maxDist, ez = oz + dz * maxDist;
    const hits = this.query(
      Math.min(ox, ex) - 0.001, Math.min(oy, ey) - 0.001, Math.min(oz, ez) - 0.001,
      Math.max(ox, ex) + 0.001, Math.max(oy, ey) + 0.001, Math.max(oz, ez) + 0.001,
      this.scratch,
    );
    out.box = null;
    out.t = maxDist;
    let found = false;
    for (let i = 0; i < hits.length; i++) {
      const b = hits[i];
      if (filter && !filter(b)) continue;
      let tmin = 0, tmax = maxDist;
      let nx = 0, ny = 0, nz = 0;
      let ok = true;

      // X slab
      if (Math.abs(dx) < 1e-9) {
        if (ox < b.minX || ox > b.maxX) ok = false;
      } else {
        let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
        let n = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; n = 1; }
        if (t1 > tmin) { tmin = t1; nx = n; ny = 0; nz = 0; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) ok = false;
      }
      // Y slab
      if (ok) {
        if (Math.abs(dy) < 1e-9) {
          if (oy < b.minY || oy > b.maxY) ok = false;
        } else {
          let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy;
          let n = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; n = 1; }
          if (t1 > tmin) { tmin = t1; nx = 0; ny = n; nz = 0; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) ok = false;
        }
      }
      // Z slab
      if (ok) {
        if (Math.abs(dz) < 1e-9) {
          if (oz < b.minZ || oz > b.maxZ) ok = false;
        } else {
          let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
          let n = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; n = 1; }
          if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = n; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) ok = false;
        }
      }
      if (ok && tmin < out.t) {
        out.t = tmin;
        out.box = b;
        out.nx = nx; out.ny = ny; out.nz = nz;
        found = true;
      }
    }
    return found;
  }
}

export function makeRayHit(): RayHit {
  return { box: null, t: 0, nx: 0, ny: 0, nz: 0 };
}
