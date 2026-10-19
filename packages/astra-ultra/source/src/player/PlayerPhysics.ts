import { Vector3 } from 'three';
import type { Collider, CollisionWorld } from '../world/CollisionWorld';

export const PLAYER_RADIUS = 0.31;
export const STANDING_HEIGHT = 1.8;
export const SLIDING_HEIGHT = 0.8;
const EPSILON = 0.0001;

/** Feet-based AABB collision; horizontal movement is subdivided to prevent tunnelling. */
export class PlayerPhysics {
  private probe = new Vector3();
  constructor(readonly world: CollisionWorld) {}

  overlaps(position: Vector3, height: number, collider: Collider, radius = PLAYER_RADIUS): boolean {
    return position.x + radius > collider.min.x + EPSILON && position.x - radius < collider.max.x - EPSILON &&
      position.z + radius > collider.min.z + EPSILON && position.z - radius < collider.max.z - EPSILON &&
      position.y + height > collider.min.y + EPSILON && position.y < collider.max.y - EPSILON;
  }

  canOccupy(position: Vector3, height: number, ignore?: Collider): boolean {
    return !this.world.colliders.some(collider => collider !== ignore && this.overlaps(position, height, collider));
  }

  support(position: Vector3, distance = 0.08): Collider | undefined {
    return this.world.colliders.find(collider =>
      position.x + PLAYER_RADIUS > collider.min.x + EPSILON && position.x - PLAYER_RADIUS < collider.max.x - EPSILON &&
      position.z + PLAYER_RADIUS > collider.min.z + EPSILON && position.z - PLAYER_RADIUS < collider.max.z - EPSILON &&
      collider.max.y <= position.y + 0.025 && collider.max.y >= position.y - distance,
    );
  }

  move(position: Vector3, velocity: Vector3, height: number, dt: number, grounded: boolean): { grounded: boolean; impact: number } {
    const maxTravel = Math.max(Math.abs(velocity.x), Math.abs(velocity.y), Math.abs(velocity.z)) * dt;
    const steps = Math.max(1, Math.ceil(maxTravel / 0.12));
    const step = dt / steps;
    let floor = false;
    let impact = 0;
    for (let i = 0; i < steps; i++) {
      for (const axis of ['x', 'z'] as const) {
        const amount = velocity[axis] * step;
        if (amount === 0) continue;
        position[axis] += amount;
        for (const collider of this.world.colliders) {
          if (!this.overlaps(position, height, collider)) continue;
          const rise = collider.max.y - position.y;
          if ((grounded || floor) && rise > 0 && rise <= 0.24) {
            this.probe.copy(position); this.probe.y = collider.max.y + EPSILON;
            if (this.canOccupy(this.probe, height)) { position.y = this.probe.y; continue; }
          }
          position[axis] = amount > 0 ? collider.min[axis] - PLAYER_RADIUS : collider.max[axis] + PLAYER_RADIUS;
          velocity[axis] = 0;
        }
      }
      const amount = velocity.y * step;
      position.y += amount;
      if (amount !== 0) {
        for (const collider of this.world.colliders) {
          if (!this.overlaps(position, height, collider)) continue;
          if (amount < 0) {
            position.y = collider.max.y;
            impact = Math.max(impact, -velocity.y);
            floor = true;
          } else position.y = collider.min.y - height;
          velocity.y = 0;
        }
      }
    }
    if (velocity.y <= 0) {
      const below = this.support(position, 0.045);
      if (below) { position.y = below.max.y; floor = true; velocity.y = 0; }
    }
    return { grounded: floor, impact };
  }

  /** Ray/rectangle intersection in the horizontal plane. */
  rayBox(position: Vector3, direction: Vector3, collider: Collider): { near: number; far: number } | undefined {
    let near = -Infinity;
    let far = Infinity;
    for (const axis of ['x', 'z'] as const) {
      if (Math.abs(direction[axis]) < 0.00001) {
        if (position[axis] < collider.min[axis] || position[axis] > collider.max[axis]) return;
      } else {
        const a = (collider.min[axis] - position[axis]) / direction[axis];
        const b = (collider.max[axis] - position[axis]) / direction[axis];
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
    }
    if (far >= Math.max(near, 0)) return { near, far };
  }
}
