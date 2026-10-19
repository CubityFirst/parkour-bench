import { CollisionWorld } from '../world/CollisionWorld';

/** Body dimensions (metres). */
export const BODY = {
  halfWidth: 0.3,
  standHeight: 1.8,
  slideHeight: 0.9,
  stepHeight: 0.4,
  eyeStand: 1.65,
  eyeSlide: 0.7,
};

export interface MoveResult {
  hitX: boolean;
  hitZ: boolean;
  hitCeiling: boolean;
  landed: boolean;
  /** Downward speed at the moment of landing (m/s, positive). */
  impact: number;
}

/**
 * Player body: an upright AABB (feet-centred) moved with axis-separated, sub-stepped
 * sweeps against the CollisionWorld. Holds no gameplay logic - only position,
 * velocity and "move without penetrating anything".
 */
export class PlayerPhysics {
  /** Position of the feet centre. */
  readonly p = [0, 0, 0];
  readonly v = [0, 0, 0];
  height = BODY.standHeight;
  grounded = false;
  private readonly result: MoveResult = { hitX: false, hitZ: false, hitCeiling: false, landed: false, impact: 0 };

  constructor(readonly world: CollisionWorld) {}

  get x() { return this.p[0]; }
  get y() { return this.p[1]; }
  get z() { return this.p[2]; }
  get hSpeed() { return Math.hypot(this.v[0], this.v[2]); }

  teleport(x: number, y: number, z: number): void {
    this.p[0] = x; this.p[1] = y; this.p[2] = z;
    this.v[0] = this.v[1] = this.v[2] = 0;
    this.height = BODY.standHeight;
    this.grounded = false;
  }

  /** Would a body of height h at the given feet position overlap the world? */
  overlapsAt(x: number, y: number, z: number, h: number): boolean {
    const hw = BODY.halfWidth;
    return this.world.overlaps(x - hw, y, z - hw, x + hw, y + h, z + hw);
  }

  canStand(): boolean {
    return !this.overlapsAt(this.p[0], this.p[1], this.p[2], BODY.standHeight);
  }

  /** Sweeps along one axis in small increments, pushing out of any box that is entered. */
  private sweep(axis: 0 | 1 | 2, delta: number): boolean {
    if (delta === 0) return false;
    const hw = BODY.halfWidth;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.15));
    const d = delta / steps;
    const p = this.p;
    let hit = false;
    for (let i = 0; i < steps; i++) {
      p[axis] += d;
      for (let iter = 0; iter < 4; iter++) {
        const b = this.world.firstOverlap(
          p[0] - hw, p[1], p[2] - hw, p[0] + hw, p[1] + this.height, p[2] + hw,
        );
        if (!b) break;
        hit = true;
        if (axis === 0) p[0] = d > 0 ? b.minX - hw : b.maxX + hw;
        else if (axis === 1) p[1] = d > 0 ? b.minY - this.height : b.maxY;
        else p[2] = d > 0 ? b.minZ - hw : b.maxZ + hw;
      }
    }
    return hit;
  }

  /** Horizontal move with automatic step-up over small lips when grounded. */
  private moveHorizontal(axis: 0 | 2, delta: number): boolean {
    if (delta === 0) return false;
    const p = this.p;
    const startAxis = p[axis];
    const startY = p[1];
    let hit = this.sweep(axis, delta);
    if (hit && this.grounded && this.v[1] <= 0.01) {
      const blockedAxis = p[axis];
      const blockedY = p[1];
      p[axis] = startAxis;
      p[1] = startY + BODY.stepHeight;
      if (!this.overlapsAt(p[0], p[1], p[2], this.height) && !this.sweep(axis, delta)) {
        // Cleared the lip: settle back onto the surface.
        this.sweep(1, -(BODY.stepHeight + 0.02));
        hit = false;
      } else {
        p[axis] = blockedAxis;
        p[1] = blockedY;
      }
    }
    return hit;
  }

  /** Advances the body by dt using its current velocity. */
  move(dt: number): MoveResult {
    const r = this.result;
    r.hitX = r.hitZ = r.hitCeiling = r.landed = false;
    r.impact = 0;
    const v = this.v;

    if (this.moveHorizontal(0, v[0] * dt)) { r.hitX = true; v[0] = 0; }
    if (this.moveHorizontal(2, v[2] * dt)) { r.hitZ = true; v[2] = 0; }

    const vyBefore = v[1];
    const hitY = this.sweep(1, vyBefore * dt);
    if (hitY) {
      if (vyBefore < 0) {
        r.impact = -vyBefore;
      } else {
        r.hitCeiling = true;
      }
      v[1] = 0;
    }
    // Ground probe: a small sliver below the feet.
    const onGround = v[1] <= 0.01 && this.overlapsAt(this.p[0], this.p[1] - 0.05, this.p[2], this.height);
    if (onGround && !this.grounded) {
      r.landed = true;
      r.impact = Math.max(r.impact, -vyBefore);
    }
    this.grounded = onGround;
    return r;
  }
}
