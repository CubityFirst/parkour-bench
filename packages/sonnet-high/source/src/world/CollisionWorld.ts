/**
 * Axis-aligned box collision world.
 *
 * Every solid in the level (roofs, walls, obstacles, rails...) is an AABB, which keeps
 * collision response trivially robust. Solids are bucketed into a coarse 2D (x/z) grid so a
 * query only touches the handful of boxes near the player.
 *
 * This module is intentionally free of any rendering / DOM dependency so the movement code
 * can be exercised headlessly (see tools/sim.ts).
 */

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface Solid extends AABB {
  id: number;
  /** Vertical faces of this solid may be wall-run on. */
  runnable: boolean;
  /** Query de-duplication stamp (a solid can live in several grid cells). */
  stamp: number;
}

export interface SweepHit {
  solid: Solid;
  /** Free distance travelled before the (radius-expanded) box is touched. */
  dist: number;
  /** Outward surface normal of the face that was hit (axis aligned, points towards the mover). */
  nx: number;
  nz: number;
}

/** Tolerance used for "touching is not overlapping". */
export const EPS = 1e-4;

const CELL = 8;
const key = (cx: number, cz: number): number => (cx + 2048) * 4096 + (cz + 2048);

export function overlaps(a: AABB, b: AABB): boolean {
  return (
    a.maxX > b.minX + EPS &&
    a.minX < b.maxX - EPS &&
    a.maxY > b.minY + EPS &&
    a.minY < b.maxY - EPS &&
    a.maxZ > b.minZ + EPS &&
    a.minZ < b.maxZ - EPS
  );
}

export class CollisionWorld {
  readonly solids: Solid[] = [];
  private readonly cells = new Map<number, Solid[]>();
  private stampCounter = 0;
  private nextId = 1;

  add(box: AABB, runnable = false): Solid {
    const solid: Solid = {
      minX: box.minX,
      minY: box.minY,
      minZ: box.minZ,
      maxX: box.maxX,
      maxY: box.maxY,
      maxZ: box.maxZ,
      id: this.nextId++,
      runnable,
      stamp: 0,
    };
    this.solids.push(solid);
    const x0 = Math.floor(solid.minX / CELL);
    const x1 = Math.floor(solid.maxX / CELL);
    const z0 = Math.floor(solid.minZ / CELL);
    const z1 = Math.floor(solid.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(solid);
      }
    }
    return solid;
  }

  /** Collects every solid whose box overlaps `box` (touching does not count). */
  query(box: AABB, out: Solid[]): Solid[] {
    out.length = 0;
    const stamp = ++this.stampCounter;
    const x0 = Math.floor(box.minX / CELL);
    const x1 = Math.floor(box.maxX / CELL);
    const z0 = Math.floor(box.minZ / CELL);
    const z1 = Math.floor(box.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (s.stamp === stamp) continue;
          s.stamp = stamp;
          if (overlaps(box, s)) out.push(s);
        }
      }
    }
    return out;
  }

  private readonly scratch: Solid[] = [];

  /** True if `box` intersects any solid. */
  intersectsAny(box: AABB): boolean {
    return this.query(box, this.scratch).length > 0;
  }

  /**
   * Highest solid top surface beneath (x, z) that lies within [fromY - maxDrop, fromY + rise].
   * `halfExtent` is the half width of the footprint used for support. Returns null if none.
   */
  groundBelow(x: number, z: number, halfExtent: number, fromY: number, maxDrop: number, rise = 0.02): number | null {
    const probe: AABB = {
      minX: x - halfExtent,
      maxX: x + halfExtent,
      minZ: z - halfExtent,
      maxZ: z + halfExtent,
      minY: fromY - maxDrop,
      maxY: fromY + rise,
    };
    // Query with a slightly inflated box so tops that exactly touch are included.
    probe.minY -= 2 * EPS;
    const found = this.query(probe, this.scratch);
    let best: number | null = null;
    for (const s of found) {
      const top = s.maxY;
      if (top > fromY + rise + EPS) continue;
      if (top < fromY - maxDrop - EPS) continue;
      if (best === null || top > best) best = top;
    }
    return best;
  }

  /**
   * Sweeps a vertical slab [y0, y1] (the player's body, expanded horizontally by `radius`)
   * along a horizontal direction and returns the first solid hit within `maxDist`.
   * The direction does not need to be axis aligned; the reported normal always is.
   */
  sweepHorizontal(
    cx: number,
    cz: number,
    y0: number,
    y1: number,
    dx: number,
    dz: number,
    maxDist: number,
    radius: number,
    filter?: (s: Solid) => boolean,
  ): SweepHit | null {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    dx /= len;
    dz /= len;
    const ex = cx + dx * maxDist;
    const ez = cz + dz * maxDist;
    const region: AABB = {
      minX: Math.min(cx, ex) - radius - 0.01,
      maxX: Math.max(cx, ex) + radius + 0.01,
      minZ: Math.min(cz, ez) - radius - 0.01,
      maxZ: Math.max(cz, ez) + radius + 0.01,
      minY: y0,
      maxY: y1,
    };
    const near = this.query(region, this.scratch);
    let best: SweepHit | null = null;
    for (const s of near) {
      if (filter && !filter(s)) continue;
      const minX = s.minX - radius;
      const maxX = s.maxX + radius;
      const minZ = s.minZ - radius;
      const maxZ = s.maxZ + radius;

      let tx0: number;
      let tx1: number;
      if (Math.abs(dx) < 1e-9) {
        if (cx <= minX || cx >= maxX) continue;
        tx0 = -Infinity;
        tx1 = Infinity;
      } else {
        const a = (minX - cx) / dx;
        const b = (maxX - cx) / dx;
        tx0 = Math.min(a, b);
        tx1 = Math.max(a, b);
      }
      let tz0: number;
      let tz1: number;
      if (Math.abs(dz) < 1e-9) {
        if (cz <= minZ || cz >= maxZ) continue;
        tz0 = -Infinity;
        tz1 = Infinity;
      } else {
        const a = (minZ - cz) / dz;
        const b = (maxZ - cz) / dz;
        tz0 = Math.min(a, b);
        tz1 = Math.max(a, b);
      }
      const entry = Math.max(tx0, tz0);
      const exit = Math.min(tx1, tz1);
      if (exit < 0 || entry > exit || entry > maxDist) continue;

      let nx = 0;
      let nz = 0;
      if (tx0 > tz0) nx = dx > 0 ? -1 : 1;
      else nz = dz > 0 ? -1 : 1;
      const dist = Math.max(entry, 0);
      if (!best || dist < best.dist) best = { solid: s, dist, nx, nz };
    }
    return best;
  }
}
