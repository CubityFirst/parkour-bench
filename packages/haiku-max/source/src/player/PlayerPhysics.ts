import { MOVE } from './MovementConfig';
import { EPS, overlaps, type Bounds, type CollisionWorld } from '../world/CollisionWorld';

/** How far the feet may be from a surface top and still count as standing on it (m). */
const GROUND_TOLERANCE = 0.05;
/** Largest displacement applied in one collision step, so thin geometry is never skipped. */
const MAX_SUBSTEP = 0.2;

type Axis = 'x' | 'y' | 'z';

/**
 * Body integration and collision for the player. The body is an axis-aligned box whose
 * position is the centre of its feet. Movement is resolved one axis at a time, which keeps
 * sliding along walls and ceilings simple and predictable.
 */
export class PlayerPhysics {
  /** Feet centre. */
  readonly pos = { x: 0, y: 0, z: 0 };
  /** Velocity in metres per second. */
  readonly vel = { x: 0, y: 0, z: 0 };
  /** Current body height: standing or crouched. */
  height: number = MOVE.standHeight;
  grounded = false;
  /** Top of the surface under the feet. Only meaningful while grounded. */
  groundY = 0;

  private readonly bounds: Bounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  constructor(private readonly world: CollisionWorld) {}

  teleport(x: number, y: number, z: number): void {
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
    this.vel.x = 0;
    this.vel.y = 0;
    this.vel.z = 0;
    this.grounded = false;
  }

  /** Moves by velocity * dt and resolves collisions. */
  integrate(dt: number): void {
    const dx = this.vel.x * dt;
    const dy = this.vel.y * dt;
    const dz = this.vel.z * dt;
    const largest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.max(1, Math.ceil(largest / MAX_SUBSTEP));
    const sx = dx / steps;
    const sy = dy / steps;
    const sz = dz / steps;

    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', sx);
      this.moveAxis('z', sz);
      this.moveAxis('y', sy);
    }
  }

  /**
   * Checks for a surface just under the feet. Only a thin slab is tested, so walking off an
   * edge is detected on the same step the feet leave the roof.
   */
  probeGround(): boolean {
    const p = this.pos;
    const half = MOVE.bodyHalfWidth;
    let found = false;
    let top = -Infinity;

    for (const solid of this.world.solids) {
      if (solid.maxX <= p.x - half + EPS || solid.minX >= p.x + half - EPS) continue;
      if (solid.maxZ <= p.z - half + EPS || solid.minZ >= p.z + half - EPS) continue;
      const gap = solid.maxY - p.y;
      if (gap < -GROUND_TOLERANCE || gap > GROUND_TOLERANCE) continue;
      if (solid.maxY > top) {
        top = solid.maxY;
        found = true;
      }
    }

    this.grounded = found;
    if (found) this.groundY = top;
    return found;
  }

  /** True when the body fits at its current feet position with the given height. */
  canStandAt(height: number): boolean {
    return this.world.isFree(this.pos.x, this.pos.y, this.pos.z, MOVE.bodyHalfWidth, height);
  }

  private moveAxis(axis: Axis, amount: number): void {
    if (amount === 0) return;

    const half = MOVE.bodyHalfWidth;
    const pos = this.pos;
    pos[axis] += amount;
    this.fillBounds();

    let stopped = false;
    let limit = pos[axis];

    for (const solid of this.world.solids) {
      if (!overlaps(this.bounds, solid)) continue;
      stopped = true;
      if (axis === 'y') {
        // Moving up stops at a solid's underside; moving down stops at its top.
        limit = amount > 0 ? Math.min(limit, solid.minY - this.height) : Math.max(limit, solid.maxY);
      } else if (axis === 'x') {
        limit = amount > 0 ? Math.min(limit, solid.minX - half) : Math.max(limit, solid.maxX + half);
      } else {
        limit = amount > 0 ? Math.min(limit, solid.minZ - half) : Math.max(limit, solid.maxZ + half);
      }
    }

    if (!stopped) return;

    pos[axis] = limit;
    this.vel[axis] = 0;
  }

  private fillBounds(): void {
    const b = this.bounds;
    const p = this.pos;
    const half = MOVE.bodyHalfWidth;
    b.minX = p.x - half;
    b.maxX = p.x + half;
    b.minZ = p.z - half;
    b.maxZ = p.z + half;
    b.minY = p.y;
    b.maxY = p.y + this.height;
  }
}
