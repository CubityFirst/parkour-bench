import * as THREE from 'three';
import { PHYS } from '../core/Config';
import { clamp, damp } from '../core/MathUtil';
import { CollisionWorld, Collider } from '../world/CollisionWorld';
import { Input } from '../game/Input';
import { PhysicsBody } from './PlayerPhysics';
import { ParkourSystem, Traversal, VaultTarget } from './ParkourSystem';

export type PlayerState = 'normal' | 'slide' | 'wallrun' | 'traversal';

export interface PlayerEventHooks {
  onFootstep?: (sprinting: boolean) => void;
  onJump?: () => void;
  onLand?: (impact: number) => void;
  onSlideStart?: () => void;
  onSlideEnd?: () => void;
  onVault?: () => void;
  onMantle?: () => void;
  onWallRunStart?: () => void;
  onWallRunEnd?: () => void;
}

/**
 * The first person parkour controller.
 *
 * It owns the physics body and drives the movement state machine:
 * running -> sprinting -> jumping -> sliding -> wall running -> vaulting.
 */
export class PlayerController {
  readonly body = new PhysicsBody();
  readonly parkour = new ParkourSystem();

  state: PlayerState = 'normal';
  /** 0 = fully upright, 1 = fully crouched in a slide. */
  slideAmount = 0;
  sprinting = false;
  /** Camera yaw, written by the camera rig before every update. */
  yaw = 0;

  /** Normal of the wall that is currently being run. */
  wallNormal = new THREE.Vector3();
  /** True while a wall run is active. */
  wallRunning = false;

  /** Vault target currently in front of the player (for the HUD prompt). */
  vaultTarget: VaultTarget | null = null;

  readonly events: PlayerEventHooks = {};

  private readonly traversal = new Traversal();
  private readonly fwd = new THREE.Vector3();
  private readonly rgt = new THREE.Vector3();
  private readonly tmpWish = new THREE.Vector3();
  private readonly tmpTangent = new THREE.Vector3();
  private readonly tmpNormal = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpSaved = new THREE.Vector3();

  private coyoteTimer = 0;
  private jumpBuffer = 0;
  private jumpHeld = false;
  private jumpCut = false;
  private wallTimer = 0;
  private wallSpeed = 0;
  private wallVertical = 0;
  private wallTangent = new THREE.Vector3(1, 0, 0);
  private wallColliderId = -1;
  private wallCooldown = 0;
  private slideTimer = 0;
  private stepTimer = 0;
  private airSpeedCap = PHYS.sprintSpeed * 1.12;
  private wasGrounded = true;
  private vaultCooldown = 0;
  private traversalSavedVelocity = new THREE.Vector3();

  constructor(private readonly world: CollisionWorld) {}

  /** Teleports the player and clears all movement state. */
  respawn(position: THREE.Vector3, yaw: number): void {
    this.body.reset(position);
    this.body.settle(this.world);
    this.state = 'normal';
    this.slideAmount = 0;
    this.yaw = yaw;
    this.coyoteTimer = 0;
    this.jumpBuffer = 0;
    this.wallTimer = 0;
    this.wallCooldown = 0;
    this.wallColliderId = -1;
    this.slideTimer = 0;
    this.vaultCooldown = 0;
    this.wasGrounded = true;
    this.traversal.active = false;
    this.body.ignoreId = -1;
  }

  /** Horizontal forward direction of the camera. */
  get forward(): THREE.Vector3 {
    return this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Horizontal right direction of the camera. */
  get right(): THREE.Vector3 {
    return this.rgt.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  get speed(): number {
    return this.body.horizontalSpeed;
  }

  update(dt: number, input: Input): void {
    const fwd = this.forward;
    const right = this.right;

    let wishX = 0;
    let wishZ = 0;
    if (input.isDown('KeyW')) {
      wishX += fwd.x;
      wishZ += fwd.z;
    }
    if (input.isDown('KeyS')) {
      wishX -= fwd.x;
      wishZ -= fwd.z;
    }
    if (input.isDown('KeyD')) {
      wishX += right.x;
      wishZ += right.z;
    }
    if (input.isDown('KeyA')) {
      wishX -= right.x;
      wishZ -= right.z;
    }
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 0.0001) {
      wishX /= wishLength;
      wishZ /= wishLength;
    }
    this.tmpWish.set(wishX, 0, wishZ);
    const hasInput = wishLength > 0.0001;

    this.sprinting = hasInput && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));

    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.vaultCooldown = Math.max(0, this.vaultCooldown - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (input.wasPressed('Space')) this.jumpBuffer = PHYS.jumpBuffer;
    this.jumpHeld = input.isDown('Space');

    switch (this.state) {
      case 'traversal':
        this.updateTraversal(dt);
        break;
      case 'wallrun':
        this.updateWallRun(dt);
        break;
      case 'slide':
        this.updateSlide(dt, input);
        break;
      default:
        this.updateNormal(dt, hasInput, input);
        break;
    }

    // --- integrate -------------------------------------------------------
    const preFallSpeed = this.body.velocity.y;
    this.body.moveAndCollide(this.world, dt);

    // --- landing ---------------------------------------------------------
    const grounded = this.body.grounded;
    if (grounded && !this.wasGrounded) {
      const impact = Math.min(1, Math.abs(preFallSpeed) / 14);
      this.events.onLand?.(impact);
      if (this.state === 'wallrun') this.exitWallRun(false);
    }
    if (!grounded && this.wasGrounded && this.state !== 'traversal') {
      this.coyoteTimer = PHYS.coyoteTime;
    }
    this.wasGrounded = grounded;

    // --- wall run --------------------------------------------------------
    if (
      this.state === 'normal' &&
      !this.body.grounded &&
      this.wallCooldown <= 0 &&
      this.body.horizontalSpeed > PHYS.wallMinSpeed
    ) {
      this.tryAttachWall(fwd);
    }

    // --- footsteps -------------------------------------------------------
    if (this.body.grounded && this.state !== 'traversal') {
      const speed = this.body.horizontalSpeed;
      if (speed > 0.6) {
        this.stepTimer -= dt * (0.55 + speed * 0.075);
        if (this.stepTimer <= 0) {
          this.stepTimer = 1;
          this.events.onFootstep?.(this.sprinting);
        }
      } else {
        this.stepTimer = 0.25;
      }
    }
  }

  // ------------------------------------------------------------------
  // Normal movement
  // ------------------------------------------------------------------
  private updateNormal(dt: number, hasInput: boolean, input: Input): void {
    const v = this.body.velocity;
    const wish = this.tmpWish;
    const grounded = this.body.grounded;

    const targetSpeed = this.sprinting ? PHYS.sprintSpeed : PHYS.walkSpeed;

    if (hasInput) {
      const current = v.x * wish.x + v.z * wish.z;
      const add = targetSpeed - current;
      if (add > 0) {
        const accel = Math.min((grounded ? PHYS.groundAccel : PHYS.airAccel) * dt, add);
        v.x += wish.x * accel;
        v.z += wish.z * accel;
      }
    } else if (grounded) {
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0) {
        const drop = Math.max(speed, 1.5) * PHYS.stopFriction * dt;
        const scale = Math.max(0, speed - drop) / speed;
        v.x *= scale;
        v.z *= scale;
      }
    }

    // Speed cap: strafing must never push the runner past the sprint speed.
    const cap = PHYS.sprintSpeed * 1.12;
    if (grounded) {
      const speed = Math.hypot(v.x, v.z);
      if (speed > cap) {
        const scale = cap / speed;
        v.x *= scale;
        v.z *= scale;
      }
    } else {
      const speed = Math.hypot(v.x, v.z);
      if (speed > this.airSpeedCap) {
        const scale = this.airSpeedCap / speed;
        v.x *= scale;
        v.z *= scale;
      }
    }

    v.y -= PHYS.gravity * dt;
    if (v.y < -38) v.y = -38;

    // Jump.
    if (this.jumpBuffer > 0 && (grounded || this.coyoteTimer > 0)) {
      v.y = PHYS.jumpVelocity;
      this.body.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBuffer = 0;
      this.jumpCut = false;
      this.airSpeedCap = Math.max(PHYS.sprintSpeed * 1.12, Math.hypot(v.x, v.z));
      this.events.onJump?.();
    }

    // Variable jump height.
    if (!this.jumpHeld && !this.jumpCut && v.y > 0) {
      v.y *= PHYS.jumpCutFactor;
      this.jumpCut = true;
    }

    // Slide start.
    if (
      (input.wasPressed('ControlLeft') ||
        input.wasPressed('ControlRight') ||
        input.wasPressed('KeyC')) &&
      grounded &&
      (this.body.horizontalSpeed > PHYS.slideMinSpeed || this.body.blocked)
    ) {
      this.startSlide();
      return;
    }

    // Vault (manual, or automatic while sprinting into the obstacle).
    const vaultTarget = this.parkour.findVaultTarget(this.world, this.body, this.forward);
    this.vaultTarget = vaultTarget;
    if (
      vaultTarget &&
      this.vaultCooldown <= 0 &&
      (input.wasPressed('KeyE') ||
        (this.sprinting && this.body.blockedSpeed > 6 && this.isTouching(vaultTarget)))
    ) {
      this.startVault(vaultTarget);
      return;
    }

    // Ledge mantle (automatic while falling next to a ledge).
    if (!grounded && v.y < 0.5) {
      const mantle = this.parkour.findMantleTarget(this.world, this.body, this.forward);
      if (mantle && this.vaultCooldown <= 0) {
        this.startMantle(mantle);
      }
    }
  }

  /** True when the player body is already touching the vault obstacle. */
  private isTouching(target: VaultTarget): boolean {
    const c = target.collider;
    const p = this.body.position;
    const r = this.body.radius;
    const overlaps =
      p.x + r > c.minX - 0.08 &&
      p.x - r < c.maxX + 0.08 &&
      p.z + r > c.minZ - 0.08 &&
      p.z - r < c.maxZ + 0.08;
    return overlaps && c.maxY - p.y < PHYS.vaultMaxHeight;
  }

  // ------------------------------------------------------------------
  // Sliding
  // ------------------------------------------------------------------
  private startSlide(): void {
    this.state = 'slide';
    this.slideTimer = 0;
    this.body.height = PHYS.slideHeight;
    this.events.onSlideStart?.();
  }

  private updateSlide(dt: number, input: Input): void {
    const v = this.body.velocity;
    this.slideTimer += dt;

    // Slide friction (low, so the slide keeps the momentum).
    const speed = Math.hypot(v.x, v.z);
    if (speed > 0) {
      const drop = PHYS.slideFriction * dt;
      const scale = Math.max(0, speed - drop) / speed;
      v.x *= scale;
      v.z *= scale;
    }

    // A stopped player can still crawl out of a slide (avoids soft locks).
    const current = Math.hypot(v.x, v.z);
    if (current < 2.2 && this.tmpWish.lengthSq() > 0) {
      const wish = this.tmpWish;
      const add = Math.min(PHYS.slideCrawl, 2.4 - current);
      v.x += wish.x * add * dt;
      v.z += wish.z * add * dt;
    }

    v.y -= PHYS.gravity * dt;
    if (v.y < -38) v.y = -38;

    // Jump out of the slide.
    if (this.jumpBuffer > 0 && (this.body.grounded || this.coyoteTimer > 0)) {
      v.y = PHYS.jumpVelocity;
      this.body.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBuffer = 0;
      this.jumpCut = false;
      this.airSpeedCap = Math.max(PHYS.sprintSpeed * 1.12, Math.hypot(v.x, v.z));
      this.exitSlide();
      this.events.onJump?.();
      return;
    }

    const wantsUp = !(
      input.isDown('ControlLeft') ||
      input.isDown('ControlRight') ||
      input.isDown('KeyC')
    );
    const headroom = this.world.hasHeadroom(
      this.body.position.x,
      this.body.position.z,
      this.body.position.y,
      PHYS.standHeight,
      this.body.radius
    );

    const tooSlow = Math.hypot(v.x, v.z) < PHYS.slideExitSpeed;
    const longEnough = this.slideTimer > PHYS.slideMinDuration;

    if ((wantsUp && headroom && longEnough) || (tooSlow && longEnough)) {
      this.exitSlide();
    }
  }

  private exitSlide(): void {
    this.state = 'normal';
    this.body.height = PHYS.standHeight;
    this.events.onSlideEnd?.();
  }

  // ------------------------------------------------------------------
  // Wall running
  // ------------------------------------------------------------------
  /** Looks for a wall to attach to while airborne. */
  private tryAttachWall(fwd: THREE.Vector3): void {
    // 1. The player physically ran into a wall-run panel.
    const hit = this.body.wallHit;
    if (hit && hit.collider.wallrun) {
      if (this.startWallRun(hit.collider, fwd)) return;
    }

    // 2. A marked wall-run panel is close enough.
    const target = this.parkour.findWall(this.world, this.body, fwd, PHYS.wallAssistReach);
    if (target && this.startWallRun(target.collider, fwd)) return;
  }

  /**
   * Starts a wall run on the given collider.
   * The runnable direction is the long horizontal axis of the wall, the face
   * is the side the player is currently on.
   */
  private startWallRun(collider: Collider, fwd: THREE.Vector3): boolean {
    const pos = this.body.position;

    // Runnable direction: the long horizontal axis of the wall.
    const dx = collider.maxX - collider.minX;
    const dz = collider.maxZ - collider.minZ;
    const tangent = this.tmpTangent;
    if (dx >= dz) tangent.set(1, 0, 0);
    else tangent.set(0, 0, 1);

    const velDot = this.body.velocity.x * tangent.x + this.body.velocity.z * tangent.z;
    const fwdDot = fwd.x * tangent.x + fwd.z * tangent.z;
    let sign = 1;
    if (Math.abs(velDot) > 1) sign = Math.sign(velDot);
    else if (Math.abs(fwdDot) > 0.2) sign = Math.sign(fwdDot);
    tangent.multiplyScalar(sign);

    // Face: the horizontal side of the wall the player is closest to.
    const normal = this.tmpNormal.set(-tangent.z, 0, tangent.x);
    if (Math.abs(tangent.x) > 0.5) {
      // The wall runs along X, the face is a Z plane.
      if (pos.z < collider.minZ) {
        normal.set(0, 0, -1);
      } else if (pos.z > collider.maxZ) {
        normal.set(0, 0, 1);
      } else {
        const dMin = Math.abs(pos.z - collider.minZ);
        const dMax = Math.abs(pos.z - collider.maxZ);
        if (dMin <= dMax) normal.set(0, 0, -1);
        else normal.set(0, 0, 1);
      }
    } else {
      // The wall runs along Z, the face is an X plane.
      if (pos.x < collider.minX) {
        normal.set(-1, 0, 0);
      } else if (pos.x > collider.maxX) {
        normal.set(1, 0, 0);
      } else {
        const dMin = Math.abs(pos.x - collider.minX);
        const dMax = Math.abs(pos.x - collider.maxX);
        if (dMin <= dMax) normal.set(-1, 0, 0);
        else normal.set(1, 0, 0);
      }
    }

    // The face must be roughly perpendicular to the direction of travel.
    if (Math.abs(normal.dot(fwd)) > 0.8) return false;

    this.state = 'wallrun';
    this.wallTimer = 0;
    this.wallRunning = true;
    this.wallNormal.copy(normal);
    this.wallTangent.copy(tangent);
    this.wallColliderId = collider.id;
    this.body.ignoreId = collider.id;

    const along = Math.max(this.body.velocity.dot(tangent), PHYS.wallMinSpeedAlong);
    this.wallSpeed = along;
    this.wallVertical = clamp(this.body.velocity.y * 0.25, 0.4, 2.4);
    this.body.velocity.set(
      tangent.x * along,
      this.wallVertical,
      tangent.z * along
    );
    this.body.grounded = false;
    this.events.onWallRunStart?.();
    return true;
  }

  private updateWallRun(dt: number): void {
    const v = this.body.velocity;
    this.wallTimer += dt;

    const collider = this.world.colliders.find((c) => c.id === this.wallColliderId);
    if (!collider || this.wallTimer > PHYS.wallMaxTime) {
      this.exitWallRun(true);
      return;
    }

    const pos = this.body.position;
    const tangent = this.wallTangent;

    // The player has to stay within the span of the wall.
    if (Math.abs(tangent.x) > 0.5) {
      if (pos.x < collider.minX - 1.6 || pos.x > collider.maxX + 0.6) {
        this.exitWallRun(true);
        return;
      }
    } else {
      if (pos.z < collider.minZ - 1.6 || pos.z > collider.maxZ + 0.6) {
        this.exitWallRun(true);
        return;
      }
    }

    // Pull towards the wall surface (smoothly, so it reads as a magnet).
    const axis = Math.abs(this.wallNormal.x) > 0.5 ? 'x' : 'z';
    const limit = this.wallLimit(collider);
    const delta = clamp(limit - pos[axis], -PHYS.wallPullRate * dt, PHYS.wallPullRate * dt);
    pos[axis] += delta;

    // Move along the wall.
    this.wallSpeed = Math.max(
      PHYS.wallMinSpeedAlong,
      this.wallSpeed - PHYS.wallSpeedDecay * dt
    );
    v.x = tangent.x * this.wallSpeed;
    v.z = tangent.z * this.wallSpeed;

    // Almost weightless while running the wall.
    this.wallVertical = damp(this.wallVertical, PHYS.wallVerticalTarget, 3.2, dt);
    v.y = this.wallVertical;

    // Jump away from the wall.
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      v.y = PHYS.wallJumpUp;
      v.x += this.wallNormal.x * PHYS.wallJumpPush;
      v.z += this.wallNormal.z * PHYS.wallJumpPush;
      this.exitWallRun(true);
      this.events.onJump?.();
      return;
    }

    if (this.body.horizontalSpeed < 2.5) {
      this.exitWallRun(true);
    }
  }

  /** Coordinate the player should stick to while running the given wall. */
  private wallLimit(collider: Collider): number {
    const r = this.body.radius;
    if (Math.abs(this.wallNormal.x) > 0.5) {
      // The normal points from the wall towards the player.
      return this.wallNormal.x < 0
        ? collider.minX - r - 0.02
        : collider.maxX + r + 0.02;
    }
    return this.wallNormal.z < 0
      ? collider.minZ - r - 0.02
      : collider.maxZ + r + 0.02;
  }

  private exitWallRun(withCooldown: boolean): void {
    if (this.state !== 'wallrun') return;
    this.state = 'normal';
    this.wallRunning = false;
    this.wallColliderId = -1;
    this.body.ignoreId = -1;
    if (withCooldown) this.wallCooldown = PHYS.wallCooldown;
    this.events.onWallRunEnd?.();
  }

  // ------------------------------------------------------------------
  // Vault / mantle
  // ------------------------------------------------------------------
  private startVault(target: VaultTarget): void {
    const p = this.body.position;
    const dir = target.dir.clone().setY(0).normalize();
    const c = target.collider;

    const end = new THREE.Vector3();
    if (Math.abs(dir.x) >= Math.abs(dir.z)) {
      end.x = (dir.x > 0 ? c.maxX : c.minX) + dir.x * 0.5;
      end.z = clamp(p.z, c.minZ - 1.2, c.maxZ + 1.2);
    } else {
      end.z = (dir.z > 0 ? c.maxZ : c.minZ) + dir.z * 0.5;
      end.x = clamp(p.x, c.minX - 1.2, c.maxX + 1.2);
    }

    const ground = this.world.groundHeightAt(end.x, end.z, p.y + 0.05);
    end.y = ground > -Infinity ? ground : p.y;

    if (
      this.world.isBlocked(
        end.x - this.body.radius,
        end.y + 0.05,
        end.z - this.body.radius,
        end.x + this.body.radius,
        end.y + PHYS.standHeight,
        end.z + this.body.radius
      )
    ) {
      return;
    }

    this.tmpSaved.set(this.body.velocity.x, 0, this.body.velocity.z);
    // If the player ran into the obstacle the velocity is already zero, so the
    // momentum is restored from the speed they arrived with.
    if (this.tmpSaved.length() < 1 && this.body.blockedSpeed > 1.5) {
      this.tmpSaved.set(dir.x * this.body.blockedSpeed, 0, dir.z * this.body.blockedSpeed);
    }
    this.traversalSavedVelocity.copy(this.tmpSaved);
    this.state = 'traversal';
    this.vaultCooldown = 0.2;
    this.traversal.begin(
      'vault',
      p.clone(),
      end,
      target.top + 0.06,
      dir,
      PHYS.vaultDuration
    );
    this.events.onVault?.();
  }

  private startMantle(target: VaultTarget): void {
    const p = this.body.position;
    const dir = target.dir.clone().setY(0).normalize();
    const c = target.collider;

    // Pull up onto the nearest point of the ledge.
    const nx = clamp(p.x, c.minX, c.maxX);
    const nz = clamp(p.z, c.minZ, c.maxZ);
    const end = new THREE.Vector3(nx + dir.x * 0.55, c.maxY, nz + dir.z * 0.55);

    if (
      !this.world.hasHeadroom(end.x, end.z, end.y, PHYS.standHeight, this.body.radius * 0.85)
    ) {
      return;
    }

    this.tmpSaved.set(this.body.velocity.x, 0, this.body.velocity.z);
    this.traversalSavedVelocity.copy(this.tmpSaved);
    this.state = 'traversal';
    this.vaultCooldown = 0.25;
    this.traversal.begin(
      'mantle',
      p.clone(),
      end,
      c.maxY + 0.02,
      dir,
      PHYS.mantleDuration
    );
    this.events.onMantle?.();
  }

  private updateTraversal(dt: number): void {
    const done = this.traversal.update(dt, this.tmpVec);
    this.body.position.copy(this.tmpVec);
    this.body.velocity.set(0, -1.5, 0);

    if (done) {
      const saved = this.traversalSavedVelocity;
      this.body.velocity.set(saved.x * 0.96, -1.5, saved.z * 0.96);
      this.state = 'normal';
    }
  }
}
