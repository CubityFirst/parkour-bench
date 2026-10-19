import { Input } from '../input/Input';
import { CollisionWorld } from '../world/CollisionWorld';
import { ClimbTarget, findMantleTarget, findVaultTarget, findWallContact, WallContact } from './ParkourSystem';
import {
  Body,
  createBody,
  isBodyFree,
  moveHorizontal,
  moveVertical,
  STAND_HEIGHT,
  SLIDE_HEIGHT,
  updateGrounded,
} from './PlayerPhysics';

/**
 * All movement tuning in one place. Jump apex with these values is about 1.5 m,
 * and a sprint jump covers roughly 7 m on flat ground, so the level's gaps are sized to match.
 */
export const TUNING = {
  gravity: 30,
  fallGravityMultiplier: 1.3,
  terminalVelocity: 42,
  jumpSpeed: 9.4,
  /** Velocity multiplier applied when Space is released early (variable jump height). */
  jumpCutFactor: 0.55,
  walkSpeed: 7,
  sprintSpeed: 11.5,
  groundAccel: 45,
  groundDecel: 14,
  airAccel: 6,
  airWishSpeed: 9,
  slideMinSpeed: 6.5,
  slideMaxTime: 1.1,
  slideFriction: 0.6,
  slideFlatDecel: 2,
  slideEndSpeed: 2.5,
  coyoteTime: 0.12,
  jumpBufferTime: 0.12,
  wallRunMinSpeed: 7,
  wallRunMaxTime: 1.6,
  wallRunGravityScale: 0.25,
  wallRunFallSpeed: -0.6,
  wallRunDecay: 0.3,
  wallRunLatchVy: 0.6,
  wallRunStick: 1.5,
  wallJumpPush: 6,
  wallJumpSpeed: 8.6,
  vaultTime: 0.5,
  mantleTime: 0.55,
  /** Falls shorter than this produce no landing feedback. */
  landingMinSpeed: 4,
  /** Falls at or beyond this produce the strongest landing feedback. */
  hardLandSpeed: 14,
  /** Minimum horizontal speed kept after a climb so the player keeps moving forward. */
  climbMinExitSpeed: 6,
};

export type MoveState = 'normal' | 'slide' | 'wallrun' | 'climb';

/** Optional callbacks so audio and camera can react to movement without the controller knowing about them. */
export interface PlayerEvents {
  onJump?: () => void;
  onWallJump?: () => void;
  onLand?: (strength: number) => void;
  onSlideStart?: () => void;
  onWallRunStart?: (side: 1 | -1) => void;
  onClimb?: (kind: 'vault' | 'mantle') => void;
  onFootstep?: (sprinting: boolean) => void;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface WishDirection {
  x: number;
  z: number;
  active: boolean;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smoothstep = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Momentum-based first-person movement. Fixed-step: call `step` with a constant dt.
 *
 * Yaw convention: yaw 0 faces -Z; positive yaw turns left. Forward is (-sin, -cos), right is (cos, -sin).
 */
export class PlayerController {
  readonly body: Body;
  state: MoveState = 'normal';
  yaw: number;
  pitch = 0;

  private readonly world: CollisionWorld;
  private readonly events: PlayerEvents;

  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumping = false;
  private jumpCutDone = false;
  private peakFall = 0;
  private wasGrounded = false;
  private stepDistance = 0;

  private slideTime = 0;

  private wall: WallContact | null = null;
  private wallTangentX = 0;
  private wallTangentZ = 0;
  private wallSpeed = 0;
  private wallRunTime = 0;
  /** Id of the wall most recently latched. Cannot be latched again until the player lands. */
  private wallUsedId = -1;

  private climbTarget: ClimbTarget | null = null;
  private climbFromX = 0;
  private climbFromY = 0;
  private climbFromZ = 0;
  private climbTime = 0;
  private climbDuration = 0;
  private climbSavedVx = 0;
  private climbSavedVz = 0;

  constructor(world: CollisionWorld, spawn: SpawnPoint, events: PlayerEvents = {}) {
    this.world = world;
    this.events = events;
    this.body = createBody(spawn.x, spawn.y, spawn.z);
    this.yaw = spawn.yaw;
  }

  get forwardX(): number {
    return -Math.sin(this.yaw);
  }
  get forwardZ(): number {
    return -Math.cos(this.yaw);
  }
  get rightX(): number {
    return Math.cos(this.yaw);
  }
  get rightZ(): number {
    return -Math.sin(this.yaw);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.body.vx, this.body.vz);
  }

  /** Eye height above the feet, scaled with the collision height so sliding lowers the camera. */
  get eyeHeight(): number {
    return (1.6 * this.body.height) / STAND_HEIGHT;
  }

  /** Side of the wall being run along: +1 right, -1 left, 0 when not wall-running. */
  get wallSide(): 1 | -1 | 0 {
    return this.state === 'wallrun' && this.wall ? this.wall.side : 0;
  }

  /** 0..1 progress through the current vault or mantle, or -1 when not climbing. */
  get climbProgress(): number {
    if (this.state !== 'climb') return -1;
    return clamp01(this.climbTime / this.climbDuration);
  }

  get climbKind(): 'vault' | 'mantle' | null {
    return this.state === 'climb' && this.climbTarget ? this.climbTarget.kind : null;
  }

  /** Applies mouse movement to yaw and pitch. Called every rendered frame. */
  applyLook(dx: number, dy: number, sensitivity: number): void {
    const k = 0.0022 * sensitivity;
    this.yaw -= dx * k;
    this.pitch = Math.min(1.5, Math.max(-1.5, this.pitch - dy * k));
  }

  /** Puts the player back at a spawn point and clears all movement state. */
  respawn(spawn: SpawnPoint): void {
    const body = this.body;
    body.x = spawn.x;
    body.y = spawn.y;
    body.z = spawn.z;
    body.vx = 0;
    body.vy = 0;
    body.vz = 0;
    body.height = STAND_HEIGHT;
    body.grounded = false;
    body.groundId = -1;
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.state = 'normal';
    this.wall = null;
    this.climbTarget = null;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.jumping = false;
    this.jumpCutDone = false;
    this.peakFall = 0;
    this.wasGrounded = false;
    this.wallUsedId = -1;
    this.stepDistance = 0;
  }

  /** Advances the simulation by one fixed step. */
  step(dt: number, input: Input): void {
    updateGrounded(this.world, this.body);
    this.updateGroundState();

    this.coyoteTimer = this.body.grounded ? TUNING.coyoteTime : this.coyoteTimer - dt;
    this.jumpBufferTimer = input.wasPressed('Space') ? TUNING.jumpBufferTime : this.jumpBufferTimer - dt;

    if (this.state === 'climb') {
      this.stepClimb(dt);
      return;
    }

    const wish = this.readWish(input);
    switch (this.state) {
      case 'wallrun':
        this.stepWallRun(dt, input, wish);
        break;
      case 'slide':
        this.stepSlide(dt, input);
        break;
      default:
        this.stepNormal(dt, input, wish);
    }
  }

  // ---------------------------------------------------------------- input

  private readWish(input: Input): WishDirection {
    const forwardIn = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const rightIn = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const x = this.forwardX * forwardIn + this.rightX * rightIn;
    const z = this.forwardZ * forwardIn + this.rightZ * rightIn;
    const len = Math.hypot(x, z);
    if (len < 1e-6) return { x: 0, z: 0, active: false };
    return { x: x / len, z: z / len, active: true };
  }

  // ---------------------------------------------------------------- states

  private stepNormal(dt: number, input: Input, wish: WishDirection): void {
    const body = this.body;
    const grounded = body.grounded;
    const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');

    if (grounded && input.slideDown && this.horizontalSpeed > TUNING.slideMinSpeed) {
      this.beginSlide();
      this.stepSlide(dt, input);
      return;
    }

    if (this.jumpBufferTimer > 0 && (grounded || this.coyoteTimer > 0)) {
      this.doJump();
    }

    if (!grounded) {
      if (this.tryMantle(wish)) return;
      this.tryWallRun();
    }

    if (input.wasPressed('KeyE') && this.tryVault(wish)) return;

    if (grounded) {
      if (wish.active) {
        // Speed above the target is kept (momentum), so the target only limits acceleration.
        const target = sprint ? TUNING.sprintSpeed : TUNING.walkSpeed;
        this.accelerate(wish.x, wish.z, target, TUNING.groundAccel, dt);
      } else {
        this.applyFriction(TUNING.groundDecel, dt);
      }
    } else if (wish.active) {
      // Limited air control: steer toward the wish direction without killing carried speed.
      this.accelerate(wish.x, wish.z, TUNING.airWishSpeed, TUNING.airAccel, dt);
    }

    this.applyJumpCut(input);
    this.integrate(dt, 1);
    this.updateFootsteps(dt, sprint);
  }

  private beginSlide(): void {
    this.state = 'slide';
    this.slideTime = 0;
    this.body.height = SLIDE_HEIGHT;
    this.events.onSlideStart?.();
  }

  private stepSlide(dt: number, input: Input): void {
    const body = this.body;
    this.slideTime += dt;

    // Friction bleeds speed gradually; the initial momentum carries the slide.
    const speed = this.horizontalSpeed;
    if (speed > 0) {
      const newSpeed = Math.max(0, speed - (TUNING.slideFriction * speed + TUNING.slideFlatDecel) * dt);
      const scale = newSpeed / speed;
      body.vx *= scale;
      body.vz *= scale;
    }

    if (this.jumpBufferTimer > 0 && (body.grounded || this.coyoteTimer > 0)) {
      // Jump out of the slide. If there's no headroom the body stays crouched and hops.
      this.state = 'normal';
      this.doJump();
      this.integrate(dt, 1);
      return;
    }

    const finished = this.horizontalSpeed < TUNING.slideEndSpeed || this.slideTime > TUNING.slideMaxTime;
    if (finished || !body.grounded) {
      this.state = 'normal';
    }
    this.applyJumpCut(input);
    this.integrate(dt, 1);
  }

  private stepWallRun(dt: number, input: Input, wish: WishDirection): void {
    const body = this.body;
    const wall = this.wall;
    if (!wall) {
      this.state = 'normal';
      this.stepNormal(dt, input, wish);
      return;
    }
    this.wallRunTime += dt;

    if (body.grounded) {
      this.endWallRun();
      this.stepNormal(dt, input, wish);
      return;
    }

    if (this.jumpBufferTimer > 0) {
      // Wall jump: push away from the wall and keep some of the run's speed.
      body.vx = wall.normalX * TUNING.wallJumpPush + this.wallTangentX * this.wallSpeed * 0.5;
      body.vz = wall.normalZ * TUNING.wallJumpPush + this.wallTangentZ * this.wallSpeed * 0.5;
      body.vy = TUNING.wallJumpSpeed;
      this.endWallRun();
      this.jumpBufferTimer = 0;
      this.jumping = true;
      this.jumpCutDone = false;
      this.events.onWallJump?.();
      this.integrate(dt, 1);
      return;
    }

    const contact = findWallContact(this.world, body, this.rightX, this.rightZ, wall.side);
    const stillOnWall = contact !== null && contact.box.id === wall.box.id;
    if (!stillOnWall || this.wallRunTime > TUNING.wallRunMaxTime) {
      this.endWallRun();
      this.stepNormal(dt, input, wish);
      return;
    }

    // Run along the wall, keep pressed against it, and lose height only slowly.
    this.wallSpeed *= 1 - TUNING.wallRunDecay * dt;
    body.vx = this.wallTangentX * this.wallSpeed - wall.normalX * TUNING.wallRunStick;
    body.vz = this.wallTangentZ * this.wallSpeed - wall.normalZ * TUNING.wallRunStick;
    body.vy = Math.max(body.vy - TUNING.gravity * TUNING.wallRunGravityScale * dt, TUNING.wallRunFallSpeed);
    this.integrate(dt, 0);
  }

  private endWallRun(): void {
    this.state = 'normal';
    this.wall = null;
  }

  private tryWallRun(): void {
    const body = this.body;
    const speed = this.horizontalSpeed;
    if (speed < TUNING.wallRunMinSpeed || body.vy < -14) return;

    const preferSide: 1 | -1 = body.vx * this.rightX + body.vz * this.rightZ >= 0 ? 1 : -1;
    const contact = findWallContact(this.world, body, this.rightX, this.rightZ, preferSide);
    if (!contact || contact.box.id === this.wallUsedId) return;

    // Tangent to the wall (up x normal), flipped to match the direction of travel.
    let tx = contact.normalZ;
    let tz = -contact.normalX;
    const alignment = (body.vx * tx + body.vz * tz) / speed;
    if (Math.abs(alignment) < 0.5) return;
    if (alignment < 0) {
      tx = -tx;
      tz = -tz;
    }

    this.wall = contact;
    this.wallTangentX = tx;
    this.wallTangentZ = tz;
    this.wallSpeed = Math.max(speed, TUNING.wallRunMinSpeed);
    this.wallRunTime = 0;
    this.wallUsedId = contact.box.id;
    this.state = 'wallrun';
    body.vy = Math.min(body.vy, TUNING.wallRunLatchVy);
    this.events.onWallRunStart?.(contact.side);
  }

  private tryMantle(wish: WishDirection): boolean {
    if (!wish.active || this.body.vy > 3) return false;
    const target = findMantleTarget(this.world, this.body, wish.x, wish.z);
    if (!target) return false;
    this.startClimb(target);
    return true;
  }

  private tryVault(wish: WishDirection): boolean {
    const dirX = wish.active ? wish.x : this.forwardX;
    const dirZ = wish.active ? wish.z : this.forwardZ;
    const target = findVaultTarget(this.world, this.body, dirX, dirZ);
    if (!target) return false;
    this.startClimb(target);
    return true;
  }

  private startClimb(target: ClimbTarget): void {
    const body = this.body;
    this.climbTarget = target;
    this.climbFromX = body.x;
    this.climbFromY = body.y;
    this.climbFromZ = body.z;
    this.climbTime = 0;
    this.climbDuration = target.kind === 'vault' ? TUNING.vaultTime : TUNING.mantleTime;
    this.climbSavedVx = body.vx;
    this.climbSavedVz = body.vz;
    body.vy = 0;
    body.height = STAND_HEIGHT;
    this.wall = null;
    this.jumping = false;
    this.state = 'climb';
    this.events.onClimb?.(target.kind);
  }

  /**
   * Kinematic climb: the target was already checked for clearance, so the body is placed
   * along a path that rises first and then moves forward, to avoid clipping the obstacle.
   */
  private stepClimb(dt: number): void {
    const body = this.body;
    const target = this.climbTarget;
    if (!target) {
      this.state = 'normal';
      return;
    }

    this.climbTime += dt;
    const t = clamp01(this.climbTime / this.climbDuration);

    if (target.kind === 'vault') {
      // Rise over the obstacle, travel across it, then drop to the landing.
      const xT = smoothstep(clamp01((t - 0.2) / 0.6));
      const yT = t < 0.3 ? smoothstep(t / 0.3) : smoothstep(clamp01((t - 0.6) / 0.4));
      body.x = lerp(this.climbFromX, target.x, xT);
      body.z = lerp(this.climbFromZ, target.z, xT);
      body.y = t < 0.3 ? lerp(this.climbFromY, target.peakY, yT) : t < 0.6 ? target.peakY : lerp(target.peakY, target.y, yT);
    } else {
      // Mantle: lift beside the ledge face first, then pull forward onto the top.
      const yT = smoothstep(clamp01(t / 0.6));
      const xT = smoothstep(clamp01((t - 0.4) / 0.6));
      body.y = lerp(this.climbFromY, target.y, yT);
      body.x = lerp(this.climbFromX, target.x, xT);
      body.z = lerp(this.climbFromZ, target.z, xT);
    }

    if (t >= 1) {
      body.x = target.x;
      body.y = target.y;
      body.z = target.z;
      // Keep the momentum the player had going in, with a minimum so the exit never stalls.
      const savedSpeed = Math.hypot(this.climbSavedVx, this.climbSavedVz);
      if (savedSpeed >= TUNING.climbMinExitSpeed) {
        body.vx = this.climbSavedVx;
        body.vz = this.climbSavedVz;
      } else {
        body.vx = this.forwardX * TUNING.climbMinExitSpeed;
        body.vz = this.forwardZ * TUNING.climbMinExitSpeed;
      }
      body.vy = 0;
      this.climbTarget = null;
      this.state = 'normal';
      updateGrounded(this.world, body);
    }
  }

  // ---------------------------------------------------------------- physics helpers

  private doJump(): void {
    const body = this.body;
    body.vy = TUNING.jumpSpeed;
    body.grounded = false;
    body.groundId = -1;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.jumping = true;
    this.jumpCutDone = false;
    this.events.onJump?.();
  }

  /** Variable jump height: releasing Space early cuts the rising velocity once. */
  private applyJumpCut(input: Input): void {
    if (this.jumping && !this.jumpCutDone && this.body.vy > 0 && !input.jumpHeld) {
      this.body.vy *= TUNING.jumpCutFactor;
      this.jumpCutDone = true;
    }
  }

  /** Quake-style acceleration: adds speed along the wish direction up to `wishSpeed`, never removing speed. */
  private accelerate(dirX: number, dirZ: number, wishSpeed: number, rate: number, dt: number): void {
    const body = this.body;
    const current = body.vx * dirX + body.vz * dirZ;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const inc = Math.min(rate * dt, add);
    body.vx += dirX * inc;
    body.vz += dirZ * inc;
  }

  private applyFriction(decel: number, dt: number): void {
    const body = this.body;
    const speed = this.horizontalSpeed;
    if (speed <= 0) return;
    const scale = Math.max(0, speed - decel * dt) / speed;
    body.vx *= scale;
    body.vz *= scale;
  }

  /**
   * Applies gravity (unless `gravityScale` is 0), moves the body with collision,
   * and refreshes the grounded state.
   */
  private integrate(dt: number, gravityScale: number): void {
    const body = this.body;
    if (!body.grounded) {
      if (body.vy < 0) this.peakFall = Math.max(this.peakFall, -body.vy);
      const multiplier = body.vy < 0 ? TUNING.fallGravityMultiplier : 1;
      body.vy -= TUNING.gravity * multiplier * gravityScale * dt;
      body.vy = Math.max(body.vy, -TUNING.terminalVelocity);
    }

    const horizontal = moveHorizontal(this.world, body, body.vx * dt, body.vz * dt);
    if (horizontal.blockedX) body.vx = 0;
    if (horizontal.blockedZ) body.vz = 0;

    const vertical = moveVertical(this.world, body, body.vy * dt);
    if (vertical.hitCeiling) body.vy = 0;

    updateGrounded(this.world, body);
    if (body.grounded && body.vy < 0) body.vy = 0;

    // Stand back up once the headroom is clear (the slide state keeps the crouch).
    if (this.state !== 'slide' && body.height < STAND_HEIGHT && isBodyFree(this.world, body.x, body.y, body.z, STAND_HEIGHT)) {
      body.height = STAND_HEIGHT;
    }
  }

  /** Detects landings and resets per-ground state. Landing feedback scales with the fall speed. */
  private updateGroundState(): void {
    const body = this.body;
    if (!body.grounded) {
      this.wasGrounded = false;
      return;
    }

    if (!this.wasGrounded) {
      const strength = clamp01((this.peakFall - TUNING.landingMinSpeed) / (TUNING.hardLandSpeed - TUNING.landingMinSpeed));
      if (this.peakFall > 2) this.events.onLand?.(strength);
      if (strength > 0) {
        // Controlled friction on hard landings: bleed a little speed without stopping the player.
        const keep = 1 - 0.25 * strength;
        body.vx *= keep;
        body.vz *= keep;
      }
      this.jumping = false;
      this.peakFall = 0;
    }
    this.wasGrounded = true;
    this.wallUsedId = -1;
  }

  private updateFootsteps(dt: number, sprinting: boolean): void {
    if (!this.body.grounded || this.horizontalSpeed < 1.5) {
      this.stepDistance = 0;
      return;
    }
    this.stepDistance += this.horizontalSpeed * dt;
    const stride = sprinting ? 2.4 : 1.9;
    if (this.stepDistance >= stride) {
      this.stepDistance -= stride;
      this.events.onFootstep?.(sprinting);
    }
  }
}
