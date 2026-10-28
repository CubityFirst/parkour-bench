import { Vector3 } from 'three';
import { PHYSICS } from '../game/Config';
import type { CollisionWorld } from '../world/CollisionWorld';
import { ParkourSystem } from './ParkourSystem';
import { PlayerPhysics } from './PlayerPhysics';

export interface PlayerInputState {
  /** -1 (back) .. 1 (forward) */
  forward: number;
  /** -1 (left) .. 1 (right) */
  strafe: number;
  sprint: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  slidePressed: boolean;
  slideHeld: boolean;
  vaultPressed: boolean;
}

export interface LookDirection {
  yaw: number;
  pitch: number;
}

/**
 * Turns raw input into player movement.
 *
 * The controller owns the "normal" locomotion (acceleration, friction, jump
 * rules) and delegates the parkour verbs to {@link ParkourSystem}.
 */
export class PlayerController {
  readonly physics: PlayerPhysics;
  readonly parkour = new ParkourSystem();

  /** Horizontal look direction, updated every frame. */
  readonly forward = new Vector3(0, 0, -1);
  readonly right = new Vector3(1, 0, 0);

  /** Set to a value in 0..1 when the player hits the ground after a fall. */
  landImpact = 0;
  /** Horizontal speed in m/s. */
  speed = 0;
  /** True while the player is airborne (not sliding on the ground). */
  airborne = false;
  /** Number of falls in the current run. */
  falls = 0;

  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumpCutApplied = false;
  private airMaxSpeed = 0;
  private wasGrounded = true;
  private readonly wish = new Vector3();

  constructor(private readonly world: CollisionWorld) {
    this.physics = new PlayerPhysics(world);
  }

  /** Places the player at a checkpoint and clears all movement state. */
  respawn(x: number, y: number, z: number, yaw: number): void {
    this.physics.reset(x, y, z);
    this.physics.height = PHYSICS.standHeight;
    this.parkour.onRespawn(PHYSICS.standHeight);
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.jumpCutApplied = false;
    this.airMaxSpeed = 0;
    this.landImpact = 0;
    this.wasGrounded = true;
    this.speed = 0;
    this.updateBasis(yaw);
  }

  updateBasis(yaw: number): void {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    this.forward.set(-sin, 0, -cos);
    this.right.set(cos, 0, -sin);
  }

  update(dt: number, input: PlayerInputState, look: LookDirection): void {
    this.updateBasis(look.yaw);

    const phys = this.physics;
    const parkour = this.parkour;

    // --- desired direction ------------------------------------------------
    this.wish.set(0, 0, 0);
    this.wish.addScaledVector(this.forward, input.forward);
    this.wish.addScaledVector(this.right, input.strafe);
    const wishLength = this.wish.length();
    if (wishLength > 1) this.wish.multiplyScalar(1 / wishLength);
    const hasInput = wishLength > 0.05;

    // --- parkour state machine --------------------------------------------
    const stateBefore = parkour.state;
    const scripted = stateBefore === 'vault' || stateBefore === 'mantle';

    // --- jump buffering / coyote time -------------------------------------
    if (input.jumpPressed) this.jumpBufferTimer = PHYSICS.jumpBuffer;
    if (this.jumpBufferTimer > 0) this.jumpBufferTimer -= dt;
    if (phys.grounded) {
      this.coyoteTimer = PHYSICS.coyoteTime;
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer -= dt;
    }

    // The jump is applied before the parkour system runs so that a wall run
    // can start in the very same frame as the jump that leaves the roof.
    if (!scripted && this.jumpBufferTimer > 0 && (phys.grounded || this.coyoteTimer > 0)) {
      phys.velocity.y = PHYSICS.jumpVelocity;
      phys.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.jumpCutApplied = false;
      this.airMaxSpeed = Math.hypot(phys.velocity.x, phys.velocity.z);
    }

    // --- parkour state machine --------------------------------------------
    parkour.update(dt, {
      physics: phys,
      world: this.world,
      forward: this.forward,
      right: this.right,
      wish: this.wish,
      jumpPressed: input.jumpPressed,
      jumpHeld: input.jumpHeld,
      slidePressed: input.slidePressed,
      slideHeld: input.slideHeld,
      vaultPressed: input.vaultPressed,
      sprint: input.sprint,
    });

    const state = parkour.state;

    if (!scripted) {
      const maxSpeed = input.sprint ? PHYSICS.sprintSpeed : PHYSICS.walkSpeed;
      const sliding = state === 'slide';
      const wallRunning = state === 'wallrun';

      if (!sliding) {
        this.applyLocomotion(dt, maxSpeed, hasInput, phys.grounded);
      }
      if (!wallRunning) {
        phys.velocity.y -= PHYSICS.gravity * dt;
      }

      // Variable jump height: releasing the button cuts the rise.
      if (!input.jumpHeld && !this.jumpCutApplied && phys.velocity.y > 0) {
        phys.velocity.y *= PHYSICS.jumpCut;
        this.jumpCutApplied = true;
      }
    }

    // --- body height (stand <-> slide) -----------------------------------
    this.updateBodyHeight(dt, parkour.bodyHeight);

    // --- integrate ---------------------------------------------------------
    if (!scripted) {
      phys.integrate(dt);
    }

    // --- feedback ----------------------------------------------------------
    this.speed = Math.hypot(phys.velocity.x, phys.velocity.z);
    this.airborne = !phys.grounded;

    if (phys.grounded && !this.wasGrounded) {
      this.landImpact = Math.min(1, Math.max(0, (this.airMaxSpeed - 4) / 10) + 0.25);
      // A touch of controlled friction so landings feel weighty.
      this.speed *= 0.96;
    }
    this.wasGrounded = phys.grounded;

    if (!phys.grounded) {
      this.airMaxSpeed = Math.max(this.airMaxSpeed, this.speed);
    } else {
      this.airMaxSpeed = this.speed;
    }
  }

  private applyLocomotion(
    dt: number,
    maxSpeed: number,
    hasInput: boolean,
    grounded: boolean,
  ): void {
    const phys = this.physics;
    const vx = phys.velocity.x;
    const vz = phys.velocity.z;

    if (grounded) {
      if (hasInput) {
        const targetVx = this.wish.x * maxSpeed;
        const targetVz = this.wish.z * maxSpeed;
        const dx = targetVx - vx;
        const dz = targetVz - vz;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.0001) {
          const amount = Math.min(distance, PHYSICS.groundAccel * dt);
          phys.velocity.x += (dx / distance) * amount;
          phys.velocity.z += (dz / distance) * amount;
        }
      } else {
        // Friction only when there is no input.
        const speed = Math.hypot(vx, vz);
        if (speed > 0.0001) {
          const amount = Math.min(speed, PHYSICS.groundFriction * dt);
          const scale = (speed - amount) / speed;
          phys.velocity.x *= scale;
          phys.velocity.z *= scale;
        }
      }
      return;
    }

    // Airborne: limited air control that never exceeds the momentum the
    // player brought into the air.
    if (hasInput) {
      const projection = vx * this.wish.x + vz * this.wish.z;
      if (projection < maxSpeed) {
        const add = PHYSICS.airAccel * dt;
        phys.velocity.x += this.wish.x * add;
        phys.velocity.z += this.wish.z * add;
      }
    } else {
      const drag = 1 - PHYSICS.airDrag * dt;
      phys.velocity.x *= drag;
      phys.velocity.z *= drag;
    }

    const limit = Math.max(maxSpeed, this.airMaxSpeed);
    const speed = Math.hypot(phys.velocity.x, phys.velocity.z);
    if (speed > limit && speed > 0.0001) {
      const scale = limit / speed;
      phys.velocity.x *= scale;
      phys.velocity.z *= scale;
    }
  }

  private updateBodyHeight(dt: number, target: number): void {
    const phys = this.physics;
    const rate = 22;
    const diff = target - phys.height;
    if (Math.abs(diff) < 0.001) {
      phys.height = target;
      return;
    }
    const step = Math.min(Math.abs(diff), rate * dt) * Math.sign(diff);
    const next = phys.height + step;
    if (next > phys.height && !phys.fitsAt(phys.position.y, next)) return;
    phys.height = next;
  }
}
