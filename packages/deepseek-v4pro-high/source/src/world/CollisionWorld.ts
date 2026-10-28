import * as THREE from 'three';

export interface AABB {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

const EPS = 0.001;

type Axis = 'x' | 'y' | 'z';
const AXIS_IDX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

/**
 * Axis-aligned box collision world. All gameplay geometry is represented as a
 * list of AABBs. Movement resolution is done per-axis (move & slide), which is
 * robust for a first-person character as long as the fixed timestep is small
 * relative to the player speed and the thinnest collider.
 */
export class CollisionWorld {
  readonly colliders: AABB[] = [];

  clear(): void {
    this.colliders.length = 0;
  }

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
    this.colliders.push({
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ),
    });
  }

  addBoxFromCenter(center: THREE.Vector3, size: THREE.Vector3): void {
    const half = size.clone().multiplyScalar(0.5);
    this.colliders.push({
      min: center.clone().sub(half),
      max: center.clone().add(half),
    });
  }

  /**
   * Move an AABB (given by center + half extents) by `delta` along `axis`.
   * Returns the actual delta that can be applied without intersecting any
   * collider (clamped to zero if blocked).
   */
  resolveAxis(center: THREE.Vector3, half: THREE.Vector3, axis: Axis, delta: number): number {
    if (delta === 0) return 0;

    const ai = AXIS_IDX[axis];
    const o1 = ai === 0 ? 1 : 0;
    const o2 = ai === 2 ? 1 : 2;

    let result = delta;
    const pMin = center.getComponent(ai) - half.getComponent(ai);
    const pMax = center.getComponent(ai) + half.getComponent(ai);

    for (const c of this.colliders) {
      // Reject colliders that do not overlap the box on the other two axes.
      if (
        center.getComponent(o1) - half.getComponent(o1) >= c.max.getComponent(o1) - EPS ||
        center.getComponent(o1) + half.getComponent(o1) <= c.min.getComponent(o1) + EPS ||
        center.getComponent(o2) - half.getComponent(o2) >= c.max.getComponent(o2) - EPS ||
        center.getComponent(o2) + half.getComponent(o2) <= c.min.getComponent(o2) + EPS
      ) {
        continue;
      }

      const cMin = c.min.getComponent(ai);
      const cMax = c.max.getComponent(ai);

      if (result > 0) {
        const newMax = pMax + result;
        if (newMax > cMin && pMax <= cMin + EPS) {
          result = Math.min(result, cMin - pMax);
        }
      } else if (result < 0) {
        const newMin = pMin + result;
        if (newMin < cMax && pMin >= cMax - EPS) {
          result = Math.max(result, cMax - pMin);
        }
      }
    }

    return result;
  }

  /**
   * Cast a ray against the world. Returns the closest hit (entry point + an
   * axis-aligned surface normal) within `maxDist`, or null.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
    let bestT = maxDist;
    let bestNormal = new THREE.Vector3();
    const point = new THREE.Vector3();
    let found = false;

    for (const c of this.colliders) {
      let tEnter = -Infinity;
      let tExit = Infinity;
      let enterNormal = new THREE.Vector3();

      // X slab
      if (Math.abs(dir.x) < 1e-9) {
        if (origin.x < c.min.x || origin.x > c.max.x) continue;
      } else {
        let t1 = (c.min.x - origin.x) / dir.x;
        let t2 = (c.max.x - origin.x) / dir.x;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tEnter) {
          tEnter = t1;
          enterNormal.set(-Math.sign(dir.x), 0, 0);
        }
        if (t2 < tExit) tExit = t2;
      }

      // Y slab
      if (Math.abs(dir.y) < 1e-9) {
        if (origin.y < c.min.y || origin.y > c.max.y) continue;
      } else {
        let t1 = (c.min.y - origin.y) / dir.y;
        let t2 = (c.max.y - origin.y) / dir.y;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tEnter) {
          tEnter = t1;
          enterNormal.set(0, -Math.sign(dir.y), 0);
        }
        if (t2 < tExit) tExit = t2;
      }

      // Z slab
      if (Math.abs(dir.z) < 1e-9) {
        if (origin.z < c.min.z || origin.z > c.max.z) continue;
      } else {
        let t1 = (c.min.z - origin.z) / dir.z;
        let t2 = (c.max.z - origin.z) / dir.z;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tEnter) {
          tEnter = t1;
          enterNormal.set(0, 0, -Math.sign(dir.z));
        }
        if (t2 < tExit) tExit = t2;
      }

      if (tEnter < 0) tEnter = 0;
      if (tEnter <= tExit && tEnter < bestT) {
        bestT = tEnter;
        bestNormal = enterNormal;
        found = true;
      }
    }

    if (!found) return null;
    point.copy(origin).addScaledVector(dir, bestT);
    return { point, normal: bestNormal, distance: bestT };
  }

  /**
   * Return the highest solid surface Y at a given (x, z) position, or -Infinity
   * if there is no collider covering that point.
   */
  heightAt(x: number, z: number): number {
    let top = -Infinity;
    for (const c of this.colliders) {
      if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) {
        if (c.max.y > top) top = c.max.y;
      }
    }
    return top;
  }
}
