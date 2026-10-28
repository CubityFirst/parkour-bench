/**
 * Axis aligned collision world.
 *
 * The whole playable level is made of boxes, so a simple uniform grid is
 * enough to keep queries cheap. All boxes are registered in the cells their
 * footprint touches; a query only has to look at the few cells around the
 * player.
 */

export interface Collider {
  id: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Free form marker: 'roof', 'wall', 'crate', 'beam', ... */
  tag: string;
  /** Marks surfaces the player may wall run on. */
  wallRunnable: boolean;
  /** Internal: query de-duplication stamp. */
  stamp: number;
}

export interface RayHit {
  hit: boolean;
  distance: number;
  pointX: number;
  pointY: number;
  pointZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  collider: Collider | null;
}

const CELL_SIZE = 8;

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private readonly grid = new Map<number, number[]>();
  private nextId = 1;
  private stamp = 0;

  /** Registers a box. Returns the created collider. */
  add(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    tag = 'solid',
    wallRunnable = false,
  ): Collider {
    const collider: Collider = {
      id: this.nextId++,
      minX: Math.min(minX, maxX),
      minY: Math.min(minY, maxY),
      minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
      maxZ: Math.max(minZ, maxZ),
      tag,
      wallRunnable,
      stamp: 0,
    };
    this.colliders.push(collider);

    const c0x = Math.floor(collider.minX / CELL_SIZE);
    const c1x = Math.floor(collider.maxX / CELL_SIZE);
    const c0z = Math.floor(collider.minZ / CELL_SIZE);
    const c1z = Math.floor(collider.maxZ / CELL_SIZE);
    for (let x = c0x; x <= c1x; x++) {
      for (let z = c0z; z <= c1z; z++) {
        const key = this.key(x, z);
        let bucket = this.grid.get(key);
        if (!bucket) {
          bucket = [];
          this.grid.set(key, bucket);
        }
        bucket.push(collider.id);
      }
    }
    return collider;
  }

  private key(x: number, z: number): number {
    // Pack two signed cell coordinates into a single number.
    return (x + 32768) * 65536 + (z + 32768);
  }

  /** Returns every collider that overlaps the given axis aligned box. */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Collider[] {
    this.stamp++;
    const result: Collider[] = [];
    const c0x = Math.floor(minX / CELL_SIZE);
    const c1x = Math.floor(maxX / CELL_SIZE);
    const c0z = Math.floor(minZ / CELL_SIZE);
    const c1z = Math.floor(maxZ / CELL_SIZE);
    for (let x = c0x; x <= c1x; x++) {
      for (let z = c0z; z <= c1z; z++) {
        const bucket = this.grid.get(this.key(x, z));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const collider = this.colliders[bucket[i] - 1];
          if (collider.stamp === this.stamp) continue;
          collider.stamp = this.stamp;
          if (
            collider.maxX <= minX ||
            collider.minX >= maxX ||
            collider.maxY <= minY ||
            collider.minY >= maxY ||
            collider.maxZ <= minZ ||
            collider.minZ >= maxZ
          ) {
            continue;
          }
          result.push(collider);
        }
      }
    }
    return result;
  }

  /** Casts a ray against the world and returns the closest hit. */
  raycast(
    originX: number,
    originY: number,
    originZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    maxDistance: number,
  ): RayHit {
    const hit: RayHit = {
      hit: false,
      distance: maxDistance,
      pointX: 0,
      pointY: 0,
      pointZ: 0,
      normalX: 0,
      normalY: 0,
      normalZ: 0,
      collider: null,
    };

    // Walk the grid along the dominant axis of the ray.
    const steps = Math.ceil(maxDistance / (CELL_SIZE * 0.5));
    const seen = new Set<number>();
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * maxDistance;
      const px = originX + dirX * t;
      const pz = originZ + dirZ * t;
      const bucket = this.grid.get(
        this.key(Math.floor(px / CELL_SIZE), Math.floor(pz / CELL_SIZE)),
      );
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const id = bucket[i];
        if (seen.has(id)) continue;
        seen.add(id);
        const collider = this.colliders[id - 1];
        const tHit = rayBox(
          collider,
          originX,
          originY,
          originZ,
          dirX,
          dirY,
          dirZ,
          maxDistance,
        );
        if (tHit === null) continue;
        if (tHit <= hit.distance) {
          hit.hit = true;
          hit.distance = tHit;
          hit.pointX = originX + dirX * tHit;
          hit.pointY = originY + dirY * tHit;
          hit.pointZ = originZ + dirZ * tHit;
          hit.collider = collider;
          const n = boxNormal(collider, hit.pointX, hit.pointY, hit.pointZ);
          hit.normalX = n[0];
          hit.normalY = n[1];
          hit.normalZ = n[2];
        }
      }
      if (hit.hit && hit.distance < t) break;
    }
    return hit;
  }

  /** Convenience helper: lowest solid surface under a point. */
  groundBelow(x: number, y: number, z: number, maxDistance = 3): number {
    const hit = this.raycast(x, y, z, 0, -1, 0, maxDistance);
    return hit.hit ? hit.pointY : Number.NEGATIVE_INFINITY;
  }
}

function rayBox(
  box: Collider,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
): number | null {
  let tmin = 0;
  let tmax = maxDistance;
  const origin = [ox, oy, oz];
  const dir = [dx, dy, dz];
  const min = [box.minX, box.minY, box.minZ];
  const max = [box.maxX, box.maxY, box.maxZ];
  for (let axis = 0; axis < 3; axis++) {
    const d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (min[axis] - origin[axis]) * inv;
    let t2 = (max[axis] - origin[axis]) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

function boxNormal(box: Collider, px: number, py: number, pz: number): [number, number, number] {
  const eps = 0.02;
  if (Math.abs(px - box.minX) < eps) return [1, 0, 0];
  if (Math.abs(px - box.maxX) < eps) return [-1, 0, 0];
  if (Math.abs(py - box.minY) < eps) return [0, 1, 0];
  if (Math.abs(py - box.maxY) < eps) return [0, -1, 0];
  if (Math.abs(pz - box.minZ) < eps) return [0, 0, 1];
  if (Math.abs(pz - box.maxZ) < eps) return [0, 0, -1];
  return [0, 1, 0];
}