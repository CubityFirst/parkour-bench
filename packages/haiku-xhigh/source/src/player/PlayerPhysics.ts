import { BoxCollider, CollisionWorld, EPS, Vec3, overlapsBox } from '../world/CollisionWorld';

/** Half width of the player's box body (metres). */
export const PLAYER_RADIUS = 0.32;
export const STAND_HEIGHT = 1.8;
export const SLIDE_HEIGHT = 0.9;

/** How far below the feet we look for support. */
const GROUND_PROBE = 0.08;

type Axis = 'x' | 'y' | 'z';
const OTHER_AXES: Record<Axis, [Axis, Axis]> = {
  x: ['y', 'z'],
  y: ['x', 'z'],
  z: ['x', 'y'],
};

/** The horizontal collider that stopped the player during the last integration step. */
export interface HorizontalHit {
  box: BoxCollider;
  axis: 'x' | 'z';
  /** Direction the player was moving when it hit (+1 or -1). */
  dir: 1 | -1;
}

/**
 * Box-body physics with exact per-axis swept collision.
 *
 * Movement is resolved one axis at a time (X, Z, then Y). Each axis sweep
 * is computed analytically against every collider, so fast motion cannot
 * tunnel through thin geometry regardless of frame rate.
 */
export class PlayerPhysics {
  /** Feet centre of the body. */
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  /** Position at the start of the most recent fixed step, used for render interpolation. */
  readonly previous: Vec3 = { x: 0, y: 0, z: 0 };
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  height = STAND_HEIGHT;
  grounded = false;
  /** Horizontal collider that stopped movement in the last step, if any. */
  horizontalHit: HorizontalHit | null = null;
  /** Downward speed at the moment of the most recent landing. */
  impactSpeed = 0;
  /** When true the body is moved by script (vault/mantle) and ignores collision. */
  kinematic = false;

  constructor(private readonly world: CollisionWorld) {}

  reset(x: number, y: number, z: number): void {
    this.position.x = this.previous.x = x;
    this.position.y = this.previous.y = y;
    this.position.z = this.previous.z = z;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.height = STAND_HEIGHT;
    this.grounded = false;
    this.horizontalHit = null;
    this.impactSpeed = 0;
    this.kinematic = false;
  }

  /** Call once at the start of every fixed step, before the controller runs. */
  snapshotPrevious(): void {
    this.previous.x = this.position.x;
    this.previous.y = this.position.y;
    this.previous.z = this.position.z;
  }

  /** Advances the body by its velocity over dt, resolving collisions. */
  integrate(dt: number): void {
    this.horizontalHit = null;
    this.impactSpeed = 0;

    if (this.kinematic) {
      this.position.x += this.velocity.x * dt;
      this.position.y += this.velocity.y * dt;
      this.position.z += this.velocity.z * dt;
      this.grounded = false;
      return;
    }

    const v = this.velocity;
    const hitX = this.sweep('x', v.x * dt);
    if (hitX) {
      v.x = 0;
    }
    const hitZ = this.sweep('z', v.z * dt);
    if (hitZ) {
      v.z = 0;
    }

    const verticalStart = v.y;
    const hitY = this.sweep('y', verticalStart * dt);
    if (hitY) {
      v.y = 0;
    }

    if (hitY && verticalStart < 0) {
      this.grounded = true;
      this.impactSpeed = -verticalStart;
    } else if (hitY) {
      // Bumped a ceiling.
      this.grounded = false;
    } else {
      this.grounded = verticalStart <= 0 && this.hasSupport();
    }
  }

  /** True if the body would fit at the given feet position with the given height. */
  fits(x: number, y: number, z: number, height: number): boolean {
    const min = { x: x - PLAYER_RADIUS, y, z: z - PLAYER_RADIUS };
    const max = { x: x + PLAYER_RADIUS, y: y + height, z: z + PLAYER_RADIUS };
    return !this.world.overlaps(min, max);
  }

  /** Changes the body height if there is headroom. Shrinking always succeeds. */
  trySetHeight(target: number): boolean {
    if (target <= this.height) {
      this.height = target;
      return true;
    }
    if (this.fits(this.position.x, this.position.y, this.position.z, target)) {
      this.height = target;
      return true;
    }
    return false;
  }

  bodyMin(): Vec3 {
    return { x: this.position.x - PLAYER_RADIUS, y: this.position.y, z: this.position.z - PLAYER_RADIUS };
  }

  bodyMax(): Vec3 {
    return {
      x: this.position.x + PLAYER_RADIUS,
      y: this.position.y + this.height,
      z: this.position.z + PLAYER_RADIUS,
    };
  }

  /** Moves the body along one axis, stopping at the first collider on the way. */
  private sweep(axis: Axis, delta: number): boolean {
    if (delta === 0) return false;

    const dir = delta > 0 ? 1 : -1;
    let travel = Math.abs(delta);
    const [a1, a2] = OTHER_AXES[axis];
    const lo = this.bodyMin();
    const hi = this.bodyMax();
    let hitBox: BoxCollider | null = null;

    for (const b of this.world.boxes) {
      // Only colliders that overlap the body on the two other axes can block this sweep.
      if (!(lo[a1] < b.max[a1] - EPS && hi[a1] > b.min[a1] + EPS)) continue;
      if (!(lo[a2] < b.max[a2] - EPS && hi[a2] > b.min[a2] + EPS)) continue;

      const gap = dir > 0 ? b.min[axis] - hi[axis] : lo[axis] - b.max[axis];
      // Already overlapping on this axis (e.g. grazing a box), so it is not a blocker.
      if (gap < -EPS) continue;
      if (gap < travel) {
        travel = Math.max(0, gap);
        hitBox = b;
      }
    }

    this.position[axis] += dir * travel;

    if (hitBox && (axis === 'x' || axis === 'z')) {
      this.horizontalHit = { box: hitBox, axis, dir };
    }
    return hitBox !== null;
  }

  /** Whether a surface sits within GROUND_PROBE below the feet, under the body footprint. */
  private hasSupport(): boolean {
    const p = this.position;
    const min = { x: p.x - PLAYER_RADIUS, y: p.y - GROUND_PROBE, z: p.z - PLAYER_RADIUS };
    const max = { x: p.x + PLAYER_RADIUS, y: p.y, z: p.z + PLAYER_RADIUS };
    for (const b of this.world.boxes) {
      if (overlapsBox(min, max, b)) return true;
    }
    return false;
  }
}
