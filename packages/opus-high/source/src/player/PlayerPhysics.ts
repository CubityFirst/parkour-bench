import * as THREE from 'three';
import { COLLISION_EPS, CollisionWorld, type Collider } from '../world/CollisionWorld';

/**
 * All movement tuning values in one place (metres, seconds).
 *
 * Reference numbers the level is designed around:
 *  - standing jump apex ≈ jumpSpeed² / 2g ≈ 1.63 m
 *  - sprint jump distance on flat ground ≈ 11.5 m/s × 0.71 s ≈ 8 m
 *  - walk  jump distance on flat ground ≈  7.0 m/s × 0.71 s ≈ 5 m
 *  - wall run covers ≈ 14–16 m before gravity wins
 */
export const PLAYER = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 0.9,
  eyeStand: 1.65,
  eyeCrouch: 0.8,

  walkSpeed: 7.0,
  sprintSpeed: 11.5,
  crouchSpeed: 3.6,
  groundAccel: 48,
  groundFriction: 42,
  /** How quickly speed above the current cap bleeds off on the ground (momentum conservation). */
  overspeedDecay: 5.5,
  airAccel: 16,

  gravity: 26,
  maxFallSpeed: 45,
  jumpSpeed: 9.2,
  /** Vertical speed multiplier applied once when jump is released early (variable jump height). */
  jumpCutFactor: 0.5,
  coyoteTime: 0.12,
  jumpBufferTime: 0.14,
  stepHeight: 0.45,
  airStepHeight: 0.5,

  slideMinStartSpeed: 4.5,
  slideBoost: 2.5,
  slideMaxSpeed: 14,
  slideFriction: 5.5,
  slideEndSpeed: 4.6,
  slideMinTime: 0.35,
  slideCooldown: 0.25,
  slideBufferTime: 0.18,
  slideSteer: 1.6,

  wallRunMinSpeed: 6,
  wallRunSpeed: 10.5,
  wallRunMaxTime: 1.6,
  wallRunGravityStart: 4.5,
  wallRunGravityGrowth: 6,
  wallRunMinVy: 2.5,
  wallRunMaxVy: 4.5,
  wallDetectDist: 0.7,
  wallJumpOut: 6.5,
  wallJumpUp: 8.4,

  mantleMinReach: 0.3,
  mantleMaxReach: 2.2,
  groundMantleMinReach: 1.0,
  groundMantleMaxReach: 2.0,

  vaultMinHeight: 0.25,
  vaultMaxHeight: 1.35,
  vaultReach: 1.5,
  vaultMaxDepth: 2.6,
  vaultBufferTime: 0.2,
} as const;

export interface MoveResult {
  grounded: boolean;
  groundCollider: Collider | null;
  hitWall: boolean;
  hitCeiling: boolean;
  /** Vertical distance the player was lifted by stepping onto a small obstacle. */
  stepped: number;
}

const tmp: Collider[] = [];

/**
 * Low level collide-and-slide for the player AABB.
 *
 * Movement is resolved one axis at a time (X, then Z, then Y). The fixed
 * 120 Hz timestep keeps per-step displacement well below the thickness of
 * any collider, so fast movement never tunnels through geometry.
 */
export class PlayerPhysics {
  constructor(readonly world: CollisionWorld) {}

  /** True when the player box at (pos, height) does not overlap anything. */
  fits(x: number, y: number, z: number, height: number, radius: number = PLAYER.radius): boolean {
    return this.world.isFree(x - radius, y, z - radius, x + radius, y + height, z + radius);
  }

  move(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, height: number, stepHeight: number): MoveResult {
    const r = PLAYER.radius;
    const res: MoveResult = { grounded: false, groundCollider: null, hitWall: false, hitCeiling: false, stepped: 0 };

    // --- Horizontal axes -------------------------------------------------
    for (let axis = 0; axis < 2; axis++) {
      const d = (axis === 0 ? vel.x : vel.z) * dt;
      if (d === 0) continue;
      if (axis === 0) pos.x += d;
      else pos.z += d;

      this.world.overlapping(pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + height, pos.z + r, tmp);
      for (const c of tmp) {
        // Re-check: an earlier resolution in this loop may already have cleared this box.
        if (!this.overlaps(pos, height, c)) continue;

        // Step up onto low obstacles (curbs, pipes, roof lips) instead of stopping.
        const rise = c.maxY - pos.y;
        if (stepHeight > 0 && rise > 0 && rise <= stepHeight && this.fits(pos.x, c.maxY + COLLISION_EPS, pos.z, height)) {
          pos.y = c.maxY + COLLISION_EPS;
          res.stepped += rise;
          continue;
        }

        if (axis === 0) {
          pos.x = d > 0 ? c.minX - r - COLLISION_EPS * 2 : c.maxX + r + COLLISION_EPS * 2;
          vel.x = 0;
        } else {
          pos.z = d > 0 ? c.minZ - r - COLLISION_EPS * 2 : c.maxZ + r + COLLISION_EPS * 2;
          vel.z = 0;
        }
        res.hitWall = true;
      }
    }

    // --- Vertical axis ---------------------------------------------------
    const dy = vel.y * dt;
    pos.y += dy;
    this.world.overlapping(pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + height, pos.z + r, tmp);
    for (const c of tmp) {
      if (!this.overlaps(pos, height, c)) continue;
      if (dy <= 0) {
        pos.y = c.maxY + COLLISION_EPS;
        vel.y = 0;
        res.grounded = true;
        res.groundCollider = c;
      } else {
        pos.y = c.minY - height - COLLISION_EPS;
        vel.y = 0;
        res.hitCeiling = true;
      }
    }

    // Ground probe: standing still on a surface still counts as grounded.
    if (!res.grounded && vel.y <= 0) {
      const below = this.world.groundBelow(pos.x, pos.z, r - 0.01, pos.y + 0.01);
      if (below > -Infinity && pos.y - below < 0.02) {
        res.grounded = true;
      }
    }
    return res;
  }

  private overlaps(pos: THREE.Vector3, height: number, c: Collider): boolean {
    const r = PLAYER.radius;
    const e = COLLISION_EPS;
    return (
      pos.x + r > c.minX + e &&
      pos.x - r < c.maxX - e &&
      pos.y + height > c.minY + e &&
      pos.y < c.maxY - e &&
      pos.z + r > c.minZ + e &&
      pos.z - r < c.maxZ - e
    );
  }
}
