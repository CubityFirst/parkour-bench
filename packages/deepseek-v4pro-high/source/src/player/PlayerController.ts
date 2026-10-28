import * as THREE from 'three';
import { CONST } from '../constants';
import { PlayerPhysics } from './PlayerPhysics';
import { ParkourSystem } from './ParkourSystem';
import { FirstPersonCamera } from './FirstPersonCamera';
import { Input } from '../input/Input';
import { CollisionWorld } from '../world/CollisionWorld';
import { AudioManager } from '../audio/AudioManager';

const FIXED = 1 / 120;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Drives the player: reads input, maintains the movement/parkour state machine
 * (run, sprint, jump, slide, wall-run, vault, mantle) and advances physics on a
 * fixed timestep for frame-rate-independent behaviour.
 */
export class PlayerController {
  sliding = false;
  wallRunning = false;
  wallRunLean = 0;
  vaulting = false;
  mantling = false;

  private accumulator = 0;

  private coyoteTimer = 0;
  private jumpBuffer = 0;
  private wallRunTimer = 0;
  private wallRunCooldown = 0;
  private wallRunUsed = false;

  private wallAxis: 'x' | 'z' = 'x';
  private wallCoord = 0;
  private wallNormal = new THREE.Vector3(0, 0, -1);

  private vaultT = 0;
  private vaultArcHeight = 0;
  private vaultSpeed = 0;
  private vaultStart = new THREE.Vector3();
  private vaultEnd = new THREE.Vector3();

  private mantleT = 0;
  private mantleStart = new THREE.Vector3();
  private mantleEnd = new THREE.Vector3();

  private fwd = new THREE.Vector3(1, 0, 0);
  private right = new THREE.Vector3(0, 0, 1);

  private moveX = 0;
  private moveZ = 0;

  private wasGrounded = true;
  private prevFallSpeed = 0;
  private footstepTimer = 0;

  constructor(
    readonly physics: PlayerPhysics,
    private world: CollisionWorld,
    private parkour: ParkourSystem,
    private input: Input,
    private camera: FirstPersonCamera,
    private audio: AudioManager | null,
  ) {}

  get grounded(): boolean {
    return this.physics.grounded;
  }

  get horizontalSpeed(): number {
    return this.physics.horizontalSpeed;
  }

  get movingInput(): boolean {
    return this.input.moving;
  }

  get strafeInput(): number {
    return this.moveX;
  }

  /** True when a vaultable obstacle is directly ahead (used for the HUD hint). */
  get canVault(): boolean {
    if (!this.physics.grounded || this.vaulting || this.sliding) return false;
    const feet = this.physics.position.clone();
    feet.y -= this.physics.half.y;
    return this.parkour.vaultTarget(feet, this.fwd) !== null;
  }

  reset(position: THREE.Vector3, yaw: number): void {
    this.physics.reset(position);
    this.camera.setYaw(yaw);
    this.camera.snapTo(position);
    this.coyoteTimer = 0;
    this.jumpBuffer = 0;
    this.sliding = false;
    this.wallRunning = false;
    this.wallRunLean = 0;
    this.vaulting = false;
    this.mantling = false;
    this.wallRunUsed = false;
    this.wallRunCooldown = 0;
    this.accumulator = 0;
    this.wasGrounded = true;
    this.prevFallSpeed = 0;
  }

  update(dt: number): void {
    this.accumulator += Math.min(dt, 0.1);
    let steps = 0;
    while (this.accumulator >= FIXED && steps < 10) {
      this.fixedStep(FIXED);
      this.accumulator -= FIXED;
      steps++;
    }
    if (steps >= 10) this.accumulator = 0;

    this.landingFeedback();
    this.updateFootsteps(dt);
  }

  private fixedStep(dt: number): void {
    const axis = this.input.getMoveAxis();
    this.moveX = axis.x;
    this.moveZ = axis.z;
    this.updateFacing();
    this.updateTimers(dt);

    if (this.vaulting) {
      this.stepVault(dt);
      return;
    }
    if (this.mantling) {
      this.stepMantle(dt);
      return;
    }

    // Vault on demand (E) while grounded.
    if (this.input.vaultPressed && this.physics.grounded) {
      this.tryVault();
      if (this.vaulting) return;
    }

    // Auto mantle when falling just below a reachable ledge.
    if (!this.physics.grounded && this.physics.velocity.y < -2 && !this.wallRunning) {
      this.tryMantle();
      if (this.mantling) return;
    }

    // Wall run state machine.
    if (this.wallRunning) {
      this.stepWallRun(dt);
    } else {
      this.tryStartWallRun(dt);
    }

    this.updateSlide(dt);

    if (!this.wallRunning) this.updateJump(dt);
    if (!this.wallRunning) this.updateMove(dt);

    this.setGravityScale();
    this.physics.integrate(dt);

    if (this.wallRunning) {
      this.physics.position.setComponent(this.wallAxis === 'x' ? 0 : 2, this.wallCoord);
    }
  }

  private updateFacing(): void {
    this.fwd.set(-Math.sin(this.camera.yaw), 0, -Math.cos(this.camera.yaw));
    this.right.set(Math.cos(this.camera.yaw), 0, -Math.sin(this.camera.yaw));
  }

  private updateTimers(dt: number): void {
    if (this.physics.grounded) {
      this.coyoteTimer = CONST.coyoteTime;
      this.wallRunUsed = false;
      this.wallRunCooldown = 0;
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer -= dt;
    }
    if (this.wallRunCooldown > 0 && !this.wallRunning) {
      this.wallRunCooldown -= dt;
    }
  }

  // ------------------------------------------------------------- movement

  private updateMove(dt: number): void {
    const wish = new THREE.Vector3()
      .addScaledVector(this.fwd, this.moveZ)
      .addScaledVector(this.right, this.moveX);
    if (wish.lengthSq() > 1) wish.normalize();

    const sprinting = this.input.sprintHeld && this.moveZ > 0.1;
    const maxSpeed = sprinting ? CONST.sprintSpeed : CONST.walkSpeed;
    const target = wish.clone().multiplyScalar(maxSpeed);

    if (this.physics.grounded) {
      this.accelerate(target, CONST.groundAccel, dt);
      if (this.moveX === 0 && this.moveZ === 0) this.applyFriction(CONST.groundFriction, dt);
    } else {
      this.accelerate(target, CONST.airAccel, dt);
      this.applyFriction(CONST.airFriction, dt);
    }

    // clamp runaway horizontal speed
    const maxH = CONST.sprintSpeed * 1.2;
    const hs = this.physics.horizontalSpeed;
    if (hs > maxH) {
      const k = maxH / hs;
      this.physics.velocity.x *= k;
      this.physics.velocity.z *= k;
    }
  }

  private accelerate(target: THREE.Vector3, accel: number, dt: number): void {
    const dvx = target.x - this.physics.velocity.x;
    const dvz = target.z - this.physics.velocity.z;
    const len = Math.hypot(dvx, dvz);
    const maxDelta = accel * dt;
    if (len > maxDelta) {
      this.physics.velocity.x += (dvx / len) * maxDelta;
      this.physics.velocity.z += (dvz / len) * maxDelta;
    } else {
      this.physics.velocity.x = target.x;
      this.physics.velocity.z = target.z;
    }
  }

  private applyFriction(rate: number, dt: number): void {
    const spd = this.physics.horizontalSpeed;
    const ns = Math.max(0, spd - rate * dt);
    if (spd > 0) {
      const k = ns / spd;
      this.physics.velocity.x *= k;
      this.physics.velocity.z *= k;
    }
  }

  // ------------------------------------------------------------- jumping

  private updateJump(dt: number): void {
    if (this.input.jumpPressed) this.jumpBuffer = CONST.jumpBufferTime;
    else if (this.jumpBuffer > 0) this.jumpBuffer -= dt;

    const canJump = this.physics.grounded || this.coyoteTimer > 0;
    if (this.jumpBuffer > 0 && canJump) {
      this.doJump();
    }
  }

  private doJump(): void {
    if (this.sliding) {
      if (!this.hasHeadroom(CONST.heightStand)) return;
      this.sliding = false;
      this.setHeight(CONST.heightStand);
    }
    this.physics.velocity.y = CONST.jumpVelocity;
    this.coyoteTimer = 0;
    this.jumpBuffer = 0;
    this.physics.grounded = false;
    this.audio?.jump();
  }

  private setGravityScale(): void {
    if (this.wallRunning) {
      this.physics.gravityScale = 0;
      return;
    }
    this.physics.gravityScale =
      this.physics.velocity.y > 0 && !this.input.jumpHeld ? CONST.jumpCutGravityScale : 1;
  }

  // ------------------------------------------------------------- sliding

  private updateSlide(dt: number): void {
    const want =
      this.input.slideHeld &&
      this.physics.grounded &&
      this.physics.horizontalSpeed > CONST.slideMinSpeed;

    if (want && !this.sliding) {
      this.sliding = true;
      this.setHeight(CONST.heightSlide);
      this.physics.velocity.x *= CONST.slideEnterBoost;
      this.physics.velocity.z *= CONST.slideEnterBoost;
      this.audio?.slide();
    }

    if (this.sliding) {
      const shouldEnd =
        !this.input.slideHeld || this.physics.horizontalSpeed < 2.5 || !this.physics.grounded;
      if (shouldEnd) {
        if (this.hasHeadroom(CONST.heightStand)) {
          this.sliding = false;
          this.setHeight(CONST.heightStand);
        }
      } else {
        const spd = this.physics.horizontalSpeed;
        const ns = Math.max(0, spd - CONST.slideDecel * dt);
        if (spd > 0) {
          const k = ns / spd;
          this.physics.velocity.x *= k;
          this.physics.velocity.z *= k;
        }
      }
    }
  }

  // ------------------------------------------------------------- wall run

  private tryStartWallRun(dt: number): void {
    if (this.physics.grounded) return;
    if (this.wallRunUsed || this.wallRunCooldown > 0) return;
    if (this.physics.horizontalSpeed < CONST.wallRunMinSpeed) return;

    const rightDir = this.right.clone();
    const leftDir = rightDir.clone().negate();
    const rightTarget = this.parkour.wallTarget(this.physics.position, rightDir, this.right);
    const leftTarget = this.parkour.wallTarget(this.physics.position, leftDir, this.right);
    const target = rightTarget ?? leftTarget;

    if (!target) return;

    this.wallRunning = true;
    this.wallRunTimer = CONST.wallRunDuration;
    this.wallRunUsed = true;
    this.wallAxis = target.axis;
    this.wallCoord = target.wallCoord;
    this.wallNormal.copy(target.normal);
    this.wallRunLean = target.lean;
    this.applyWallRunVelocity();
    this.audio?.wallRun();
  }

  private applyWallRunVelocity(): void {
    const tangentIdx = this.wallAxis === 'x' ? 2 : 0;
    const sign = this.fwd.getComponent(tangentIdx) >= 0 ? 1 : -1;
    this.physics.velocity.set(0, 0, 0);
    this.physics.velocity.setComponent(tangentIdx, sign * CONST.wallRunSpeed);
  }

  private stepWallRun(dt: number): void {
    this.wallRunTimer -= dt;

    if (this.input.jumpPressed) {
      this.wallRunJump();
      return;
    }

    const towardWall = this.wallNormal.clone().negate();
    const stillThere =
      this.world.raycast(this.physics.position, towardWall, CONST.playerRadius + 0.45) !== null;
    if (this.wallRunTimer <= 0 || !stillThere) {
      this.endWallRun();
      return;
    }

    this.applyWallRunVelocity();
  }

  private wallRunJump(): void {
    const away = this.wallNormal.clone().multiplyScalar(CONST.wallRunJumpAway);
    const fwdH = this.fwd.clone();
    this.physics.velocity.set(
      away.x + fwdH.x * 3.2,
      CONST.wallRunJumpUp,
      away.z + fwdH.z * 3.2,
    );
    this.wallRunning = false;
    this.wallRunLean = 0;
    this.wallRunCooldown = CONST.wallRunCooldown;
    this.audio?.jump();
  }

  private endWallRun(): void {
    this.wallRunning = false;
    this.wallRunLean = 0;
    this.wallRunCooldown = CONST.wallRunCooldown;
  }

  // ------------------------------------------------------------- vault

  private tryVault(): void {
    const feet = this.physics.position.clone();
    feet.y -= this.physics.half.y;
    const target = this.parkour.vaultTarget(feet, this.fwd);
    if (!target) return;

    this.vaulting = true;
    this.vaultT = 0;
    this.vaultStart.copy(this.physics.position);
    this.vaultEnd.copy(this.vaultStart).addScaledVector(this.fwd, CONST.vaultDistance);
    this.vaultArcHeight = Math.max(1.15, target.height + 0.3);
    this.vaultSpeed = Math.max(CONST.walkSpeed, this.physics.horizontalSpeed);
    this.audio?.vault();
  }

  private stepVault(dt: number): void {
    this.vaultT += dt / CONST.vaultDuration;
    const t = Math.min(1, this.vaultT);
    const x = THREE.MathUtils.lerp(this.vaultStart.x, this.vaultEnd.x, t);
    const y =
      THREE.MathUtils.lerp(this.vaultStart.y, this.vaultEnd.y, t) +
      this.vaultArcHeight * Math.sin(Math.PI * t);
    const z = THREE.MathUtils.lerp(this.vaultStart.z, this.vaultEnd.z, t);
    this.physics.position.set(x, y, z);

    if (t >= 1) {
      this.vaulting = false;
      const fh = this.fwd.clone();
      this.physics.velocity.set(fh.x * this.vaultSpeed, 0, fh.z * this.vaultSpeed);
    }
  }

  // ------------------------------------------------------------- mantle

  private tryMantle(): void {
    const feet = this.physics.position.clone();
    feet.y -= this.physics.half.y;
    const target = this.parkour.ledgeTarget(feet, this.fwd);
    if (!target) return;

    this.mantling = true;
    this.mantleT = 0;
    this.mantleStart.copy(this.physics.position);
    this.mantleEnd.copy(this.mantleStart).addScaledVector(this.fwd, 0.55);
    this.mantleEnd.y = target.top + CONST.heightStand / 2;
    this.physics.setHalfHeight(CONST.heightStand);
    this.audio?.mantle();
  }

  private stepMantle(dt: number): void {
    this.mantleT += dt / CONST.mantleDuration;
    const t = Math.min(1, this.mantleT);
    const e = t * t * (3 - 2 * t);
    this.physics.position.lerpVectors(this.mantleStart, this.mantleEnd, e);

    if (t >= 1) {
      this.mantling = false;
      this.physics.velocity.set(0, 0, 0);
    }
  }

  // ------------------------------------------------------------- helpers

  /** Change the collision height while keeping the feet on the ground. */
  private setHeight(h: number): void {
    const feet = this.physics.feetY;
    this.physics.setHalfHeight(h);
    this.physics.position.y = feet + this.physics.half.y;
  }

  private hasHeadroom(height: number): boolean {
    const feet = this.physics.feetY;
    const targetTop = feet + height;
    const dist = targetTop - this.physics.position.y;
    if (dist <= 0.02) return true;
    const hit = this.world.raycast(this.physics.position, UP, dist + 0.02);
    return hit === null;
  }

  private landingFeedback(): void {
    if (this.physics.grounded && !this.wasGrounded) {
      const fs = -this.prevFallSpeed;
      if (fs > 4) {
        this.camera.onLand(fs);
        this.audio?.land(fs);
      }
    }
    if (this.physics.grounded) this.prevFallSpeed = 0;
    else if (this.physics.velocity.y < this.prevFallSpeed) this.prevFallSpeed = this.physics.velocity.y;
    this.wasGrounded = this.physics.grounded;
  }

  private updateFootsteps(dt: number): void {
    if (this.physics.grounded && this.horizontalSpeed > 2) {
      const interval = this.horizontalSpeed > CONST.walkSpeed ? 0.27 : 0.38;
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = interval;
        this.audio?.footstep();
      }
    } else {
      this.footstepTimer = Math.min(this.footstepTimer, 0.1);
    }
  }
}
