import { PLAYER } from '../config.ts';
import type { Collider, CollisionWorld } from '../world/CollisionWorld.ts';

/** Gap left between the player and a surface after resolving a collision. */
const SKIN = 0.001;
/** How far below the feet we look for ground. */
const GROUND_PROBE = 0.045;
/** Largest drop that is snapped down to while walking (keeps the player glued to curbs / steps). */
const GROUND_SNAP = 0.2;

/**
 * The player's physical body: an axis-aligned box (feet-centred) integrated with swept,
 * axis-separated collision against the `CollisionWorld`.
 *
 * Movement is sub-stepped so a single sub-step never travels further than `PLAYER.maxSubstep`
 * (0.18 m), which is smaller than the thinnest collider - high speeds cannot tunnel.
 */
export class PlayerBody {
  /** Feet position (centre of the base of the box). */
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  height: number = PLAYER.standHeight;

  onGround = false;
  ground: Collider | null = null;

  /** Largest ledge (m) that is auto-stepped this tick. 0 disables stepping. Set by the controller. */
  stepHeight: number = PLAYER.stepHeight;

  // ---- results of the last move() call ----
  /** -1 / +1 when horizontal motion along that axis was stopped by a collider, else 0. */
  blockedX = 0;
  blockedZ = 0;
  hitCeiling = false;
  /** Downward speed at the moment of touchdown (0 when the player did not land this step). */
  landedSpeed = 0;
  /** Total height gained from auto step-ups this step (the camera smooths this). */
  steppedUp = 0;
  /** Number of times the safety depenetration had to rescue the player (diagnostics / tests). */
  rescues = 0;

  private readonly scratch: Collider[] = [];

  setPosition(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** True when a box of `height` placed at the current position overlaps nothing. */
  hasRoom(world: CollisionWorld, height: number): boolean {
    const hw = PLAYER.halfWidth;
    return (
      world.firstOverlap(this.x - hw, this.y, this.z - hw, this.x + hw, this.y + height, this.z + hw) === null
    );
  }

  /** Room check for an arbitrary feet position (used to validate scripted moves). */
  hasRoomAt(world: CollisionWorld, x: number, y: number, z: number, height: number): boolean {
    const hw = PLAYER.halfWidth;
    return world.firstOverlap(x - hw, y, z - hw, x + hw, y + height, z + hw) === null;
  }

  /** Crouch immediately, or stand if there is headroom. Returns the resulting height. */
  setHeight(world: CollisionWorld, wanted: number): number {
    if (wanted <= this.height) {
      this.height = wanted;
    } else if (this.hasRoom(world, wanted)) {
      this.height = wanted;
    }
    return this.height;
  }

  /** Advance the body by `dt` seconds with collision. */
  move(world: CollisionWorld, dt: number): void {
    this.blockedX = 0;
    this.blockedZ = 0;
    this.hitCeiling = false;
    this.landedSpeed = 0;
    this.steppedUp = 0;

    const wasGround = this.onGround;
    const dx = this.vx * dt;
    const dy = this.vy * dt;
    const dz = this.vz * dt;
    const longest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const n = Math.max(1, Math.ceil(longest / PLAYER.maxSubstep));
    const sx = dx / n;
    const sy = dy / n;
    const sz = dz / n;

    for (let i = 0; i < n; i++) {
      this.moveVertical(world, sy);
      this.moveHorizontal(world, 0, sx);
      this.moveHorizontal(world, 1, sz);
    }

    this.rescueIfStuck(world);
    this.updateGround(world, wasGround);
  }

  private moveVertical(world: CollisionWorld, d: number): void {
    if (d === 0) return;
    const hw = PLAYER.halfWidth;
    this.y += d;
    for (let iter = 0; iter < 4; iter++) {
      const c = world.firstOverlap(this.x - hw, this.y, this.z - hw, this.x + hw, this.y + this.height, this.z + hw);
      if (!c) return;
      if (d < 0) {
        // Landed on top of c.
        if (-this.vy > this.landedSpeed) this.landedSpeed = -this.vy;
        this.y = c.maxY;
        this.vy = 0;
      } else {
        // Bumped head on the underside of c.
        this.y = c.minY - this.height - SKIN;
        if (this.vy > 0) this.vy = 0;
        this.hitCeiling = true;
      }
    }
  }

  /** axis 0 = X, axis 1 = Z. */
  private moveHorizontal(world: CollisionWorld, axis: 0 | 1, d: number): void {
    if (d === 0) return;
    const hw = PLAYER.halfWidth;
    if (axis === 0) this.x += d;
    else this.z += d;

    for (let iter = 0; iter < 5; iter++) {
      const c = world.firstOverlap(this.x - hw, this.y, this.z - hw, this.x + hw, this.y + this.height, this.z + hw);
      if (!c) return;

      // Small ledge in the way? Step up onto it when there is room.
      const rise = c.maxY - this.y;
      if (this.stepHeight > 0 && rise > 0 && rise <= this.stepHeight) {
        const ny = c.maxY;
        if (
          world.firstOverlap(this.x - hw, ny, this.z - hw, this.x + hw, ny + this.height, this.z + hw) === null
        ) {
          this.y = ny;
          this.steppedUp += rise;
          if (this.vy < 0) this.vy = 0;
          continue;
        }
      }

      if (axis === 0) {
        if (d > 0) {
          this.x = c.minX - hw - SKIN;
          this.blockedX = 1;
        } else {
          this.x = c.maxX + hw + SKIN;
          this.blockedX = -1;
        }
        this.vx = 0;
      } else {
        if (d > 0) {
          this.z = c.minZ - hw - SKIN;
          this.blockedZ = 1;
        } else {
          this.z = c.maxZ + hw + SKIN;
          this.blockedZ = -1;
        }
        this.vz = 0;
      }
    }
  }

  /**
   * Last-resort safety net. Collision resolution should never leave the box inside a collider,
   * but if it ever does (spawn inside geometry, float error at a corner) push out along the
   * axis of least penetration instead of letting the player fall through the world.
   */
  private rescueIfStuck(world: CollisionWorld): void {
    const hw = PLAYER.halfWidth;
    for (let guard = 0; guard < 6; guard++) {
      const c = world.firstOverlap(this.x - hw, this.y, this.z - hw, this.x + hw, this.y + this.height, this.z + hw);
      if (!c) return;
      this.rescues++;
      const up = c.maxY - this.y;
      const left = this.x + hw - c.minX;
      const right = c.maxX - (this.x - hw);
      const back = this.z + hw - c.minZ;
      const front = c.maxZ - (this.z - hw);
      const min = Math.min(up, left, right, back, front);
      if (min === up) {
        this.y = c.maxY;
        if (this.vy < 0) this.vy = 0;
      } else if (min === left) {
        this.x = c.minX - hw - SKIN;
      } else if (min === right) {
        this.x = c.maxX + hw + SKIN;
      } else if (min === back) {
        this.z = c.minZ - hw - SKIN;
      } else {
        this.z = c.maxZ + hw + SKIN;
      }
    }
  }

  private updateGround(world: CollisionWorld, wasGround: boolean): void {
    this.onGround = false;
    this.ground = null;
    if (this.vy > 0.5) return;

    const hw = PLAYER.halfWidth;
    let c = world.firstOverlap(this.x - hw, this.y - GROUND_PROBE, this.z - hw, this.x + hw, this.y, this.z + hw);
    if (c) {
      this.snapTo(world, c);
      return;
    }

    // Walking down a small step / curb: stay glued to the floor instead of going airborne for a frame.
    if (wasGround && this.vy <= 0.01) {
      c = this.highestBelow(world, this.y - GROUND_SNAP, this.y - GROUND_PROBE);
      if (c) this.snapTo(world, c);
    }
  }

  private snapTo(world: CollisionWorld, c: Collider): void {
    // Use the highest supporting surface under the feet.
    const hw = PLAYER.halfWidth;
    const list = this.scratch;
    list.length = 0;
    world.collectOverlaps(this.x - hw, this.y - GROUND_SNAP, this.z - hw, this.x + hw, this.y, this.z + hw, list);
    let best = c;
    for (const o of list) {
      if (o.maxY <= this.y + 1e-6 && o.maxY > best.maxY) best = o;
    }
    this.y = best.maxY;
    if (this.vy < 0) this.vy = 0;
    this.onGround = true;
    this.ground = best;
  }

  private highestBelow(world: CollisionWorld, lowY: number, highY: number): Collider | null {
    const hw = PLAYER.halfWidth;
    const list = this.scratch;
    list.length = 0;
    world.collectOverlaps(this.x - hw, lowY, this.z - hw, this.x + hw, highY, this.z + hw, list);
    let best: Collider | null = null;
    for (const o of list) {
      if (o.maxY <= this.y + 1e-6 && (!best || o.maxY > best.maxY)) best = o;
    }
    return best;
  }
}
