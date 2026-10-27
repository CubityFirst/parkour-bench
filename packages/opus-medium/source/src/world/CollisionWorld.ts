/**
 * Static axis-aligned box collision world with a uniform XZ grid for
 * broad-phase queries. All level geometry that the player can touch is
 * represented here as AABBs - simple, predictable and fast.
 */
export interface Collider {
  id: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  /** Optional semantic tag, e.g. 'wallrun', 'vault'. */
  tag?: string;
  /** Internal query de-duplication stamp. */
  stamp: number;
}

const CELL = 8;
const EPS = 1e-5;

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private grid = new Map<number, Collider[]>();
  private stamp = 0;
  private scratch: Collider[] = [];

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  add(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tag?: string): Collider {
    const c: Collider = { id: this.colliders.length, minX, minY, minZ, maxX, maxY, maxZ, tag, stamp: 0 };
    this.colliders.push(c);
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let list = this.grid.get(k);
        if (!list) { list = []; this.grid.set(k, list); }
        list.push(c);
      }
    }
    return c;
  }

  /** Returns every collider whose AABB overlaps the query box (strictly). Result array is reused. */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Collider[] {
    const out = this.scratch;
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c.stamp === s) continue;
          c.stamp = s;
          if (c.maxX > minX + EPS && c.minX < maxX - EPS &&
              c.maxY > minY + EPS && c.minY < maxY - EPS &&
              c.maxZ > minZ + EPS && c.minZ < maxZ - EPS) {
            out.push(c);
          }
        }
      }
    }
    return out;
  }

  /** True when the box does not overlap any collider. */
  isFree(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    return this.query(minX, minY, minZ, maxX, maxY, maxZ).length === 0;
  }

  /** Highest collider top under (x,z) whose top is <= maxTop. Returns -Infinity if none. */
  groundHeightAt(x: number, z: number, maxTop: number, radius = 0): number {
    const hits = this.query(x - radius, -1000, z - radius, x + radius, maxTop + 0.001, z + radius);
    let best = -Infinity;
    for (const c of hits) if (c.maxY <= maxTop + 0.001 && c.maxY > best) best = c.maxY;
    return best;
  }
}

/** Simple trigger volume. */
export interface TriggerBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export function pointInTrigger(t: TriggerBox, x: number, y: number, z: number): boolean {
  return x >= t.minX && x <= t.maxX && y >= t.minY && y <= t.maxY && z >= t.minZ && z <= t.maxZ;
}
