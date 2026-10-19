import { Vector3 } from 'three';

export interface Collider {
  id: number;
  min: Vector3;
  max: Vector3;
  kind: 'solid' | 'vault' | 'wallrun';
}

/** Static AABBs. Player positions refer to the center of their feet. */
export class CollisionWorld {
  readonly colliders: Collider[] = [];

  add(x: number, y: number, z: number, w: number, h: number, d: number, kind: Collider['kind'] = 'solid') {
    const box: Collider = {
      id: this.colliders.length,
      min: new Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new Vector3(x + w / 2, y + h / 2, z + d / 2),
      kind,
    };
    this.colliders.push(box);
    return box;
  }

  overlaps(p: Vector3, h: number, r = 0.34, epsilon = 0.001) {
    return this.colliders.some(b => p.x + r > b.min.x + epsilon && p.x - r < b.max.x - epsilon &&
      p.z + r > b.min.z + epsilon && p.z - r < b.max.z - epsilon &&
      p.y + h > b.min.y + epsilon && p.y < b.max.y - epsilon);
  }

  move(p: Vector3, v: Vector3, height: number, dt: number) {
    const r = 0.34;
    let grounded = false;
    // At 120Hz even sprint displacement is < 12cm, smaller than all solid geometry.
    for (const axis of ['x', 'z', 'y'] as const) {
      const delta = v[axis] * dt;
      if (delta === 0) continue;
      p[axis] += delta;
      for (const b of this.colliders) {
        if (p.x + r <= b.min.x || p.x - r >= b.max.x || p.z + r <= b.min.z || p.z - r >= b.max.z ||
          p.y + height <= b.min.y + 0.00001 || p.y >= b.max.y - 0.00001) continue;
        if (axis === 'y') {
          if (delta < 0) { p.y = b.max.y; grounded = true; }
          else p.y = b.min.y - height;
        } else {
          p[axis] = delta > 0 ? b.min[axis] - r : b.max[axis] + r;
        }
        v[axis] = 0;
      }
    }
    return grounded;
  }

  wallNear(p: Vector3, height: number) {
    return this.colliders.find(b => b.kind === 'wallrun' && p.y + height > b.min.y && p.y < b.max.y - 0.4 &&
      p.z > b.min.z - 0.2 && p.z < b.max.z + 0.2 &&
      Math.min(Math.abs(p.x - b.min.x), Math.abs(p.x - b.max.x)) < 1.8);
  }

  supportAt(p: Vector3, below = 1) {
    return this.colliders.find(b => p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z &&
      b.max.y <= p.y + 0.05 && b.max.y >= p.y - below);
  }
}
