import { Vector3 } from 'three';
import { CollisionWorld } from '../world/CollisionWorld';
import { MOVE, PlayerEvent, clamp } from './MoveConfig';
import { ParkourSystem } from './ParkourSystem';
import { Contact, PlayerPhysics, createContact } from './PlayerPhysics';

export interface MoveInput {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  jumpHeld: boolean;
}

const LOOK_SCALE = 0.0022;

/**
 * First-person character controller: momentum-based ground and air movement,
 * variable jumps, coyote time, jump buffering, sliding and the parkour moves.
 *
 * Call `update` at a fixed timestep. Input edges (jump, slide, vault) are queued
 * with the `queue*`/`request*` methods and consumed on the next update.
 */
export class PlayerController {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  /** Pending events (jump, land, ...) for audio and camera feedback. Consumer clears it. */
  readonly events: PlayerEvent[] = [];
  readonly parkour: ParkourSystem;

  yaw = 0;
  pitch = 0;
  height: number = MOVE.standHeight;
  grounded = false;
  sliding = false;

  private readonly physics: PlayerPhysics;
  private readonly contact: Contact = createContact();
  private jumpBuffer = 0;
  private coyote = 0;
  private jumpCutArmed = false;
  private slideTime = 0;
  private slideRequested = false;
  private vaultRequested = false;
  private stepDistance = 0;

  constructor(world: CollisionWorld) {
    this.physics = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(world, this.physics, this.events);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Unit vector the player faces, on the ground plane. */
  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  /** Unit vector to the player's right, on the ground plane. */
  right(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  look(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * LOOK_SCALE * sensitivity;
    this.pitch = clamp(this.pitch - dy * LOOK_SCALE * sensitivity, -1.45, 1.45);
  }

  queueJump(): void {
    this.jumpBuffer = MOVE.jumpBuffer;
  }

  requestSlide(): void {
    this.slideRequested = true;
  }

  requestVault(): void {
    this.vaultRequested = true;
  }

  respawn(spawn: Vector3): void {
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.height = MOVE.standHeight;
    this.sliding = false;
    this.grounded = false;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.jumpCutArmed = false;
    this.slideRequested = false;
    this.vaultRequested = false;
    this.slideTime = 0;
    this.stepDistance = 0;
    this.parkour.reset();
  }

  update(dt: number, input: MoveInput): void {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const wasGrounded = this.grounded;
    this.coyote = wasGrounded ? MOVE.coyoteTime : Math.max(0, this.coyote - dt);

    // A vault or mantle drives the body until it finishes
    if (this.parkour.updateClimb(dt, this.position, this.velocity)) {
      this.grounded = false;
      this.slideRequested = false;
      this.vaultRequested = false;
      return;
    }

    // Desired direction in world space, from WASD and facing
    const f = this.forward();
    const r = this.right();
    let wishX = f.x * input.moveZ + r.x * input.moveX;
    let wishZ = f.z * input.moveZ + r.z * input.moveX;
    const wishLength = Math.hypot(wishX, wishZ);
    const hasWish = wishLength > 1e-4;
    if (hasWish) {
      wishX /= wishLength;
      wishZ /= wishLength;
    }

    if (this.slideRequested) {
      this.slideRequested = false;
      if (wasGrounded && !this.sliding && this.horizontalSpeed > MOVE.slideStartSpeed) {
        this.beginSlide();
      }
    }

    if (this.vaultRequested) {
      this.vaultRequested = false;
      if (!this.sliding) {
        const dirX = hasWish ? wishX : f.x;
        const dirZ = hasWish ? wishZ : f.z;
        if (this.parkour.tryVault(this.position, this.velocity, dirX, dirZ)) {
          this.grounded = false;
          return;
        }
      }
    }

    const onWall = !this.sliding && this.parkour.updateWallRun(dt, this.position, this.velocity, this.height, wasGrounded);
    if (onWall && this.jumpBuffer > 0) {
      this.parkour.wallJump(this.velocity);
      this.jumpBuffer = 0;
      this.events.push({ type: 'jump', value: 0 });
    }

    if (this.sliding) {
      this.updateSlide(dt, wasGrounded, hasWish, wishX, wishZ);
    }
    if (!this.sliding && !onWall) {
      if (wasGrounded) {
        this.groundMove(dt, hasWish, wishX, wishZ, input.sprint);
      } else {
        this.airMove(dt, hasWish, wishX, wishZ);
      }
    }

    if (!onWall) {
      this.velocity.y = Math.max(this.velocity.y - MOVE.gravity * dt, -MOVE.maxFall);
    }

    // Jump from ground, or within the coyote window after leaving a ledge
    if (this.jumpBuffer > 0 && !onWall && (wasGrounded || this.coyote > 0)) {
      if (!this.sliding || this.canStand()) {
        this.sliding = false;
        this.velocity.y = MOVE.jumpVelocity;
        this.jumpCutArmed = true;
        this.jumpBuffer = 0;
        this.coyote = 0;
        this.grounded = false;
        this.events.push({ type: 'jump', value: 0 });
      }
    }

    // Variable jump height: releasing early cuts the ascent short
    if (this.jumpCutArmed) {
      if (!input.jumpHeld) {
        if (this.velocity.y > 0) this.velocity.y *= MOVE.jumpCut;
        this.jumpCutArmed = false;
      } else if (this.velocity.y <= 0) {
        this.jumpCutArmed = false;
      }
    }

    this.updateHeight(dt);

    const impact = Math.max(0, -this.velocity.y);
    this.physics.move(this.position, this.velocity, this.height, dt, this.contact);
    this.grounded = this.contact.grounded;

    // Ledge recovery: pushing into a ledge (walking or airborne) pulls the body up onto it
    if (this.contact.hitBox && (this.contact.hitX || this.contact.hitZ) && hasWish && !this.sliding) {
      if (this.parkour.tryMantle(this.contact.hitBox, this.position, this.velocity, wishX, wishZ)) {
        this.grounded = false;
        return;
      }
    }

    if (!wasGrounded && this.grounded) {
      this.events.push({ type: 'land', value: clamp(impact / 14, 0, 1) });
    }

    if (this.grounded && !this.sliding && this.horizontalSpeed > 2) {
      this.stepDistance += this.horizontalSpeed * dt;
      if (this.stepDistance > 2) {
        this.stepDistance = 0;
        this.events.push({ type: 'step', value: 0 });
      }
    }
  }

  private groundMove(dt: number, hasWish: boolean, wishX: number, wishZ: number, sprint: boolean): void {
    if (hasWish) {
      this.accelerate(wishX, wishZ, sprint ? MOVE.sprintSpeed : MOVE.walkSpeed, MOVE.groundAccel * dt);
    } else {
      this.applyFriction(MOVE.groundFriction * dt);
    }
  }

  /** Air control only steers: it never reduces momentum below the current speed. */
  private airMove(dt: number, hasWish: boolean, wishX: number, wishZ: number): void {
    if (!hasWish) return;
    const target = Math.max(MOVE.walkSpeed, this.horizontalSpeed);
    this.accelerate(wishX, wishZ, target, MOVE.airAccel * dt);
  }

  /** Quake-style acceleration: adds speed along the wish direction up to `wishSpeed`. */
  private accelerate(wishX: number, wishZ: number, wishSpeed: number, rate: number): void {
    const current = this.velocity.x * wishX + this.velocity.z * wishZ;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const amount = Math.min(rate * wishSpeed, add);
    this.velocity.x += wishX * amount;
    this.velocity.z += wishZ * amount;
  }

  private applyFriction(amount: number): void {
    if (this.horizontalSpeed <= 0) return;
    const scale = Math.max(0, 1 - amount);
    this.velocity.x *= scale;
    this.velocity.z *= scale;
  }

  private beginSlide(): void {
    this.sliding = true;
    this.slideTime = 0;
    this.events.push({ type: 'slide', value: 0 });
  }

  /** Slide keeps momentum and decays with friction. Ends when slow, or when there is room to stand. */
  private updateSlide(dt: number, wasGrounded: boolean, hasWish: boolean, wishX: number, wishZ: number): void {
    this.slideTime += dt;
    const canStand = this.canStand();
    if (canStand && (!wasGrounded || this.horizontalSpeed < MOVE.slideMinSpeed || this.slideTime > MOVE.slideMaxTime)) {
      this.sliding = false;
      return;
    }
    if (!wasGrounded) return;

    // Stuck under an overhead obstacle at low speed: allow crawling so the player is never trapped
    if (this.horizontalSpeed < MOVE.crouchSpeed && hasWish) {
      this.accelerate(wishX, wishZ, MOVE.crouchSpeed, MOVE.groundAccel * dt);
    } else {
      this.applyFriction(MOVE.slideFriction * dt);
    }
  }

  private canStand(): boolean {
    return !this.physics.overlapsBody(this.position, MOVE.standHeight);
  }

  /** Eases the body height towards standing or sliding, never growing into an obstacle. */
  private updateHeight(dt: number): void {
    const target = this.sliding ? MOVE.slideHeight : MOVE.standHeight;
    const next = Math.abs(target - this.height) < 0.002
      ? target
      : this.height + (target - this.height) * Math.min(1, dt * 14);
    if (next > this.height && this.physics.overlapsBody(this.position, next)) return;
    this.height = next;
  }
}
