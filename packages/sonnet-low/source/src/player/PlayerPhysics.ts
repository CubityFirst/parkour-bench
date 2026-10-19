import * as THREE from 'three';
import { CollisionWorld } from '../world/CollisionWorld';

export const RADIUS = 0.35;
export const STAND_H = 1.8;
export const SLIDE_H = 0.9;
const EPS = 0.0005;

/**
 * Body state plus axis-separated AABB collision.
 * Position is the centre of the feet. The caller runs this at a small fixed
 * timestep (1/120 s) so even 13 m/s moves only ~0.11 m per step (< radius),
 * which makes tunnelling through the 0.5+ m thick colliders impossible.
 */
export class PlayerPhysics {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  height = STAND_H;
  grounded = false;

  constructor(public world: CollisionWorld) {}

  setHeight(h: number): void { this.height = h; }

  canStand(): boolean {
    const p = this.pos;
    return !this.world.overlaps(p.x - RADIUS, p.y + 0.01, p.z - RADIUS, p.x + RADIUS, p.y + STAND_H, p.z + RADIUS);
  }

  isFree(x: number, y: number, z: number, h = STAND_H): boolean {
    return !this.world.overlaps(x - RADIUS, y + 0.01, z - RADIUS, x + RADIUS, y + h, z + RADIUS);
  }

  /** Integrates velocity and resolves collisions one axis at a time. */
  move(dt: number): void {
    const p = this.pos, v = this.vel;
    this.grounded = false;
    p.x += v.x * dt; this.collide('x');
    p.z += v.z * dt; this.collide('z');
    p.y += v.y * dt; this.collide('y');
  }

  private collide(axis: 'x' | 'y' | 'z'): void {
    const p = this.pos, v = this.vel, r = RADIUS, h = this.height;
    for (const b of this.world.boxes) {
      if (p.x + r <= b.minX || p.x - r >= b.maxX) continue;
      if (p.z + r <= b.minZ || p.z - r >= b.maxZ) continue;
      if (p.y + h <= b.minY || p.y + EPS >= b.maxY) continue;
      if (axis === 'x') {
        if (v.x > 0) p.x = b.minX - r - EPS; else if (v.x < 0) p.x = b.maxX + r + EPS;
        v.x = 0;
      } else if (axis === 'z') {
        if (v.z > 0) p.z = b.minZ - r - EPS; else if (v.z < 0) p.z = b.maxZ + r + EPS;
        v.z = 0;
      } else {
        if (v.y <= 0) { p.y = b.maxY; this.grounded = true; }
        else p.y = b.minY - h - EPS;
        v.y = 0;
      }
    }
  }
}
