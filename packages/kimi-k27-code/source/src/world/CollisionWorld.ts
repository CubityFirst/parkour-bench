import * as THREE from 'three';

export interface CollisionBox {
  min: THREE.Vector3;
  max: THREE.Vector3;
  type: 'solid' | 'wallrun' | 'vault' | 'trigger';
  userData?: any;
}

export class CollisionWorld {
  boxes: CollisionBox[] = [];

  addBox(min: THREE.Vector3, max: THREE.Vector3, type: CollisionBox['type'] = 'solid', userData?: any) {
    this.boxes.push({ min: min.clone(), max: max.clone(), type, userData });
  }

  clear() {
    this.boxes.length = 0;
  }

  intersectsBox(min: THREE.Vector3, max: THREE.Vector3, filter?: (b: CollisionBox) => boolean): CollisionBox | null {
    for (const b of this.boxes) {
      if (filter && !filter(b)) continue;
      if (min.x < b.max.x && max.x > b.min.x &&
          min.y < b.max.y && max.y > b.min.y &&
          min.z < b.max.z && max.z > b.min.z) {
        return b;
      }
    }
    return null;
  }

  // Sweep an AABB along a ray, return first hit fraction and normal
  sweep(min: THREE.Vector3, max: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter?: (b: CollisionBox) => boolean): { fraction: number; normal: THREE.Vector3; box: CollisionBox | null } {
    let minFraction = 1;
    let hitNormal = new THREE.Vector3(0, -1, 0);
    let hitBox: CollisionBox | null = null;

    for (const b of this.boxes) {
      if (filter && !filter(b)) continue;
      // Skip if already intersecting in x/z but we care about y separation etc
      const invDir = new THREE.Vector3(
        dir.x === 0 ? Infinity : 1 / dir.x,
        dir.y === 0 ? Infinity : 1 / dir.y,
        dir.z === 0 ? Infinity : 1 / dir.z
      );

      let t1 = (b.min.x - max.x) * invDir.x;
      let t2 = (b.max.x - min.x) * invDir.x;
      let nx = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; nx = 1; }

      let t3 = (b.min.y - max.y) * invDir.y;
      let t4 = (b.max.y - min.y) * invDir.y;
      let ny = -1;
      if (t3 > t4) { const tmp = t3; t3 = t4; t4 = tmp; ny = 1; }

      let t5 = (b.min.z - max.z) * invDir.z;
      let t6 = (b.max.z - min.z) * invDir.z;
      let nz = -1;
      if (t5 > t6) { const tmp = t5; t5 = t6; t6 = tmp; nz = 1; }

      const tmin = Math.max(Math.max(t1, t3), t5);
      const tmax = Math.min(Math.min(t2, t4), t6);

      if (tmax < 0 || tmin > tmax) continue;
      if (tmin < 0) continue; // already inside
      const frac = tmin / maxDist;
      if (frac < minFraction) {
        minFraction = frac;
        hitBox = b;
        if (t1 === tmin) hitNormal.set(nx, 0, 0);
        else if (t3 === tmin) hitNormal.set(0, ny, 0);
        else hitNormal.set(0, 0, nz);
      }
    }
    return { fraction: Math.max(0, Math.min(1, minFraction)), normal: hitNormal, box: hitBox };
  }

  // Raycast against boxes, returns first hit point and box
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter?: (b: CollisionBox) => boolean): { point: THREE.Vector3; normal: THREE.Vector3; box: CollisionBox; fraction: number } | null {
    let best: { point: THREE.Vector3; normal: THREE.Vector3; box: CollisionBox; fraction: number } | null = null;
    for (const b of this.boxes) {
      if (filter && !filter(b)) continue;
      const invDir = new THREE.Vector3(
        dir.x === 0 ? Infinity : 1 / dir.x,
        dir.y === 0 ? Infinity : 1 / dir.y,
        dir.z === 0 ? Infinity : 1 / dir.z
      );
      let t1 = (b.min.x - origin.x) * invDir.x;
      let t2 = (b.max.x - origin.x) * invDir.x;
      let nx = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; nx = 1; }

      let t3 = (b.min.y - origin.y) * invDir.y;
      let t4 = (b.max.y - origin.y) * invDir.y;
      let ny = -1;
      if (t3 > t4) { const tmp = t3; t3 = t4; t4 = tmp; ny = 1; }

      let t5 = (b.min.z - origin.z) * invDir.z;
      let t6 = (b.max.z - origin.z) * invDir.z;
      let nz = -1;
      if (t5 > t6) { const tmp = t5; t5 = t6; t6 = tmp; nz = 1; }

      const tmin = Math.max(Math.max(t1, t3), t5);
      const tmax = Math.min(Math.min(t2, t4), t6);
      if (tmax < 0 || tmin > tmax) continue;
      if (tmin > maxDist) continue;
      if (!best || tmin < best.fraction) {
        const point = origin.clone().add(dir.clone().multiplyScalar(tmin));
        let normal = new THREE.Vector3(0, -1, 0);
        if (t1 === tmin) normal.set(nx, 0, 0);
        else if (t3 === tmin) normal.set(0, ny, 0);
        else normal.set(0, 0, nz);
        best = { point, normal, box: b, fraction: tmin };
      }
    }
    return best;
  }

  // Find ground below a point within maxDist
  groundBelow(point: THREE.Vector3, maxDist: number, filter?: (b: CollisionBox) => boolean): { box: CollisionBox; y: number } | null {
    const result = this.raycast(point, new THREE.Vector3(0, -1, 0), maxDist, filter);
    if (result && result.normal.y > 0.5) {
      return { box: result.box, y: result.point.y };
    }
    return null;
  }
}
