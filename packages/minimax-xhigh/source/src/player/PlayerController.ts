import * as THREE from 'three';
import { PLAYER } from '../game/Config';
import { Input } from '../core/Input';
import { CollisionWorld, Solid } from '../world/CollisionWorld';
import { PlayerPhysics } from './PlayerPhysics';
import { LedgeTarget, ParkourSystem, VaultTarget, WallHit } from './ParkourSystem';

interface ScriptedMove {
  kind: 'vault' | 'mantle';
  elapsed: number;
  duration: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  /** Horizontal momentum that should survive the move. */
  momentum: number;
  /** Which direction the momentum is preserved in. */
  dir: THREE.Vector3;
}

/**
 * The player controller.
 *
 * Responsibilities:
 *  - translate input into a wish direction
 *  - run the movement state machine (walk / sprint / air / slide / wall run)
 *  - drive the physics body
 *  - trigger parkour moves (vault, mantle, wall jump)
 *
 * The controller is updated in two phases:
 *  - `handleActions()` once per rendered frame (discrete actions)
 *  - `step()` at a fixed timestep (continuous simulation)
 */
export class PlayerController {
  readonly physics: PlayerPhysics;
  private parkour: ParkourSystem;

  /** View angles in radians. */
  yaw = 0;
  pitch = 0;

  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  readonly wishDir = new THREE.Vector3();

  sliding = false;
  wallSide: -1 | 0 | 1 = 0;
  wallTimer = 0;

  /** Events emitted this frame for the audio / feedback layer. */
  readonly events: string[] = [];

  private scripted: ScriptedMove | null = null;
  private slideTimer = 0;
  private wallCooldown = 0;
  private wallNormal = new THREE.Vector3();
  private wallTangent = new THREE.Vector3();
  private wallSolid!: Solid;
  private coyote = 0;
  private jumpBuffer = 0;
  private jumpCutArmed = false;
  private axisX = 0;
  private axisY = 0;
  private sprinting = false;
  private stepDistance = 0;
  private prevScriptPos = new THREE.Vector3();
  private suppressLand = false;
  private pendingSlideKick = false;

  constructor(world: CollisionWorld) {
    this.physics = new PlayerPhysics(world);
    this.parkour = new ParkourSystem(world);
  }

  // ------------------------------------------------------------------
  // Public accessors
  // ------------------------------------------------------------------

  get position(): THREE.Vector3 {
    return this.physics.position;
  }

  get velocity(): THREE.Vector3 {
    return this.physics.velocity;
  }

  get height(): number {
    return this.physics.height;
  }

  get grounded(): boolean {
    return this.physics.grounded;
  }

  get speed(): number {
    return this.physics.horizontalSpeed;
  }

  get isWallRunning(): boolean {
    return this.wallSide !== 0;
  }

  get isScripted(): boolean {
    return this.scripted !== null;
  }

  get wallRunProgress(): number {
    return Math.min(1, this.wallTimer / PLAYER.wallRunMaxTime);
  }

  /** -1 (left) .. +1 (right) strafe input, used for camera lean. */
  get strafeInput(): number {
    return this.axisX;
  }

  /** True while the player is holding forward. */
  get movingForward(): boolean {
    return this.axisY > 0.2;
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  respawn(position: THREE.Vector3, yaw: number): void {
    this.physics.reset(position);
    this.physics.grounded = true;
    this.yaw = yaw;
    this.pitch = 0;
    this.sliding = false;
    this.wallSide = 0;
    this.wallTimer = 0;
    this.wallCooldown = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCutArmed = false;
    this.scripted = null;
    this.stepDistance = 0;
    this.suppressLand = false;
    this.updateBasis();
  }

  private updateBasis(): void {
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(-this.forward.z, 0, this.forward.x);
  }

  // ------------------------------------------------------------------
  // Per frame: discrete actions
  // ------------------------------------------------------------------

  handleActions(input: Input): void {
    const phys = this.physics;
    this.updateBasis();

    const axis = input.moveAxis();
    this.axisX = axis.x;
    this.axisY = axis.y;
    this.sprinting = input.sprintHeld && axis.y > 0;

    this.wishDir
      .copy(this.forward)
      .multiplyScalar(axis.y)
      .addScaledVector(this.right, axis.x);
    if (this.wishDir.lengthSq() > 1e-6) this.wishDir.normalize();
    else this.wishDir.set(0, 0, 0);

    if (input.justPressed('Space')) this.jumpBuffer = PLAYER.jumpBufferTime;

    if (input.justReleased('Space') && this.jumpCutArmed && phys.velocity.y > 0) {
      phys.velocity.y *= PLAYER.jumpCutFactor;
      this.jumpCutArmed = false;
    }

    // ---- slide start -----------------------------------------------------
    if (!this.sliding && !this.scripted && input.crouchHeld && phys.grounded) {
      const speed = phys.horizontalSpeed;
      if (speed >= PLAYER.slideMinSpeed) {
        this.startSlide();
      } else if (speed < 1.2 && this.wishDir.lengthSq() > 0.05 && phys.blockedAhead(this.forward)) {
        // Stopped right in front of a duct or crate: the slide is kicked off
        // so the player is never stuck.
        this.startSlide();
      }
    }

    // ---- vault -----------------------------------------------------------
    if (!this.scripted && input.justPressed('KeyE')) {
      const target = this.parkour.findVaultTarget(phys.position, this.forward, this.right);
      if (target) this.startVault(target);
    }
  }

  // ------------------------------------------------------------------
  // Fixed step: continuous simulation
  // ------------------------------------------------------------------

  step(dt: number): void {
    const phys = this.physics;

    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    if (this.scripted) {
      this.updateScripted(dt);
      return;
    }

    // ---- ground / coyote -------------------------------------------------
    if (phys.grounded) {
      this.coyote = PLAYER.coyoteTime;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
    }

    // ---- jump ------------------------------------------------------------
    if (this.jumpBuffer > 0 && (phys.grounded || this.coyote > 0)) {
      this.jumpBuffer = 0;
      this.coyote = 0;
      if (this.wallSide !== 0) {
        this.wallJump();
      } else {
        phys.velocity.y = PLAYER.jumpVelocity;
        phys.grounded = false;
        this.jumpCutArmed = true;
        this.events.push('jump');
      }
    }

    // ---- wall run --------------------------------------------------------
    this.updateWallRun(dt);

    // ---- slide state -----------------------------------------------------
    this.updateSlide(dt);

    // ---- forces ----------------------------------------------------------
    this.applyMovement(dt);

    // ---- gravity ---------------------------------------------------------
    // While wall running the reduced gravity is applied by the wall run
    // physics itself, so normal gravity has to be skipped.
    if (this.wallSide === 0) {
      phys.velocity.y = Math.max(phys.velocity.y - PLAYER.gravity * dt, -PLAYER.maxFallSpeed);
    }

    // ---- integrate -------------------------------------------------------
    const vyBefore = phys.velocity.y;
    phys.move(dt);

    if (phys.justLanded) {
      if (!this.suppressLand && vyBefore < -3.5) {
        this.events.push('land');
        this.landImpact = -vyBefore;
      }
      this.suppressLand = false;
    }
    if (phys.hitCeiling && phys.velocity.y === 0) {
      // handled by the physics body; nothing else to do
    }

    // ---- ledge recovery --------------------------------------------------
    if (!phys.grounded && !this.scripted && this.wallSide === 0 && phys.velocity.y < 2.5 && this.axisY > 0.25) {
      const ledge = this.parkour.findLedge(phys.position, this.forward, this.right, phys.height);
      if (ledge) this.startMantle(ledge);
    }

    // ---- footsteps -------------------------------------------------------
    if (phys.grounded && !this.sliding) {
      this.stepDistance += phys.horizontalSpeed * dt;
      const stride = this.sprinting ? 2.35 : 1.75;
      if (this.stepDistance >= stride) {
        this.stepDistance -= stride;
        this.events.push('footstep');
      }
    } else if (this.sliding) {
      this.stepDistance = 0;
    }

    phys.wasGrounded = phys.grounded;
  }

  /** Vertical speed of the most recent landing (for camera feedback). */
  landImpact = 0;

  // ------------------------------------------------------------------
  // Movement
  // ------------------------------------------------------------------

  private applyMovement(dt: number): void {
    const phys = this.physics;
    const vel = phys.velocity;

    if (this.sliding) {
      const speed = phys.horizontalSpeed;
      if (speed > 1e-4) {
        const drop = PLAYER.slideFriction * dt;
        const ns = Math.max(0, speed - drop);
        const k = ns / speed;
        vel.x *= k;
        vel.z *= k;
      }
      // Steering while sliding rotates the momentum without adding speed.
      const sp = phys.horizontalSpeed;
      if (this.wishDir.lengthSq() > 1e-6 && sp > 0.2) {
        const dirX = vel.x / sp;
        const dirZ = vel.z / sp;
        const blend = Math.min(1, 2.4 * dt);
        let nx = dirX + (this.wishDir.x - dirX) * blend;
        let nz = dirZ + (this.wishDir.z - dirZ) * blend;
        const len = Math.hypot(nx, nz) || 1;
        nx /= len;
        nz /= len;
        vel.x = nx * sp;
        vel.z = nz * sp;
      }
      return;
    }

    if (this.wallSide !== 0) {
      this.applyWallRun(dt);
      return;
    }

    const maxSpeed = this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    if (this.wishDir.lengthSq() > 1e-6) {
      const current = vel.dot(this.wishDir);
      const add = maxSpeed - current;

      if (add > 0) {
        const accel = phys.grounded ? PLAYER.groundAccel : PLAYER.airAccel;
        vel.addScaledVector(this.wishDir, Math.min(accel * dt, add));
      } else if (current > maxSpeed) {
        // Bleed off excess speed (e.g. sprint -> walk) instead of keeping it.
        const decel = Math.min(current - maxSpeed, (phys.grounded ? PLAYER.groundAccel : PLAYER.airAccel) * 0.7 * dt);
        vel.addScaledVector(this.wishDir, -decel);
      }

      if (!phys.grounded) {
        const drag = 1 - PLAYER.airDrag * dt;
        vel.x *= drag;
        vel.z *= drag;
      }
    } else if (phys.grounded) {
      const speed = phys.horizontalSpeed;
      if (speed > 1e-4) {
        const drop = speed * PLAYER.groundFriction * dt;
        const ns = Math.max(0, speed - drop);
        const k = ns / speed;
        vel.x *= k;
        vel.z *= k;
      }
    }
  }

  // ------------------------------------------------------------------
  // Sliding
  // ------------------------------------------------------------------

  private startSlide(): void {
    this.sliding = true;
    this.slideTimer = 0;
    // If the player is barely moving the slide needs a small kick, otherwise
    // they would immediately stop dead (for example when they ran into a duct).
    this.pendingSlideKick = this.physics.horizontalSpeed < PLAYER.slideMinSpeed;
    this.events.push('slideStart');
  }

  private endSlide(): void {
    if (!this.sliding) return;
    this.sliding = false;
    this.slideTimer = 0;
    this.pendingSlideKick = false;
    this.events.push('slideEnd');
  }

  private updateSlide(dt: number): void {
    const phys = this.physics;

    if (this.sliding) {
      this.slideTimer += dt;
      const tooSlow = phys.horizontalSpeed < PLAYER.slideEndSpeed;
      const timedOut = this.slideTimer > PLAYER.slideMaxTime;
      const wantsUp = !this.slideHeld;
      if (tooSlow || timedOut || (wantsUp && phys.fits(PLAYER.height))) {
        this.endSlide();
      }
    }

    const target = this.sliding ? PLAYER.crouchHeight : PLAYER.height;
    if (phys.height !== target) {
      const maxDelta = PLAYER.slideHeightLerp * dt;
      const delta = target - phys.height;
      if (Math.abs(delta) <= maxDelta) phys.height = target;
      else phys.height += Math.sign(delta) * maxDelta;
    }

    // The body has to be fully crouched before the kick, otherwise the player
    // would simply bump into the obstacle they are trying to slide under.
    if (this.pendingSlideKick && phys.height <= PLAYER.crouchHeight + 0.01) {
      this.pendingSlideKick = false;
      const dir = this.wishDir.lengthSq() > 0.05 ? this.wishDir : this.forward;
      phys.velocity.x = dir.x * PLAYER.slideMinSpeed;
      phys.velocity.z = dir.z * PLAYER.slideMinSpeed;
    }
  }

  /** Set each frame from the input so the slide can end when the key is released. */
  slideHeld = false;

  // ------------------------------------------------------------------
  // Wall running
  // ------------------------------------------------------------------

  private updateWallRun(dt: number): void {
    const phys = this.physics;

    if (this.wallSide !== 0) {
      this.wallTimer += dt;
      const stillThere = this.parkour.wallStillPresent(
        this.wallSolid,
        phys.position,
        phys.position.y,
        phys.height,
      );
      const expired = this.wallTimer >= PLAYER.wallRunMaxTime;
      const tooSlow = phys.horizontalSpeed < 3.0;
      if (!stillThere || expired || tooSlow || phys.grounded) {
        this.exitWallRun(expired ? 'wallRunEnd' : 'wallRunEnd');
      }
      return;
    }

    if (this.wallCooldown > 0) return;
    if (phys.grounded || this.sliding) return;
    if (phys.horizontalSpeed < PLAYER.wallRunMinSpeed) return;

    const hit = this.parkour.findWall(phys.position, this.right, phys.position.y, phys.height);
    if (!hit) return;

    // Prefer a wall on the side the player is drifting towards.
    const toWall = this.wishDir.dot(hit.normal) < 0 ? hit : this.parkour.findWall(phys.position, this.right.clone().negate(), phys.position.y, phys.height);
    const chosen = toWall ?? hit;

    this.wallSide = chosen.side;
    this.wallNormal.copy(chosen.normal);
    this.wallSolid = chosen.solid;
    this.wallTimer = 0;

    // Tangent along the wall, signed to match the current travel direction.
    const tangent = new THREE.Vector3().crossVectors(this.wallNormal, new THREE.Vector3(0, 1, 0)).normalize();
    const along = phys.velocity.x * tangent.x + phys.velocity.z * tangent.z;
    if (along < 0) tangent.negate();
    this.wallTangent.copy(tangent);

    this.events.push('wallRunStart');
  }

  private applyWallRun(dt: number): void {
    const phys = this.physics;
    const vel = phys.velocity;

    const along = vel.x * this.wallTangent.x + vel.z * this.wallTangent.z;
    const sign = along >= 0 ? 1 : -1;
    const speedAlong = Math.abs(along) * (1 - PLAYER.wallRunSpeedDecay * dt);

    vel.x = this.wallTangent.x * speedAlong * sign;
    vel.z = this.wallTangent.z * speedAlong * sign;

    // Reduced gravity while attached to the wall.
    vel.y = Math.max(vel.y - PLAYER.wallRunGravity * dt, -7);

    // Hug the wall so the contact is never lost.
    vel.addScaledVector(this.wallNormal, -0.9);
  }

  private exitWallRun(event: string): void {
    if (this.wallSide === 0) return;
    this.wallSide = 0;
    this.wallTimer = 0;
    this.wallCooldown = PLAYER.wallRunCooldown;
    this.events.push(event);
  }

  private wallJump(): void {
    const phys = this.physics;
    const along = phys.velocity.x * this.wallTangent.x + phys.velocity.z * this.wallTangent.z;
    const sign = along >= 0 ? 1 : -1;
    const speedAlong = Math.abs(along);

    phys.velocity.set(
      this.wallTangent.x * speedAlong * sign * 0.92 + this.wallNormal.x * PLAYER.wallJumpSpeed,
      PLAYER.wallJumpUp,
      this.wallTangent.z * speedAlong * sign * 0.92 + this.wallNormal.z * PLAYER.wallJumpSpeed,
    );
    this.jumpCutArmed = true;
    this.exitWallRun('wallJump');
    this.events.push('jump');
  }

  // ------------------------------------------------------------------
  // Scripted parkour moves
  // ------------------------------------------------------------------

  private startVault(target: VaultTarget): void {
    const phys = this.physics;
    const p0 = phys.position.clone();
    const p2 = target.destination.clone();
    const topY = p0.y + target.top;

    // Control point: above and slightly past the obstacle.
    const mid = p0.clone().lerp(p2, 0.5);
    mid.y = topY + 0.55;

    this.scripted = {
      kind: 'vault',
      elapsed: 0,
      duration: PLAYER.vaultDuration,
      p0,
      p1: mid,
      p2,
      momentum: phys.horizontalSpeed,
      dir: this.forward.clone(),
    };
    this.prevScriptPos.copy(p0);
    this.exitWallRun('wallRunEnd');
    this.events.push('vault');
  }

  private startMantle(ledge: LedgeTarget): void {
    const phys = this.physics;
    const p0 = phys.position.clone();
    const p2 = ledge.destination.clone();

    const mid = p0.clone().lerp(p2, 0.45);
    mid.y = ledge.top + 0.55;

    this.scripted = {
      kind: 'mantle',
      elapsed: 0,
      duration: PLAYER.mantleDuration,
      p0,
      p1: mid,
      p2,
      momentum: 0,
      dir: this.forward.clone(),
    };
    this.prevScriptPos.copy(p0);
    this.exitWallRun('wallRunEnd');
    this.events.push('mantle');
  }

  private updateScripted(dt: number): void {
    const move = this.scripted!;
    const phys = this.physics;

    move.elapsed += dt;
    const t = Math.min(1, move.elapsed / move.duration);
    const e = easeInOutQuad(t);

    const it = 1 - e;
    const x = it * it * move.p0.x + 2 * it * e * move.p1.x + e * e * move.p2.x;
    const y = it * it * move.p0.y + 2 * it * e * move.p1.y + e * e * move.p2.y;
    const z = it * it * move.p0.z + 2 * it * e * move.p1.z + e * e * move.p2.z;

    phys.position.set(x, y, z);
    phys.velocity.set((x - this.prevScriptPos.x) / dt, (y - this.prevScriptPos.y) / dt, (z - this.prevScriptPos.z) / dt);

    // Never lose the momentum the player had before the move.
    const hs = Math.hypot(phys.velocity.x, phys.velocity.z);
    if (move.momentum > 0 && hs < move.momentum) {
      const k = move.momentum / Math.max(hs, 1e-4);
      phys.velocity.x *= k;
      phys.velocity.z *= k;
    }

    this.prevScriptPos.set(x, y, z);
    phys.grounded = false;

    if (t >= 1) {
      this.scripted = null;
      this.suppressLand = true;
      phys.grounded = phys.probeGround();
      phys.velocity.y = Math.min(phys.velocity.y, 0);
    }
  }

  /** Set by the game loop so slide end can react to key release. */
  setSlideHeld(v: boolean): void {
    this.slideHeld = v;
  }

  /** Queue a jump (used by the automated smoke test and the auto-jump helper). */
  requestJump(): void {
    this.jumpBuffer = PLAYER.jumpBufferTime;
  }
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
