import type { Vector3 } from 'three';
import type { Collider, CollisionWorld } from '../world/CollisionWorld';
import { MOVE } from './MovementConfig';

export interface MoveOptions {
  /** Allow climbing small steps (curbs, roof lips) while moving horizontally. */
  allowStep: boolean;
  /** Keep the player glued to the floor when walking down small steps. */
  snapToGround: boolean;
}

export interface MoveResult {
  onFloor: boolean;
  hitCeiling: boolean;
  blockedX: boolean;
  blockedZ: boolean;
  floor: Collider | null;
  /** Vertical offset caused by step-up / ground snapping (for camera smoothing). */
  stepOffset: number;
  /** Vertical speed right before touching the floor this step (positive number). */
  impactSpeed: number;
}

/**
 * Low-level kinematic body for the player: an axis-aligned box whose bottom
 * centre is the player's "feet" position.
 *
 * Movement is resolved per axis with swept tests (vertical first, then the
 * larger horizontal component, then the other), so walls stop exactly where
 * they are and fast movement cannot tunnel through anything.
 */
export class PlayerPhysics {
  readonly result: MoveResult = {
    onFloor: false,
    hitCeiling: false,
    blockedX: false,
    blockedZ: false,
    floor: null,
    stepOffset: 0,
    impactSpeed: 0,
  };

  private readonly min = [0, 0, 0];
  private readonly max = [0, 0, 0];
  private readonly altMin = [0, 0, 0];
  private readonly altMax = [0, 0, 0];
  private readonly hit: { collider: Collider | null } = { collider: null };

  constructor(readonly world: CollisionWorld) {}

  /** Writes the player box for the given feet position into min/max. */
  private setBox(min: number[], max: number[], x: number, y: number, z: number, height: number, hw: number = MOVE.HALF_WIDTH): void {
    min[0] = x - hw;
    min[1] = y;
    min[2] = z - hw;
    max[0] = x + hw;
    max[1] = y + height;
    max[2] = z + hw;
  }

  /** True if a player box of the given height fits at `pos` without overlapping anything. */
  isFree(pos: Vector3, height: number, hw: number = MOVE.HALF_WIDTH): boolean {
    this.setBox(this.min, this.max, pos.x, pos.y + 0.002, pos.z, height - 0.004, hw);
    return this.world.overlaps(this.min, this.max) === null;
  }

  /** Same as isFree but with explicit coordinates. */
  isFreeAt(x: number, y: number, z: number, height: number, hw: number = MOVE.HALF_WIDTH): boolean {
    this.setBox(this.min, this.max, x, y + 0.002, z, height - 0.004, hw);
    return this.world.overlaps(this.min, this.max) === null;
  }

  /** True if an arbitrary box is free. */
  isBoxFree(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    this.min[0] = minX;
    this.min[1] = minY;
    this.min[2] = minZ;
    this.max[0] = maxX;
    this.max[1] = maxY;
    this.max[2] = maxZ;
    return this.world.overlaps(this.min, this.max) === null;
  }

  /**
   * Moves `pos` by `vel * dt`, resolving collisions. Velocity components that
   * hit something are zeroed. Returns a shared result object.
   */
  move(pos: Vector3, vel: Vector3, dt: number, height: number, options: MoveOptions): MoveResult {
    const r = this.result;
    r.onFloor = false;
    r.hitCeiling = false;
    r.blockedX = false;
    r.blockedZ = false;
    r.floor = null;
    r.stepOffset = 0;
    r.impactSpeed = 0;

    const world = this.world;
    const min = this.min;
    const max = this.max;
    this.setBox(min, max, pos.x, pos.y, pos.z, height);

    // --- Vertical -----------------------------------------------------------
    const dy = vel.y * dt;
    if (dy !== 0) {
      const ay = world.sweepAxis(min, max, 1, dy, this.hit);
      min[1] += ay;
      max[1] += ay;
      if (Math.abs(ay - dy) > 1e-9) {
        if (dy < 0) {
          r.onFloor = true;
          r.floor = this.hit.collider;
          r.impactSpeed = -vel.y;
          vel.y = 0;
        } else {
          r.hitCeiling = true;
          vel.y = 0;
        }
      }
    }

    // --- Horizontal ---------------------------------------------------------
    const dx = vel.x * dt;
    const dz = vel.z * dt;
    if (dx !== 0 || dz !== 0) {
      const startX = min[0];
      const startZ = min[2];
      const startY = min[1];
      copy3(this.altMin, min);
      copy3(this.altMax, max);

      const flat = this.moveHorizontal(min, max, dx, dz);
      let blockedX = flat.blockedX;
      let blockedZ = flat.blockedZ;

      if (options.allowStep && (blockedX || blockedZ)) {
        // Step-up attempt: lift, move, then drop back down onto whatever is there.
        const aMin = this.altMin;
        const aMax = this.altMax;
        const up = world.sweepAxis(aMin, aMax, 1, MOVE.STEP_HEIGHT);
        aMin[1] += up;
        aMax[1] += up;
        const stepped = this.moveHorizontal(aMin, aMax, dx, dz);
        const downWanted = -(up + 0.02);
        const down = world.sweepAxis(aMin, aMax, 1, downWanted, this.hit);
        const landed = Math.abs(down - downWanted) > 1e-9;
        aMin[1] += down;
        aMax[1] += down;

        const flatDist = sq(min[0] - startX) + sq(min[2] - startZ);
        const stepDist = sq(aMin[0] - startX) + sq(aMin[2] - startZ);
        const rise = aMin[1] - startY;
        if (landed && rise > -1e-4 && stepDist > flatDist + 1e-6) {
          copy3(min, aMin);
          copy3(max, aMax);
          blockedX = stepped.blockedX;
          blockedZ = stepped.blockedZ;
          r.stepOffset = rise;
          r.onFloor = true;
          r.floor = this.hit.collider;
          if (vel.y < 0) vel.y = 0;
        }
      }

      if (blockedX) {
        vel.x = 0;
        r.blockedX = true;
      }
      if (blockedZ) {
        vel.z = 0;
        r.blockedZ = true;
      }
    }

    // --- Ground snap --------------------------------------------------------
    if (options.snapToGround && !r.onFloor && vel.y <= 0) {
      const d = world.sweepAxis(min, max, 1, -MOVE.GROUND_SNAP, this.hit);
      if (d > -MOVE.GROUND_SNAP + 1e-6) {
        min[1] += d;
        max[1] += d;
        r.onFloor = true;
        r.floor = this.hit.collider;
        r.stepOffset += d;
        vel.y = 0;
      }
    }

    pos.set((min[0] + max[0]) * 0.5, min[1], (min[2] + max[2]) * 0.5);
    return r;
  }

  private readonly hz = { blockedX: false, blockedZ: false };

  private moveHorizontal(min: number[], max: number[], dx: number, dz: number): { blockedX: boolean; blockedZ: boolean } {
    const out = this.hz;
    out.blockedX = false;
    out.blockedZ = false;
    // Larger component first: reduces corner snagging when moving diagonally.
    if (Math.abs(dx) >= Math.abs(dz)) {
      out.blockedX = this.moveAxis(min, max, 0, dx);
      out.blockedZ = this.moveAxis(min, max, 2, dz);
    } else {
      out.blockedZ = this.moveAxis(min, max, 2, dz);
      out.blockedX = this.moveAxis(min, max, 0, dx);
    }
    return out;
  }

  private moveAxis(min: number[], max: number[], axis: 0 | 2, delta: number): boolean {
    if (delta === 0) return false;
    const allowed = this.world.sweepAxis(min, max, axis, delta);
    min[axis] += allowed;
    max[axis] += allowed;
    return Math.abs(allowed - delta) > 1e-9;
  }

  /**
   * Pushes the player out of any geometry it overlaps (after height changes
   * or scripted moves). Prefers pushing upward. Returns true if the final
   * position is free.
   */
  depenetrate(pos: Vector3, height: number): boolean {
    for (let iter = 0; iter < 8; iter++) {
      this.setBox(this.min, this.max, pos.x, pos.y, pos.z, height);
      const c = this.world.overlaps(this.min, this.max);
      if (!c) return true;
      const pushUp = c.max[1] - this.min[1];
      const pushPX = c.max[0] - this.min[0];
      const pushNX = this.max[0] - c.min[0];
      const pushPZ = c.max[2] - this.min[2];
      const pushNZ = this.max[2] - c.min[2];
      // Small upward pushes win (standing on something), otherwise the shortest horizontal push.
      if (pushUp <= 0.5) {
        pos.y += pushUp + 0.001;
        continue;
      }
      const best = Math.min(pushPX, pushNX, pushPZ, pushNZ);
      if (best === pushPX) pos.x += pushPX + 0.001;
      else if (best === pushNX) pos.x -= pushNX + 0.001;
      else if (best === pushPZ) pos.z += pushPZ + 0.001;
      else pos.z -= pushNZ + 0.001;
    }
    return this.isFree(pos, height);
  }
}

function sq(v: number): number {
  return v * v;
}

function copy3(dst: number[], src: number[]): void {
  dst[0] = src[0];
  dst[1] = src[1];
  dst[2] = src[2];
}
