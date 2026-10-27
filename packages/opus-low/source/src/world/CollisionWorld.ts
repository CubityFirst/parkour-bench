import * as THREE from 'three';

/** Axis-aligned solid box. All world collision is built from these. */
export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Surfaces the player may wall-run along. */
  runnable: boolean;
}

const EPS = 1e-4;

export class CollisionWorld {
  boxes: Box[] = [];

  add(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, runnable = false): Box {
    const box: Box = {
      min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
      max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
      runnable,
    };
    this.boxes.push(box);
    return box;
  }

  /** Returns every box strictly overlapping the given AABB (touching faces do not count). */
  query(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: Box[] = []): Box[] {
    out.length = 0;
    for (const b of this.boxes) {
      if (x0 < b.max.x - EPS && x1 > b.min.x + EPS &&
          y0 < b.max.y - EPS && y1 > b.min.y + EPS &&
          z0 < b.max.z - EPS && z1 > b.min.z + EPS) out.push(b);
    }
    return out;
  }

  /** Query using a player-shaped box: feet at y, radius r, height h. */
  queryPlayer(x: number, y: number, z: number, r: number, h: number, out: Box[] = []): Box[] {
    return this.query(x - r, y, z - r, x + r, y + h, z + r, out);
  }

  isFree(x: number, y: number, z: number, r: number, h: number): boolean {
    return this.queryPlayer(x, y, z, r, h, scratch).length === 0;
  }

  /** True when there is a surface within `depth` below the point. */
  hasSupport(x: number, y: number, z: number, r: number, depth = 0.1): boolean {
    return this.query(x - r, y - depth, z - r, x + r, y + 0.001, z + r, scratch).length > 0;
  }
}

const scratch: Box[] = [];
