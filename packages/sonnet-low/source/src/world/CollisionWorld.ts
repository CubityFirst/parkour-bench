export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  /** Vertical surface that can be wall-run. */
  runnable: boolean;
}

/** Static axis-aligned box world. Small enough that brute-force queries are cheap. */
export class CollisionWorld {
  boxes: Box[] = [];
  runnables: Box[] = [];

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, runnable = false): Box {
    const b: Box = { minX, minY, minZ, maxX, maxY, maxZ, runnable };
    this.boxes.push(b);
    if (runnable) this.runnables.push(b);
    return b;
  }

  addCentered(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, runnable = false): Box {
    return this.addBox(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, runnable);
  }

  overlaps(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    for (const b of this.boxes) {
      if (maxX > b.minX && minX < b.maxX && maxY > b.minY && minY < b.maxY && maxZ > b.minZ && minZ < b.maxZ) return true;
    }
    return false;
  }

  pointInside(x: number, y: number, z: number): Box | null {
    for (const b of this.boxes) {
      if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ) return b;
    }
    return null;
  }
}
