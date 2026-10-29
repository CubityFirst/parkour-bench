/**
 * Minimal axis-aligned collision world.
 *
 * Every solid piece of the level is an AABB. Broadphase is a uniform grid on
 * the XZ plane which keeps per-step queries cheap even with a few thousand
 * boxes (the background city is not collidable at all).
 */

export type ColliderTag = 'solid' | 'wallrun' | 'decor';

export interface Collider {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  tag: ColliderTag;
}

const CELL = 16;

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private readonly grid = new Map<number, Collider[]>();
  private readonly stamp = new WeakMap<Collider, number>();
  private queryId = 0;

  add(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    tag: ColliderTag = 'solid'
  ): Collider {
    const c: Collider = { minX, minY, minZ, maxX, maxY, maxZ, tag };
    this.colliders.push(c);

    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const key = x * 73856093 + z * 19349663;
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(c);
      }
    }
    return c;
  }

  /** Collects colliders overlapping the given AABB into `out` (reused array). */
  query(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    out: Collider[] = []
  ): Collider[] {
    out.length = 0;
    const id = ++this.queryId;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);

    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.grid.get(x * 73856093 + z * 19349663);
        if (!list) continue;
        for (const c of list) {
          if (this.stamp.get(c) === id) continue;
          this.stamp.set(c, id);
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
      }
    }
    return out;
  }

  /** True when the given AABB overlaps any collider. */
  overlaps(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const hits = this.query(minX, minY, minZ, maxX, maxY, maxZ, this.scratch);
    return hits.length > 0;
  }

  private readonly scratch: Collider[] = [];
}
