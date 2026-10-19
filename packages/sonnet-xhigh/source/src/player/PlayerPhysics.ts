/**
 * PlayerPhysics - the player's physical body (an upright AABB) and its collision
 * response against the CollisionWorld.
 *
 * Movement is resolved one axis at a time with small sub-steps, so even at the
 * maximum movement speed the player never travels more than a fraction of its own
 * width per sub-step - tunnelling through thin walls is not possible.
 *
 * Position (`x`,`y`,`z`) is the centre of the player's feet.
 */

import { type Box, type CollisionWorld } from '../world/CollisionWorld';

export const BODY = {
  radius: 0.3,
  standHeight: 1.8,
  slideHeight: 0.9,
  /** Highest lip that is climbed automatically without jumping (curbs, rooftop edges). */
  stepHeight: 0.32,
} as const;

/** Tiny gap kept between the player and surfaces so strict overlap tests stay stable. */
const EPS = 0.001;
/** Largest distance covered by one collision sub-step. */
const MAX_SUBSTEP = 0.18;

export class PlayerPhysics {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;

  height: number = BODY.standHeight;
  readonly radius = BODY.radius;

  grounded = false;
  groundBox: Box | null = null;

  /** Set by the most recent `move()`: we pushed against a wall this step. */
  hitWall = false;
  hitWallNx = 0;
  hitWallNz = 0;
  hitCeiling = false;
  /** Vertical speed right before the last landing (negative = downwards). */
  landingImpact = 0;
  justLanded = false;

  private readonly hits: Box[] = [];
  private readonly probe: Box[] = [];

  constructor(private readonly world: CollisionWorld) {}

  teleport(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.height = BODY.standHeight;
    this.grounded = false;
    this.groundBox = null;
    this.depenetrate();
    this.updateGrounded();
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  // ---------------------------------------------------------------- queries

  /** Would the player's AABB (with the given height) be free of solids at this spot? */
  canOccupy(x: number, y: number, z: number, height: number, ignore?: Box | null): boolean {
    const r = this.radius;
    return !this.world.overlaps(x - r, y, z - r, x + r, y + height, z + r, ignore);
  }

  /** Can the player grow to `height` at the current position? */
  hasHeadroom(height: number): boolean {
    if (height <= this.height) return true;
    return this.canOccupy(this.x, this.y + EPS, this.z, height);
  }

  /**
   * Distance from the feet up to the lowest ceiling above the player, capped at `cap`.
   * Used to keep the camera from poking through low vents.
   */
  ceilingClearance(cap = 3): number {
    const r = this.radius;
    const hits = this.world.query(
      this.x - r, this.y + 0.05, this.z - r,
      this.x + r, this.y + cap, this.z + r,
      this.probe,
    );
    let lowest = cap;
    for (let i = 0; i < hits.length; i++) {
      const b = hits[i];
      const rel = b.minY - this.y;
      if (rel < lowest) lowest = Math.max(rel, 0);
    }
    return lowest;
  }

  /** Changes the collision height. Growing only succeeds with headroom. */
  setHeight(h: number): boolean {
    if (h > this.height && !this.hasHeadroom(h)) return false;
    this.height = h;
    return true;
  }

  // ---------------------------------------------------------------- movement

  /**
   * Advances the body by `dt` using the current velocity, resolving collisions.
   * Gravity and all other forces are applied by the caller (PlayerController).
   */
  move(dt: number): void {
    this.hitWall = false;
    this.hitCeiling = false;
    this.justLanded = false;
    const wasGrounded = this.grounded;
    const impactVy = this.vy;

    const dx = this.vx * dt;
    const dy = this.vy * dt;
    const dz = this.vz * dt;
    const longest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.max(1, Math.ceil(longest / MAX_SUBSTEP));
    const sx = dx / steps, sy = dy / steps, sz = dz / steps;

    let landed = false;
    for (let i = 0; i < steps; i++) {
      if (sx !== 0) this.moveHorizontal(0, sx);
      if (sz !== 0) this.moveHorizontal(2, sz);
      if (sy !== 0 && this.moveVertical(sy)) landed = true;
    }

    // Safety net: never remain inside geometry (e.g. after a scripted move).
    this.depenetrate();

    this.updateGrounded(landed);
    if (this.grounded && !wasGrounded) {
      this.justLanded = true;
      this.landingImpact = Math.min(impactVy, 0);
    }
  }

  /** Re-evaluates `grounded` using a short probe beneath the feet. */
  updateGrounded(landedThisStep = false): void {
    if (this.vy > 0.01 && !landedThisStep) {
      this.grounded = false;
      this.groundBox = null;
      return;
    }
    const r = this.radius - 0.02;
    const hits = this.world.query(
      this.x - r, this.y - 0.06, this.z - r,
      this.x + r, this.y + 0.02, this.z + r,
      this.probe,
    );
    let best: Box | null = null;
    for (let i = 0; i < hits.length; i++) {
      const b = hits[i];
      if (b.maxY >= this.y - 0.06 && b.maxY <= this.y + 0.02) {
        if (!best || b.maxY > best.maxY) best = b;
      }
    }
    this.grounded = best !== null;
    this.groundBox = best;
    if (best && this.vy < 0) this.vy = 0;
  }

  private moveHorizontal(axis: 0 | 2, delta: number): void {
    if (axis === 0) this.x += delta; else this.z += delta;

    const r = this.radius;
    const hits = this.world.query(
      this.x - r, this.y, this.z - r,
      this.x + r, this.y + this.height, this.z + r,
      this.hits,
    );
    for (let i = 0; i < hits.length; i++) {
      const b = hits[i];
      // Re-test: earlier resolutions in this loop may already have freed us.
      if (!(this.x - r < b.maxX && this.x + r > b.minX &&
            this.y < b.maxY && this.y + this.height > b.minY &&
            this.z - r < b.maxZ && this.z + r > b.minZ)) continue;

      // Small lips (curbs, parapet edges) are stepped over instead of blocking.
      const lip = b.maxY - this.y;
      if (lip > 0 && lip <= BODY.stepHeight) {
        const ny = b.maxY + EPS;
        if (this.canOccupy(this.x, ny, this.z, this.height)) {
          this.y = ny;
          if (this.vy < 0) this.vy = 0;
          this.grounded = true;
          this.groundBox = b;
          continue;
        }
      }

      if (axis === 0) {
        if (delta > 0) { this.x = b.minX - r - EPS; this.hitWallNx = -1; }
        else { this.x = b.maxX + r + EPS; this.hitWallNx = 1; }
        this.hitWallNz = 0;
        this.vx = 0;
      } else {
        if (delta > 0) { this.z = b.minZ - r - EPS; this.hitWallNz = -1; }
        else { this.z = b.maxZ + r + EPS; this.hitWallNz = 1; }
        this.hitWallNx = 0;
        this.vz = 0;
      }
      this.hitWall = true;
    }
  }

  /** Returns true when the move ended with the player landing on something. */
  private moveVertical(delta: number): boolean {
    this.y += delta;
    const r = this.radius;
    const hits = this.world.query(
      this.x - r, this.y, this.z - r,
      this.x + r, this.y + this.height, this.z + r,
      this.hits,
    );
    let landed = false;
    for (let i = 0; i < hits.length; i++) {
      const b = hits[i];
      if (!(this.y < b.maxY && this.y + this.height > b.minY)) continue;
      if (delta < 0) {
        this.y = b.maxY + EPS;
        if (this.vy < 0) this.vy = 0;
        this.grounded = true;
        this.groundBox = b;
        landed = true;
      } else {
        this.y = b.minY - this.height - EPS;
        if (this.vy > 0) this.vy = 0;
        this.hitCeiling = true;
      }
    }
    return landed;
  }

  /** Pushes the player out of any geometry it overlaps along the shallowest axis. */
  depenetrate(): void {
    for (let iter = 0; iter < 4; iter++) {
      const r = this.radius;
      const hits = this.world.query(
        this.x - r, this.y, this.z - r,
        this.x + r, this.y + this.height, this.z + r,
        this.hits,
      );
      if (hits.length === 0) return;
      let pushed = false;
      for (let i = 0; i < hits.length; i++) {
        const b = hits[i];
        const penLeft = this.x + r - b.minX;
        const penRight = b.maxX - (this.x - r);
        const penBack = this.z + r - b.minZ;
        const penFront = b.maxZ - (this.z - r);
        const penDown = this.y + this.height - b.minY;
        const penUp = b.maxY - this.y;
        const m = Math.min(penLeft, penRight, penBack, penFront, penDown, penUp);
        if (m <= 0) continue;
        if (m === penUp) { this.y = b.maxY + EPS; if (this.vy < 0) this.vy = 0; }
        else if (m === penDown) { this.y = b.minY - this.height - EPS; if (this.vy > 0) this.vy = 0; }
        else if (m === penLeft) { this.x = b.minX - r - EPS; if (this.vx > 0) this.vx = 0; }
        else if (m === penRight) { this.x = b.maxX + r + EPS; if (this.vx < 0) this.vx = 0; }
        else if (m === penBack) { this.z = b.minZ - r - EPS; if (this.vz > 0) this.vz = 0; }
        else { this.z = b.maxZ + r + EPS; if (this.vz < 0) this.vz = 0; }
        pushed = true;
      }
      if (!pushed) return;
    }
  }
}
