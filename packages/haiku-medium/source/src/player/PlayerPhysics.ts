import * as THREE from 'three';
import { CollisionWorld, MoveResult } from '../world/CollisionWorld';

/** Tuning values, in metres and seconds. Jump apex is ~1.3 m, sprint jumps clear ~6 m gaps. */
export const TUNING = {
  halfWidth: 0.3,
  standHeight: 1.75,
  slideHeight: 0.85,
  walkSpeed: 6.5,
  sprintSpeed: 11,
  /** Acceleration toward the wish direction on the ground (m/s^2). */
  groundAccel: 48,
  /** Deceleration when there is no input (m/s^2). */
  groundFriction: 14,
  /** Acceleration on the ground while sliding. Friction only, no steering. */
  slideFriction: 2.6,
  /** Air steering strength. Kept low so momentum dominates. */
  airControl: 3.2,
  gravity: 30,
  maxFallSpeed: 42,
  jumpVelocity: 8.6,
  /** How quickly upward velocity decays when the jump key is released early. */
  jumpCutRate: 9,
  coyoteTime: 0.12,
  jumpBufferTime: 0.12,
} as const;

/** Input for one fixed physics step, expressed in world space. */
export interface MoveIntent {
  /** Unit wish direction on the ground plane (zero if no input). */
  wishX: number;
  wishZ: number;
  sprint: boolean;
  sliding: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  /** Multiplier for gravity; wall running uses a reduced value. */
  gravityScale: number;
}

/**
 * Core movement: horizontal momentum, gravity, jumping, and collision.
 * Parkour-specific states (slide, wall run, vault, mantle) live in ParkourSystem
 * and feed into this step through `MoveIntent` and the public fields.
 */
export class PlayerPhysics {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  height: number = TUNING.standHeight;
  grounded = false;
  /** Set on the frame the player jumped, read by the controller for audio/camera. */
  jumpedThisStep = false;
  /** Set on the frame the player touched down after being airborne. */
  landedThisStep = false;
  /** Downward speed at the moment of the last landing. Used for landing impact. */
  lastImpactSpeed = 0;

  private coyote = 0;
  private jumpBuffer = 0;
  private wasGrounded = false;
  private jumpCutActive = false;

  reset(at: THREE.Vector3): void {
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.height = TUNING.standHeight;
    this.grounded = false;
    this.wasGrounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCutActive = false;
  }

  /** Horizontal speed in m/s. */
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  step(dt: number, intent: MoveIntent, world: CollisionWorld): MoveResult {
    this.jumpedThisStep = false;
    this.landedThisStep = false;

    this.updateTimers(dt, intent);
    this.applyHorizontal(dt, intent);
    this.applyVertical(dt, intent);
    this.tryJump();

    const delta = new THREE.Vector3(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    const result = world.move(this.pos, this.vel, TUNING.halfWidth, this.height, delta);

    this.grounded = result.onGround;
    if (this.grounded && !this.wasGrounded) {
      this.landedThisStep = true;
      this.lastImpactSpeed = Math.max(0, -this.vel.y);
    }
    if (this.grounded) this.coyote = TUNING.coyoteTime;
    this.wasGrounded = this.grounded;
    return result;
  }

  private updateTimers(dt: number, intent: MoveIntent): void {
    this.coyote = Math.max(0, this.coyote - dt);
    if (intent.jumpPressed) this.jumpBuffer = TUNING.jumpBufferTime;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
  }

  /**
   * Horizontal movement. On the ground, input accelerates toward the target
   * speed but never removes speed above it, so sprint momentum is kept.
   * Without input, friction slows the player.
   */
  private applyHorizontal(dt: number, intent: MoveIntent): void {
    const hasWish = intent.wishX !== 0 || intent.wishZ !== 0;

    if (this.grounded) {
      if (intent.sliding) {
        this.applyFriction(TUNING.slideFriction * dt);
        return;
      }
      if (hasWish) {
        const target = intent.sprint ? TUNING.sprintSpeed : TUNING.walkSpeed;
        const currentAlong = this.vel.x * intent.wishX + this.vel.z * intent.wishZ;
        const addSpeed = target - currentAlong;
        if (addSpeed > 0) {
          const accel = Math.min(TUNING.groundAccel * dt * target, addSpeed);
          this.vel.x += intent.wishX * accel;
          this.vel.z += intent.wishZ * accel;
        }
      } else {
        this.applyFriction(TUNING.groundFriction * dt);
      }
      return;
    }

    // Air: steer gently without exceeding the faster of current speed and sprint speed.
    if (hasWish) {
      const cap = Math.max(this.speed, TUNING.sprintSpeed);
      const steer = TUNING.airControl * 3.5 * dt;
      this.vel.x += intent.wishX * steer;
      this.vel.z += intent.wishZ * steer;
      const s = this.speed;
      if (s > cap) {
        this.vel.x *= cap / s;
        this.vel.z *= cap / s;
      }
    }
  }

  private applyFriction(amount: number): void {
    const s = this.speed;
    if (s < 1e-6) return;
    const next = Math.max(0, s - amount);
    const k = next / s;
    this.vel.x *= k;
    this.vel.z *= k;
  }

  private applyVertical(dt: number, intent: MoveIntent): void {
    if (this.grounded) {
      if (this.vel.y < 0) this.vel.y = 0;
    } else {
      this.vel.y -= TUNING.gravity * intent.gravityScale * dt;
      if (this.vel.y < -TUNING.maxFallSpeed) this.vel.y = -TUNING.maxFallSpeed;
    }

    // Variable jump height: releasing jump early decays upward velocity.
    if (this.jumpCutActive && !intent.jumpHeld && this.vel.y > 0) {
      this.vel.y -= this.vel.y * TUNING.jumpCutRate * dt;
    }
    if (intent.jumpHeld && this.vel.y <= 0) this.jumpCutActive = false;
  }

  private tryJump(): void {
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = TUNING.jumpVelocity;
      this.jumpCutActive = true;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.jumpedThisStep = true;
    }
  }

  /** Gives an explicit jump impulse, used for wall jumps and similar moves. */
  impulse(horizontal: THREE.Vector3, vertical: number): void {
    this.vel.x = horizontal.x;
    this.vel.z = horizontal.z;
    this.vel.y = vertical;
    this.jumpCutActive = true;
    this.grounded = false;
    this.coyote = 0;
    this.jumpedThisStep = true;
  }
}
