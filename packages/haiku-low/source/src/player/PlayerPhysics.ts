import { Vector3 } from 'three';
import { Box, CollisionWorld } from '../world/CollisionWorld';

/** Half the body width. The body is an upright box: feet at `position.y`, height chosen by the caller. */
export const HALF_WIDTH = 0.35;
const EPS = 0.001;

export interface Contact {
  hitX: boolean;
  hitZ: boolean;
  grounded: boolean;
  ceiling: boolean;
  /** The last solid hit horizontally, used for ledge detection. */
  hitBox: Box | null;
}

export function createContact(): Contact {
  return { hitX: false, hitZ: false, grounded: false, ceiling: false, hitBox: null };
}

/**
 * Moves a box-shaped body through the world one axis at a time (X, then Z, then Y).
 * Resolving per axis lets the body slide along walls and stand on floors.
 */
export class PlayerPhysics {
  constructor(private readonly world: CollisionWorld) {}

  /** True if a body with feet at `feet` and the given height intersects any solid. */
  overlapsBody(feet: Vector3, height: number): boolean {
    for (const box of this.world.boxes) {
      if (this.overlapsBox(feet, height, box)) return true;
    }
    return false;
  }

  move(feet: Vector3, vel: Vector3, height: number, dt: number, contact: Contact): void {
    contact.hitX = false;
    contact.hitZ = false;
    contact.grounded = false;
    contact.ceiling = false;
    contact.hitBox = null;

    // Horizontal X
    const dirX = Math.sign(vel.x);
    feet.x += vel.x * dt;
    if (dirX !== 0) {
      for (const box of this.world.boxes) {
        if (!this.overlapsBox(feet, height, box)) continue;
        feet.x = dirX > 0 ? box.min.x - HALF_WIDTH - EPS : box.max.x + HALF_WIDTH + EPS;
        contact.hitX = true;
        contact.hitBox = box;
      }
    }
    if (contact.hitX) vel.x = 0;

    // Horizontal Z
    const dirZ = Math.sign(vel.z);
    feet.z += vel.z * dt;
    if (dirZ !== 0) {
      for (const box of this.world.boxes) {
        if (!this.overlapsBox(feet, height, box)) continue;
        feet.z = dirZ > 0 ? box.min.z - HALF_WIDTH - EPS : box.max.z + HALF_WIDTH + EPS;
        contact.hitZ = true;
        contact.hitBox = box;
      }
    }
    if (contact.hitZ) vel.z = 0;

    // Vertical Y
    const dirY = Math.sign(vel.y);
    feet.y += vel.y * dt;
    if (dirY !== 0) {
      for (const box of this.world.boxes) {
        if (!this.overlapsBox(feet, height, box)) continue;
        if (dirY < 0) {
          feet.y = box.max.y + EPS;
          contact.grounded = true;
        } else {
          feet.y = box.min.y - height - EPS;
          contact.ceiling = true;
        }
      }
    }
    if (contact.grounded || contact.ceiling) vel.y = 0;
  }

  private overlapsBox(feet: Vector3, height: number, box: Box): boolean {
    return (
      box.min.x < feet.x + HALF_WIDTH && box.max.x > feet.x - HALF_WIDTH &&
      box.min.y < feet.y + height && box.max.y > feet.y &&
      box.min.z < feet.z + HALF_WIDTH && box.max.z > feet.z - HALF_WIDTH
    );
  }
}
