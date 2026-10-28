import { Vector3 } from 'three';
import type { Collider, CollisionWorld } from '../world/CollisionWorld';
import type { PlayerPhysics } from './PlayerPhysics';
import { PHYSICS } from '../game/Config';

export type ParkourState = 'normal' | 'slide' | 'wallrun' | 'vault' | 'mantle';

export type ParkourEvent =
  | 'slideStart'
  | 'slideEnd'
  | 'vault'
  | 'mantle'
  | 'wallRunStart'
  | 'wallRunEnd'
  | 'wallJump'
  | 'land';

export interface ParkourContext {
  physics: PlayerPhysics;
  world: CollisionWorld;
  /** Horizontal look direction of the camera. */
  forward: Vector3;
  /** Horizontal right vector of the camera. */
  right: Vector3;
  /** Normalised horizontal movement wish, zero length when no key is pressed. */
  wish: Vector3;
  jumpPressed: boolean;
  jumpHeld: boolean;
  slidePressed: boolean;
  slideHeld: boolean;
  vaultPressed: boolean;
  sprint: boolean;
}

interface WallHit {
  collider: Collider;
  /** Unit normal pointing from the wall towards the player. */
  normal: Vector3;
  /** -1 when the wall is on the left of the player, +1 when on the right. */
  side: number;
  /** Unit vector along the wall, aligned with the current movement. */
  tangent: Vector3;
}

interface LedgeTarget {
  top: number;
  position: Vector3;
}

/**
 * All parkour verbs live here: sliding, wall running, vaulting and ledge
 * recovery. The system owns the movement state machine and writes directly
 * into the player physics.
 */
export class ParkourSystem {
  state: ParkourState = 'normal';
  /** Events produced during the last update, drained by the controller. */
  readonly events: ParkourEvent[] = [];

  /** Slide bookkeeping. */
  slideTime = 0;
  /** Height the body is currently interpolated to (stand <-> slide). */
  readonly targetHeight: { value: number } = { value: PHYSICS.standHeight };

  /** Wall run bookkeeping. */
  wallTime = 0;
  wallCooldown = 0;
  /** -1 left, +1 right, 0 when not wall running. */
  wallSide = 0;
  readonly wallNormal = new Vector3();
  wallSpeed = 0;

  private wallCollider: Collider | null = null;
  private readonly wallTangent = new Vector3(1, 0, 0);
  private wallEntrySpeed = 0;

  private vaultTime = 0;
  private vaultDuration = PHYSICS.vaultDuration;
  private readonly vaultFrom = new Vector3();
  private readonly vaultTo = new Vector3();
  private mantleTime = 0;
  private mantleDuration = PHYSICS.mantleDuration;
  private readonly mantleFrom = new Vector3();
  private readonly mantleTo = new Vector3();

  /** Height the body wants to be at right now. */
  get bodyHeight(): number {
    return this.targetHeight.value;
  }

  get busy(): boolean {
    return this.state === 'vault' || this.state === 'mantle';
  }

  reset(): void {
    this.state = 'normal';
    this.slideTime = 0;
    this.wallTime = 0;
    this.wallCooldown = 0;
    this.wallSide = 0;
    this.wallNormal.set(0, 0, 0);
    this.wallSpeed = 0;
    this.wallCollider = null;
    this.targetHeight.value = PHYSICS.standHeight;
    this.events.length = 0;
  }

  /** Called by the controller whenever the player respawns. */
  onRespawn(height = PHYSICS.standHeight): void {
    this.reset();
    this.targetHeight.value = height;
  }

  update(dt: number, ctx: ParkourContext): void {
    const { physics } = ctx;

    if (this.wallCooldown > 0) this.wallCooldown -= dt;

    switch (this.state) {
      case 'vault':
      case 'mantle':
        this.updateScriptedMove(dt, ctx);
        return;
      case 'slide':
        this.updateSlide(dt, ctx);
        return;
      case 'wallrun':
        this.updateWallRun(dt, ctx);
        return;
      default:
        break;
    }

    // --- state transitions -------------------------------------------------
    if (ctx.vaultPressed) {
      const target = this.findVaultTarget(ctx);
      if (target) {
        this.startVault(ctx, target);
        return;
      }
    }

    if (ctx.slidePressed && this.tryStartSlide(ctx)) return;

    // Automatic ledge recovery while falling towards a reachable edge.
    if (!physics.grounded && physics.velocity.y < 1.2 && ctx.wish.lengthSq() > 0.1) {
      const ledge = this.findLedgeTarget(ctx);
      if (ledge) {
        this.startMantle(ctx, ledge);
        return;
      }
    }

    // Wall running only starts from the air while moving fast.
    if (!physics.grounded && this.wallCooldown <= 0) {
      const wall = this.findWall(ctx);
      if (wall) {
        this.startWallRun(ctx, wall);
        return;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Sliding
  // -----------------------------------------------------------------------

  private tryStartSlide(ctx: ParkourContext): boolean {
    const { physics } = ctx;
    if (!physics.grounded) return false;
    const speed = Math.hypot(physics.velocity.x, physics.velocity.z);
    if (speed < PHYSICS.slideMinSpeed) return false;
    if (!physics.fitsAt(physics.position.y, PHYSICS.slideHeight)) return false;

    this.state = 'slide';
    this.slideTime = 0;
    this.targetHeight.value = PHYSICS.slideHeight;

    // A slide keeps (and slightly boosts) the momentum of the run.
    if (speed < PHYSICS.slideBoost) {
      const scale = PHYSICS.slideBoost / Math.max(speed, 0.001);
      physics.velocity.x *= scale;
      physics.velocity.z *= scale;
    }
    this.events.push('slideStart');
    return true;
  }

  private updateSlide(dt: number, ctx: ParkourContext): void {
    const { physics } = ctx;
    this.slideTime += dt;

    if (physics.grounded) {
      // Steering while sliding stays weak so the momentum survives.
      if (ctx.wish.lengthSq() > 0.01) {
        const projection = physics.velocity.x * ctx.wish.x + physics.velocity.z * ctx.wish.z;
        if (projection < PHYSICS.slideBoost) {
          const accel = PHYSICS.slideSteer * dt;
          physics.velocity.x += ctx.wish.x * accel;
          physics.velocity.z += ctx.wish.z * accel;
        }
      }

      // Friction bleeds the speed away.
      const friction = PHYSICS.slideFriction * dt;
      const current = Math.hypot(physics.velocity.x, physics.velocity.z);
      if (current > 0.001) {
        const scale = Math.max(0, current - friction) / current;
        physics.velocity.x *= scale;
        physics.velocity.z *= scale;
      }

      // A slide never gets faster than the boost it started with.
      const speed = Math.hypot(physics.velocity.x, physics.velocity.z);
      const limit = PHYSICS.slideBoost * 1.05;
      if (speed > limit && speed > 0.001) {
        const scale = limit / speed;
        physics.velocity.x *= scale;
        physics.velocity.z *= scale;
      }
    }

    const newSpeed = Math.hypot(physics.velocity.x, physics.velocity.z);

    // Jump straight out of the slide.
    if (ctx.jumpPressed) {
      this.endSlide(ctx, true);
      return;
    }

    // The slide is held until the button is released or all speed is gone.
    if (!ctx.slideHeld || newSpeed < 2.4 || this.slideTime > 6) {
      this.endSlide(ctx, false);
    }
  }

  private endSlide(ctx: ParkourContext, jumping: boolean): void {
    this.state = 'normal';
    this.slideTime = 0;
    this.targetHeight.value = PHYSICS.standHeight;
    this.events.push('slideEnd');
    if (jumping) {
      ctx.physics.velocity.y = PHYSICS.jumpVelocity;
      ctx.physics.grounded = false;
    }
  }

  // -----------------------------------------------------------------------
  // Wall running
  // -----------------------------------------------------------------------

  private findWall(ctx: ParkourContext): WallHit | null {
    const { physics, world } = ctx;
    const speed = Math.hypot(physics.velocity.x, physics.velocity.z);
    if (speed < PHYSICS.wallRunMinSpeed) return null;

    const velDir = new Vector3(physics.velocity.x, 0, physics.velocity.z).normalize();
    const feet = physics.position.y;
    const reach = PHYSICS.wallRunRange + physics.radius;

    const boxes = world.query(
      physics.position.x - reach - 0.4,
      feet - 0.5,
      physics.position.z - reach - 0.4,
      physics.position.x + reach + 0.4,
      feet + physics.height + 0.6,
      physics.position.z + reach + 0.4,
    );

    let best: WallHit | null = null;
    let bestScore = Infinity;

    for (const box of boxes) {
      // Only tall surfaces qualify - a ledge is not a wall.
      if (box.maxY < feet + 1.2) continue;
      if (box.minY > feet + 0.8) continue;
      // Thin slabs (roof edges) can never be wall run.
      if (box.maxY - box.minY < 1.6) continue;

      const dx = clampRange(physics.position.x, box.minX, box.maxX) - physics.position.x;
      const dz = clampRange(physics.position.z, box.minZ, box.maxZ) - physics.position.z;

      let nx = 0;
      let nz = 0;
      let distance = Infinity;
      if (dx !== 0 && dz !== 0) {
        // The player is diagonally off the corner: use the closer face.
        if (Math.abs(dx) < Math.abs(dz)) {
          nx = Math.sign(dx);
          distance = Math.abs(dx);
        } else {
          nz = Math.sign(dz);
          distance = Math.abs(dz);
        }
      } else if (dx !== 0) {
        nx = Math.sign(dx);
        distance = Math.abs(dx);
      } else if (dz !== 0) {
        nz = Math.sign(dz);
        distance = Math.abs(dz);
      } else {
        continue;
      }

      if (distance > reach) continue;

      // The wall has to run alongside the movement, not in front of it.
      const alignment = Math.abs(nx * velDir.x + nz * velDir.z);
      if (alignment > 0.62) continue;

      const side = nx * ctx.right.x + nz * ctx.right.z > 0 ? -1 : 1;
      const score = distance + alignment * 0.4;
      if (score >= bestScore) continue;

      const tangent = new Vector3(-nz, 0, nx);
      if (tangent.dot(velDir) < 0) tangent.negate();

      bestScore = score;
      best = {
        collider: box,
        normal: new Vector3(nx, 0, nz),
        side,
        tangent,
      };
    }
    return best;
  }

  private startWallRun(ctx: ParkourContext, wall: WallHit): void {
    const { physics } = ctx;
    this.state = 'wallrun';
    this.wallTime = 0;
    this.wallSide = wall.side;
    this.wallNormal.copy(wall.normal);
    this.wallTangent.copy(wall.tangent);
    this.wallCollider = wall.collider;
    this.wallEntrySpeed = Math.hypot(physics.velocity.x, physics.velocity.z);

    // A small upward kick buys time above the roof line.
    if (physics.velocity.y < PHYSICS.wallRunLift) {
      physics.velocity.y = PHYSICS.wallRunLift;
    }
    this.events.push('wallRunStart');
  }

  private updateWallRun(dt: number, ctx: ParkourContext): void {
    const { physics } = ctx;
    this.wallTime += dt;

    // Jump away from the wall.
    if (ctx.jumpPressed) {
      const speed = Math.max(this.wallEntrySpeed, Math.hypot(physics.velocity.x, physics.velocity.z));
      physics.velocity.x = this.wallTangent.x * speed + this.wallNormal.x * PHYSICS.wallJumpOut;
      physics.velocity.z = this.wallTangent.z * speed + this.wallNormal.z * PHYSICS.wallJumpOut;
      physics.velocity.y = PHYSICS.wallJumpUp;
      this.detachWall();
      this.events.push('wallJump');
      return;
    }

    // Reduced gravity keeps the player gliding along the wall: the vertical
    // velocity eases towards a slow sink instead of falling away.
    const sink = -0.6;
    physics.velocity.y += (sink - physics.velocity.y) * Math.min(1, dt * 4.5);
    if (physics.velocity.y < -4) physics.velocity.y = -4;

    // Keep the momentum along the wall and pull towards it.
    const tangential = physics.velocity.x * this.wallTangent.x + physics.velocity.z * this.wallTangent.z;
    const alongNormal = physics.velocity.x * this.wallNormal.x + physics.velocity.z * this.wallNormal.z;
    let vx = this.wallTangent.x * tangential + this.wallNormal.x * alongNormal;
    let vz = this.wallTangent.z * tangential + this.wallNormal.z * alongNormal;
    vx -= this.wallNormal.x * PHYSICS.wallRunStick * dt;
    vz -= this.wallNormal.z * PHYSICS.wallRunStick * dt;
    physics.velocity.x = vx;
    physics.velocity.z = vz;

    this.wallSpeed = Math.hypot(vx, vz);

    // Detach when the wall is gone, the ground is reached or the timer ends.
    const tooFar = this.wallDistance(ctx) > PHYSICS.wallRunRange + 0.75;
    const expired = this.wallTime > PHYSICS.wallRunMaxTime;
    if (tooFar || expired || physics.grounded) {
      this.detachWall();
      if (expired) {
        // Keep the momentum but drop out of the wall run.
        physics.velocity.x = this.wallTangent.x * this.wallSpeed;
        physics.velocity.z = this.wallTangent.z * this.wallSpeed;
      }
    }
  }

  private wallDistance(ctx: ParkourContext): number {
    if (!this.wallCollider) return Infinity;
    const box = this.wallCollider;
    const dx = clampRange(ctx.physics.position.x, box.minX, box.maxX) - ctx.physics.position.x;
    const dz = clampRange(ctx.physics.position.z, box.minZ, box.maxZ) - ctx.physics.position.z;
    return Math.hypot(dx, dz);
  }

  private detachWall(): void {
    this.state = 'normal';
    this.wallTime = 0;
    this.wallSide = 0;
    this.wallCooldown = PHYSICS.wallRunCooldown;
    this.wallCollider = null;
    this.events.push('wallRunEnd');
  }

  // -----------------------------------------------------------------------
  // Vaulting
  // -----------------------------------------------------------------------

  private findVaultTarget(ctx: ParkourContext): LedgeTarget | null {
    const { physics, world, forward } = ctx;
    const feet = physics.position.y;
    // Look for a waist high obstacle right in front of the player.
    const originX = physics.position.x + forward.x * 0.2;
    const originZ = physics.position.z + forward.z * 0.2;
    const hit = world.raycast(originX, feet + 0.5, originZ, forward.x, 0, forward.z, 1.3);
    if (!hit.hit || !hit.collider) return null;

    const box = hit.collider;
    const top = box.maxY - feet;
    if (top < PHYSICS.vaultMin || top > PHYSICS.vaultMax) return null;

    const alongX = Math.abs(forward.x) > Math.abs(forward.z);
    const depth = alongX ? box.maxX - box.minX : box.maxZ - box.minZ;
    if (depth > PHYSICS.vaultMaxDepth) return null;

    const landing = new Vector3(
      hit.pointX + forward.x * (depth + 0.6),
      box.maxY,
      hit.pointZ + forward.z * (depth + 0.6),
    );
    return { top: box.maxY, position: landing };
  }

  private startVault(ctx: ParkourContext, target: LedgeTarget): void {
    this.state = 'vault';
    this.vaultTime = 0;
    this.vaultDuration = PHYSICS.vaultDuration;
    this.vaultFrom.copy(ctx.physics.position);
    this.vaultTo.copy(target.position);
    ctx.physics.velocity.set(0, 0, 0);
    this.events.push('vault');
  }

  // -----------------------------------------------------------------------
  // Ledge recovery
  // -----------------------------------------------------------------------

  private findLedgeTarget(ctx: ParkourContext): LedgeTarget | null {
    const { physics, world, forward } = ctx;
    const feet = physics.position.y;

    const originX = physics.position.x + forward.x * 0.15;
    const originZ = physics.position.z + forward.z * 0.15;
    const hit = world.raycast(originX, feet + 0.55, originZ, forward.x, 0, forward.z, 0.8);
    if (!hit.hit || !hit.collider) return null;

    const box = hit.collider;
    const top = box.maxY - feet;
    if (top < PHYSICS.mantleMin || top > PHYSICS.mantleMax) return null;

    const landing = new Vector3(
      hit.pointX + forward.x * 0.75,
      box.maxY,
      hit.pointZ + forward.z * 0.75,
    );

    // There must be space to stand on top of the ledge.
    if (!physics.fitsAtPosition(landing.x, box.maxY + 0.02, landing.z, PHYSICS.standHeight)) {
      return null;
    }

    return { top: box.maxY, position: landing };
  }

  private startMantle(ctx: ParkourContext, target: LedgeTarget): void {
    this.state = 'mantle';
    this.mantleTime = 0;
    this.mantleDuration = PHYSICS.mantleDuration;
    this.mantleFrom.copy(ctx.physics.position);
    this.mantleTo.copy(target.position);
    ctx.physics.velocity.set(0, 0, 0);
    this.events.push('mantle');
  }

  private updateScriptedMove(dt: number, ctx: ParkourContext): void {
    const { physics } = ctx;
    const isVault = this.state === 'vault';
    const from = isVault ? this.vaultFrom : this.mantleFrom;
    const to = isVault ? this.vaultTo : this.mantleTo;
    const duration = isVault ? this.vaultDuration : this.mantleDuration;
    const timer = isVault ? this.vaultTime : this.mantleTime;

    const t = Math.min(1, (timer + dt) / duration);
    const s = t * t * (3 - 2 * t);
    physics.position.lerpVectors(from, to, s);
    // Small arc so the body reads as lifting over the obstacle.
    physics.position.y += Math.sin(t * Math.PI) * 0.14;

    if (isVault) this.vaultTime += dt;
    else this.mantleTime += dt;

    if (t >= 1) {
      physics.position.copy(to);
      physics.grounded = true;
      this.state = 'normal';
      if (isVault) this.vaultTime = 0;
      else this.mantleTime = 0;
    }
  }
}

function clampRange(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
