/** Minimal axis-aligned bounds, shared by solids and the player body. */
export interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** A static, collidable box. Units are metres. */
export interface Solid extends Bounds {
  readonly id: number;
  /**
   * Tall, thin face that can be wall-run along. Wall-run walls must be longer along Z
   * than along X, so their normal points along X.
   */
  readonly wallRun: boolean;
}

/** Overlap tolerance so boxes that merely touch do not count as overlapping. */
export const EPS = 1e-4;

export function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    a.minX < b.maxX - EPS &&
    a.maxX > b.minX + EPS &&
    a.minY < b.maxY - EPS &&
    a.maxY > b.minY + EPS &&
    a.minZ < b.maxZ - EPS &&
    a.maxZ > b.minZ + EPS
  );
}

/**
 * Holds every solid in the level. Collision is a brute-force scan: a rooftop level has
 * a few dozen boxes, so this stays cheap at the fixed physics rate.
 */
export class CollisionWorld {
  readonly solids: Solid[] = [];
  private nextId = 0;

  add(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }, wallRun = false): Solid {
    const solid: Solid = {
      id: this.nextId++,
      minX: min.x,
      minY: min.y,
      minZ: min.z,
      maxX: max.x,
      maxY: max.y,
      maxZ: max.z,
      wallRun,
    };
    this.solids.push(solid);
    return solid;
  }

  /** True when a body with feet at (x, y, z) and the given height fits without touching solids. */
  isFree(x: number, y: number, z: number, halfWidth: number, height: number): boolean {
    const probe: Bounds = {
      minX: x - halfWidth,
      maxX: x + halfWidth,
      minY: y,
      maxY: y + height,
      minZ: z - halfWidth,
      maxZ: z + halfWidth,
    };
    for (const solid of this.solids) {
      if (overlaps(probe, solid)) return false;
    }
    return true;
  }
}
