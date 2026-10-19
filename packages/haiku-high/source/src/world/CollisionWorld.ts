/** Tolerance used when testing boxes for overlap, so resting on a surface is not counted as penetrating. */
export const OVERLAP_EPS = 0.001;

/** Axis-aligned box used both as collision geometry and as a query volume. */
export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** A solid piece of world geometry. `red` marks traversal surfaces for Runner Vision styling. */
export interface SolidBox extends Aabb {
  id: number;
  red: boolean;
}

/**
 * Flat list of solid boxes. The whole playable level is made of boxes, so
 * collision is a simple AABB test. Background city geometry is NOT added here.
 */
export class CollisionWorld {
  readonly boxes: SolidBox[] = [];
  private nextId = 1;

  add(min: [number, number, number], max: [number, number, number], red = false): SolidBox {
    const box: SolidBox = {
      minX: min[0],
      minY: min[1],
      minZ: min[2],
      maxX: max[0],
      maxY: max[1],
      maxZ: max[2],
      id: this.nextId++,
      red,
    };
    this.boxes.push(box);
    return box;
  }

  /** Returns every solid that strictly overlaps the query volume. */
  overlapping(query: Aabb, out: SolidBox[] = []): SolidBox[] {
    out.length = 0;
    for (const box of this.boxes) {
      if (
        box.minX < query.maxX - OVERLAP_EPS &&
        box.maxX > query.minX + OVERLAP_EPS &&
        box.minY < query.maxY - OVERLAP_EPS &&
        box.maxY > query.minY + OVERLAP_EPS &&
        box.minZ < query.maxZ - OVERLAP_EPS &&
        box.maxZ > query.minZ + OVERLAP_EPS
      ) {
        out.push(box);
      }
    }
    return out;
  }

  /** True when the volume touches no solid geometry. */
  isFree(query: Aabb): boolean {
    return this.overlapping(query).length === 0;
  }

  /**
   * Finds the solid hit by a horizontal probe: a thin box from (x, y, z) extending
   * `reach` metres along the direction (dirX, dirZ), spanning the given height band.
   */
  probeHorizontal(
    x: number,
    yMin: number,
    yMax: number,
    z: number,
    dirX: number,
    dirZ: number,
    reach: number,
    halfWidth: number,
  ): SolidBox | null {
    const endX = x + dirX * reach;
    const endZ = z + dirZ * reach;
    const query: Aabb = {
      minX: Math.min(x, endX) - (dirZ !== 0 ? halfWidth : 0),
      maxX: Math.max(x, endX) + (dirZ !== 0 ? halfWidth : 0),
      minY: yMin,
      maxY: yMax,
      minZ: Math.min(z, endZ) - (dirX !== 0 ? halfWidth : 0),
      maxZ: Math.max(z, endZ) + (dirX !== 0 ? halfWidth : 0),
    };
    const hits = this.overlapping(query);
    return hits.length > 0 ? hits[0] : null;
  }
}
