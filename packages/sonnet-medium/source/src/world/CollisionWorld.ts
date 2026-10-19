/**
 * Axis-aligned box collision world.
 * Every solid in the level is an AABB. Boxes are bucketed into a coarse XZ grid so
 * queries only touch a handful of candidates even though the level is ~400 m long.
 */
export interface Box {
  id: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  /** Surfaces the player is allowed to wall-run on. */
  wallRun: boolean;
  tag: string;
  stamp: number;
}

export const EPS = 1e-4;
const CELL = 16;

function cellKey(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}

export class CollisionWorld {
  readonly boxes: Box[] = [];
  private grid = new Map<number, Box[]>();
  private nextId = 1;
  private stampCounter = 0;

  add(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    opts: { wallRun?: boolean; tag?: string } = {},
  ): Box {
    const box: Box = {
      id: this.nextId++, minX, minY, minZ, maxX, maxY, maxZ,
      wallRun: !!opts.wallRun, tag: opts.tag ?? '', stamp: 0,
    };
    this.boxes.push(box);
    const cx0 = Math.floor(minX / CELL), cx1 = Math.floor(maxX / CELL);
    const cz0 = Math.floor(minZ / CELL), cz1 = Math.floor(maxZ / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = cellKey(cx, cz);
        let list = this.grid.get(k);
        if (!list) { list = []; this.grid.set(k, list); }
        list.push(box);
      }
    }
    return box;
  }

  /** Calls fn for every box whose grid cells touch the region (may include false positives). */
  private forEachCandidate(
    minX: number, minZ: number, maxX: number, maxZ: number, fn: (b: Box) => boolean | void,
  ): void {
    const stamp = ++this.stampCounter;
    const cx0 = Math.floor(minX / CELL), cx1 = Math.floor(maxX / CELL);
    const cz0 = Math.floor(minZ / CELL), cz1 = Math.floor(maxZ / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.grid.get(cellKey(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (b.stamp === stamp) continue;
          b.stamp = stamp;
          if (fn(b) === true) return;
        }
      }
    }
  }

  /** First box strictly overlapping the given AABB, or null. */
  firstOverlap(
    minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
  ): Box | null {
    let found: Box | null = null;
    this.forEachCandidate(minX, minZ, maxX, maxZ, (b) => {
      if (
        minX < b.maxX - EPS && maxX > b.minX + EPS &&
        minY < b.maxY - EPS && maxY > b.minY + EPS &&
        minZ < b.maxZ - EPS && maxZ > b.minZ + EPS
      ) { found = b; return true; }
      return false;
    });
    return found;
  }

  overlaps(
    minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
  ): boolean {
    return this.firstOverlap(minX, minY, minZ, maxX, maxY, maxZ) !== null;
  }

  /** All boxes whose AABB intersects (non-strict) the region. */
  query(
    minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
    out: Box[] = [],
  ): Box[] {
    out.length = 0;
    this.forEachCandidate(minX, minZ, maxX, maxZ, (b) => {
      if (
        minX <= b.maxX && maxX >= b.minX && minY <= b.maxY && maxY >= b.minY &&
        minZ <= b.maxZ && maxZ >= b.minZ
      ) out.push(b);
    });
    return out;
  }

  /** Highest box containing the XZ point whose top face lies in [yMin, yMax] and whose bottom is below maxBottom. */
  topAt(x: number, z: number, yMin: number, yMax: number, maxBottom = Infinity): Box | null {
    let best: Box | null = null;
    this.forEachCandidate(x, z, x, z, (b) => {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ &&
          b.maxY >= yMin && b.maxY <= yMax && b.minY < maxBottom) {
        if (!best || b.maxY > best.maxY) best = b;
      }
    });
    return best;
  }
}
