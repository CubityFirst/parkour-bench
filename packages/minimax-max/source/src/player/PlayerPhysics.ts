import { Vector3 } from 'three';
import type { Collider, CollisionWorld } from '../world/CollisionWorld';
import { PHYSICS } from '../game/Config';

const EPS = 0.0015;

/**
 * Lightweight AABB physics for the player.
 *
 * The player is represented by a box: `position` is the centre of the feet,
 * `radius` is half the width and `height` changes while sliding.
 * Movement is sub-stepped so that fast runs can never tunnel through a wall.
 */
export class PlayerPhysics {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  radius: number = PHYSICS.playerRadius;
  height: number = PHYSICS.standHeight;

  /** True while the player stands on (or slides along) a surface. */
  grounded = false;
  /** The surface the player is currently standing on. */
  groundCollider: Collider | null = null;
  /** Wall that blocked the last horizontal move (zero when free). */
  readonly wallNormal = new Vector3();
  wallHit = false;

  constructor(private readonly world: CollisionWorld) {}

  reset(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.groundCollider = null;
    this.wallHit = false;
    this.wallNormal.set(0, 0, 0);
  }

  get minX(): number {
    return this.position.x - this.radius;
  }
  get maxX(): number {
    return this.position.x + this.radius;
  }
  get minY(): number {
    return this.position.y;
  }
  get maxY(): number {
    return this.position.y + this.height;
  }
  get minZ(): number {
    return this.position.z - this.radius;
  }
  get maxZ(): number {
    return this.position.z + this.radius;
  }

  /** Overlaps the player box with any collider (ignoring `exclude`). */
  overlapsAny(exclude?: Collider): boolean {
    const boxes = this.world.query(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
    for (const box of boxes) {
      if (exclude && box.id === exclude.id) continue;
      if (this.overlapsBox(box)) return true;
    }
    return false;
  }

  overlapsBox(box: Collider): boolean {
    return (
      this.maxX > box.minX &&
      this.minX < box.maxX &&
      this.maxY > box.minY &&
      this.minY < box.maxY &&
      this.maxZ > box.minZ &&
      this.minZ < box.maxZ
    );
  }

  /** True when the player would fit at the given height. */
  fitsAt(y: number, height = this.height): boolean {
    return this.fitsAtPosition(this.position.x, y, this.position.z, height);
  }

  /** True when a player sized box fits at an arbitrary position. */
  fitsAtPosition(x: number, y: number, z: number, height: number): boolean {
    const boxes = this.world.query(
      x - this.radius,
      y,
      z - this.radius,
      x + this.radius,
      y + height,
      z + this.radius,
    );
    for (const box of boxes) {
      if (
        x + this.radius > box.minX &&
        x - this.radius < box.maxX &&
        y + height > box.minY &&
        y < box.maxY &&
        z + this.radius > box.minZ &&
        z - this.radius < box.maxZ
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Moves the player by the current velocity and resolves collisions.
   * Movement is split into small sub steps so fast runs cannot tunnel.
   */
  integrate(dt: number): void {
    this.wallHit = false;
    this.wallNormal.set(0, 0, 0);
    this.grounded = false;

    const maxMove =
      Math.max(
        Math.abs(this.velocity.x),
        Math.abs(this.velocity.y),
        Math.abs(this.velocity.z),
      ) * dt;
    const steps = Math.min(8, Math.max(1, Math.ceil(maxMove / 0.25)));
    const sub = dt / steps;

    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', this.velocity.x * sub);
      this.moveAxis('z', this.velocity.z * sub);
      this.moveAxis('y', this.velocity.y * sub);
    }
  }

  private moveAxis(axis: 'x' | 'y' | 'z', delta: number): void {
    if (delta === 0) return;
    if (axis === 'y') {
      this.moveY(delta);
    } else if (axis === 'x') {
      this.moveHorizontal(delta, true);
    } else {
      this.moveHorizontal(delta, false);
    }
  }

  private moveHorizontal(delta: number, isX: boolean): void {
    if (isX) this.position.x += delta;
    else this.position.z += delta;

    for (let pass = 0; pass < 2; pass++) {
      const boxes = this.world.query(
        this.minX,
        this.minY,
        this.minZ,
        this.maxX,
        this.maxY,
        this.maxZ,
      );
      let resolved = false;
      for (const box of boxes) {
        if (!this.overlapsBox(box)) continue;

        // Small ledges are stepped over instead of blocking the player.
        const stepTop = box.maxY - this.position.y;
        if (stepTop > 0 && stepTop <= PHYSICS.stepHeight && this.fitsAt(box.maxY + EPS)) {
          this.position.y = box.maxY + EPS;
          continue;
        }

        if (isX) {
          this.position.x = delta > 0 ? box.minX - this.radius - EPS : box.maxX + this.radius + EPS;
        } else {
          this.position.z = delta > 0 ? box.minZ - this.radius - EPS : box.maxZ + this.radius + EPS;
        }
        if (isX) this.velocity.x = 0;
        else this.velocity.z = 0;

        // Remember the blocking wall so the parkour system can react to it.
        const overlapX = Math.min(this.maxX, box.maxX) - Math.max(this.minX, box.minX);
        const overlapZ = Math.min(this.maxZ, box.maxZ) - Math.max(this.minZ, box.minZ);
        if (overlapX < overlapZ) {
          this.wallNormal.set(delta > 0 ? -1 : 1, 0, 0);
        } else {
          this.wallNormal.set(0, 0, delta > 0 ? -1 : 1);
        }
        this.wallHit = true;
        resolved = true;
        break;
      }
      if (!resolved) break;
    }
  }

  private moveY(delta: number): void {
    this.position.y += delta;
    const boxes = this.world.query(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
    let hitBox: Collider | null = null;
    let hitValue = delta <= 0 ? -Infinity : Infinity;
    for (const box of boxes) {
      if (!this.overlapsBox(box)) continue;
      if (delta <= 0) {
        if (box.maxY > hitValue) {
          hitValue = box.maxY;
          hitBox = box;
        }
      } else if (box.minY < hitValue) {
        hitValue = box.minY;
        hitBox = box;
      }
    }
    if (!hitBox) return;

    if (delta <= 0) {
      this.position.y = hitBox.maxY + EPS;
      this.grounded = true;
      this.groundCollider = hitBox;
    } else {
      this.position.y = hitValue - this.height - EPS;
    }
    this.velocity.y = 0;
  }

  /** Forces the player onto a surface (used after a mantle or a respawn). */
  snapToGround(): void {
    const boxes = this.world.query(
      this.minX,
      this.position.y - 1.2,
      this.minZ,
      this.maxX,
      this.position.y + 0.2,
      this.maxZ,
    );
    let best = -Infinity;
    let bestCollider: Collider | null = null;
    for (const box of boxes) {
      if (box.maxY > this.position.y + 0.05) continue;
      if (box.maxY > best) {
        best = box.maxY;
        bestCollider = box;
      }
    }
    if (bestCollider) {
      this.position.y = best + EPS;
      this.grounded = true;
      this.groundCollider = bestCollider;
    }
  }
}
