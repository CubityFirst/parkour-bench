import * as THREE from 'three';

export interface SolidFlags {
  /** Surface can be used for wall running. */
  wallRun?: boolean;
  /** Human readable tag used for debugging. */
  tag?: string;
}

/** One axis-aligned box of solid world geometry. */
export class Solid {
  readonly box: THREE.Box3;
  readonly flags: SolidFlags;

  constructor(min: THREE.Vector3, max: THREE.Vector3, flags: SolidFlags = {}) {
    this.box = new THREE.Box3(min.clone(), max.clone());
    this.flags = flags;
  }
}

/**
 * The static collision world.
 *
 * The whole level is made of axis-aligned boxes, which makes collision cheap,
 * extremely stable and easy to reason about. Every solid knows its own bounds
 * so the game never has to raycast against triangles.
 */
export class CollisionWorld {
  readonly solids: Solid[] = [];
  private tmpBox = new THREE.Box3();

  add(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, flags: SolidFlags = {}): Solid {
    const solid = new Solid(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ), flags);
    this.solids.push(solid);
    return solid;
  }

  addBox(box: THREE.Box3, flags: SolidFlags = {}): Solid {
    const solid = new Solid(box.min, box.max, flags);
    this.solids.push(solid);
    return solid;
  }

  /** True when the given box overlaps any solid. */
  overlaps(box: THREE.Box3, ignore?: Solid): boolean {
    for (const solid of this.solids) {
      if (solid === ignore) continue;
      if (box.intersectsBox(solid.box)) return true;
    }
    return false;
  }

  /** Collect every solid overlapping the given box. */
  query(box: THREE.Box3, out: Solid[] = []): Solid[] {
    out.length = 0;
    for (const solid of this.solids) {
      if (box.intersectsBox(solid.box)) out.push(solid);
    }
    return out;
  }

  /** True when nothing blocks the box. */
  isFree(box: THREE.Box3, ignore?: Solid): boolean {
    return !this.overlaps(box, ignore);
  }

  /** Convenience: build a box for a player-sized body. */
  bodyBox(centerX: number, feetY: number, centerZ: number, radius: number, height: number, out = this.tmpBox): THREE.Box3 {
    out.min.set(centerX - radius, feetY, centerZ - radius);
    out.max.set(centerX + radius, feetY + height, centerZ + radius);
    return out;
  }

  clear(): void {
    this.solids.length = 0;
  }
}
