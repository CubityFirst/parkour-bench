import { Vector3 } from 'three';
import { PHYS } from '../config';
import type { Collider, CollisionWorld } from '../world/CollisionWorld';

const SKIN = 1e-3;
/** Maximum distance moved per collision sub-step (prevents tunnelling). */
const MAX_SUBSTEP = 0.12;

/**
 * Kinematic AABB body. `position` is the centre of the player's feet.
 * Movement is resolved one axis at a time against the static collision world,
 * with automatic step-up over small lips (parapets, curbs).
 */
export class PlayerPhysics {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  height: number = PHYS.standHeight;
  readonly radius = PHYS.radius;

  grounded = false;
  groundCollider: Collider | null = null;
  hitCeiling = false;
  /** Horizontal wall contacts from the last move (for wall-run / mantle hints). */
  hitWallX = 0;
  hitWallZ = 0;
  /** Height stepped up during the last move (camera smoothing). */
  steppedUp = 0;

  constructor(private world: CollisionWorld) {}

  boxFreeAt(x: number, y: number, z: number, height = this.height, r = this.radius): boolean {
    return this.world.isFree(x - r, y, z - r, x + r, y + height, z + r);
  }

  /** Can the player stand up (full height) at the current position? */
  hasHeadroom(height = PHYS.standHeight): boolean {
    const p = this.position;
    return this.boxFreeAt(p.x, p.y + 0.01, p.z, height - 0.01);
  }

  /** Integrate velocity over dt with collision response. */
  move(dt: number, allowStep = true): void {
    this.grounded = false;
    this.groundCollider = null;
    this.hitCeiling = false;
    this.hitWallX = 0;
    this.hitWallZ = 0;
    this.steppedUp = 0;

    const dx = this.velocity.x * dt;
    const dy = this.velocity.y * dt;
    const dz = this.velocity.z * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / MAX_SUBSTEP));
    for (let i = 0; i < steps; i++) {
      this.moveY(dy / steps);
      this.moveHorizontal(0, dx / steps, allowStep);
      this.moveHorizontal(2, dz / steps, allowStep);
    }

    // Ground probe: we may be resting exactly on a surface with zero vertical motion.
    if (!this.grounded && this.velocity.y <= 0) {
      const p = this.position, r = this.radius;
      const hits = this.world.query(p.x - r, p.y - 0.03, p.z - r, p.x + r, p.y + 0.001, p.z + r);
      for (const c of hits) {
        if (c.maxY <= p.y + 0.002) { this.grounded = true; this.groundCollider = c; break; }
      }
    }
  }

  private moveY(dy: number): void {
    if (dy === 0) return;
    const p = this.position, r = this.radius;
    p.y += dy;
    const hits = this.world.query(p.x - r, p.y, p.z - r, p.x + r, p.y + this.height, p.z + r);
    if (hits.length === 0) return;
    if (dy < 0) {
      let top = -Infinity, col: Collider | null = null;
      for (const c of hits) if (c.maxY > top) { top = c.maxY; col = c; }
      p.y = top;
      this.velocity.y = Math.max(0, this.velocity.y);
      this.grounded = true;
      this.groundCollider = col;
    } else {
      let bottom = Infinity;
      for (const c of hits) if (c.minY < bottom) bottom = c.minY;
      p.y = bottom - this.height - SKIN;
      this.velocity.y = Math.min(0, this.velocity.y);
      this.hitCeiling = true;
    }
  }

  /** axis 0 = x, 2 = z */
  private moveHorizontal(axis: 0 | 2, d: number, allowStep: boolean): void {
    if (d === 0) return;
    const p = this.position, r = this.radius;
    if (axis === 0) p.x += d; else p.z += d;

    for (let iter = 0; iter < 3; iter++) {
      const hits = this.world.query(p.x - r, p.y, p.z - r, p.x + r, p.y + this.height, p.z + r);
      if (hits.length === 0) return;

      // Try stepping up onto low obstacles first.
      if (allowStep) {
        let stepTop = -Infinity;
        for (const c of hits) if (c.maxY > stepTop) stepTop = c.maxY;
        const rise = stepTop - p.y;
        if (rise > 0 && rise <= PHYS.stepHeight && this.velocity.y < 4 &&
            this.boxFreeAt(p.x, stepTop + SKIN, p.z)) {
          p.y = stepTop + SKIN;
          this.steppedUp += rise;
          if (this.velocity.y < 0) this.velocity.y = 0;
          continue;
        }
      }

      // Push out along the axis of motion.
      if (axis === 0) {
        if (d > 0) { let m = Infinity; for (const c of hits) m = Math.min(m, c.minX); p.x = m - r - SKIN; this.hitWallX = 1; }
        else { let m = -Infinity; for (const c of hits) m = Math.max(m, c.maxX); p.x = m + r + SKIN; this.hitWallX = -1; }
        this.velocity.x = 0;
      } else {
        if (d > 0) { let m = Infinity; for (const c of hits) m = Math.min(m, c.minZ); p.z = m - r - SKIN; this.hitWallZ = 1; }
        else { let m = -Infinity; for (const c of hits) m = Math.max(m, c.maxZ); p.z = m + r + SKIN; this.hitWallZ = -1; }
        this.velocity.z = 0;
      }
      return;
    }
  }
}
