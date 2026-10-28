import * as THREE from 'three';
import { PHYS } from '../core/Config';
import { CollisionWorld, Collider } from '../world/CollisionWorld';

export interface WallHit {
  /** Normal pointing away from the wall, towards the player. */
  normal: THREE.Vector3;
  collider: Collider;
}

/**
 * Lightweight AABB player body.
 *
 * Movement is integrated with a fixed timestep and resolved axis by axis
 * (X, then Z, then Y). Every step is subdivided so that even very fast
 * movement can never tunnel through a wall or a floor.
 */
export class PhysicsBody {
  /** Feet position (centre of the bottom face of the AABB). */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  radius = PHYS.radius;
  height = PHYS.standHeight;
  grounded = false;
  /** Set when the body was stopped by a vertical surface during the last move. */
  wallHit: WallHit | null = null;
  /** Horizontal speed the body had right before it hit a wall. */
  blockedSpeed = 0;
  /** True when the last move was stopped by a horizontal surface. */
  blocked = false;
  /** Collider that is ignored while resolving (used for the wall being run). */
  ignoreId = -1;

  private readonly hits: Collider[] = [];

  get bounds() {
    return {
      minX: this.position.x - this.radius,
      minY: this.position.y,
      minZ: this.position.z - this.radius,
      maxX: this.position.x + this.radius,
      maxY: this.position.y + this.height,
      maxZ: this.position.z + this.radius,
    };
  }

  /** Horizontal speed ignoring vertical motion. */
  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Clears all motion state (used on respawn). */
  reset(position: THREE.Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.wallHit = null;
    this.height = PHYS.standHeight;
    this.radius = PHYS.radius;
  }

  /** Drops the body onto the closest surface below the spawn position. */
  settle(world: CollisionWorld): void {
    const ground = world.groundHeightAt(this.position.x, this.position.z, this.position.y + 0.2);
    if (ground > -Infinity) this.position.y = ground + 0.01;
  }

  /**
   * Integrates the velocity and resolves collisions.
   */
  moveAndCollide(world: CollisionWorld, dt: number): void {
    this.wallHit = null;
    this.blockedSpeed = 0;
    this.blocked = false;

    const longest = Math.max(
      Math.abs(this.velocity.x * dt),
      Math.abs(this.velocity.y * dt),
      Math.abs(this.velocity.z * dt)
    );
    const steps = Math.min(12, Math.max(1, Math.ceil(longest / 0.2)));
    const h = dt / steps;

    for (let i = 0; i < steps; i++) {
      this.stepAxis(world, 'x', this.velocity.x * h);
      this.stepAxis(world, 'z', this.velocity.z * h);
      this.stepAxis(world, 'y', this.velocity.y * h);
    }

    this.unstick(world);
  }

  /**
   * Safety net: if the body ended up inside solid geometry (for example after
   * a teleport or a bad landing) it is pushed up onto the surface again.
   */
  private unstick(world: CollisionWorld): void {
    const b = this.bounds;
    if (
      !world.isBlocked(
        b.minX + 0.02,
        this.position.y + 0.06,
        b.minZ + 0.02,
        b.maxX - 0.02,
        this.position.y + this.height,
        b.maxZ - 0.02
      )
    ) {
      return;
    }
    let top = -Infinity;
    for (let i = 0; i < world.colliders.length; i++) {
      const c = world.colliders[i];
      if (
        c.maxX <= b.minX + 0.02 ||
        c.minX >= b.maxX - 0.02 ||
        c.maxZ <= b.minZ + 0.02 ||
        c.minZ >= b.maxZ - 0.02 ||
        c.maxY <= this.position.y + 0.06
      ) {
        continue;
      }
      top = Math.max(top, c.maxY);
    }
    if (top > -Infinity) {
      this.position.y = top + 0.01;
      this.velocity.y = 0;
      this.grounded = true;
    }
  }

  private stepAxis(world: CollisionWorld, axis: 'x' | 'y' | 'z', delta: number): void {
    this.position[axis] += delta;

    const b = this.bounds;
    const found = world.query(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
    const count = found.length;
    if (count === 0) {
      if (axis === 'y') this.grounded = false;
      return;
    }

    this.hits.length = 0;
    for (let i = 0; i < count; i++) {
      if (found[i].id === this.ignoreId) continue;
      this.hits.push(found[i]);
    }
    const kept = this.hits.length;
    if (kept === 0) {
      if (axis === 'y') this.grounded = false;
      return;
    }

    if (axis === 'y') {
      // Only surfaces the body was properly under / above can act as a floor
      // or a ceiling. Without this the player would be lifted on top of any
      // box they happen to overlap sideways.
      const prevY = this.position.y - delta;
      if (delta <= 0) {
        let top = -Infinity;
        for (let i = 0; i < kept; i++) {
          const c = this.hits[i];
          if (c.maxY > prevY + 0.04) continue;
          top = Math.max(top, c.maxY);
        }
        if (top > -Infinity) {
          this.position.y = top;
          this.velocity.y = 0;
          this.grounded = true;
        } else {
          this.grounded = false;
        }
      } else {
        let bottom = Infinity;
        for (let i = 0; i < kept; i++) {
          const c = this.hits[i];
          if (c.minY < prevY + this.height - 0.04) continue;
          bottom = Math.min(bottom, c.minY);
        }
        if (bottom < Infinity) {
          this.position.y = bottom - this.height;
          this.velocity.y = 0;
        }
      }
      return;
    }

    // Horizontal axis. Small lips (curbs, roof edges) are stepped over instead
    // of blocking the player.
    let stepUp = -Infinity;
    let blockMin = Infinity;
    let blockMax = -Infinity;
    let blocked = false;
    for (let i = 0; i < kept; i++) {
      const c = this.hits[i];
      const rise = c.maxY - this.position.y;
      if (this.grounded && rise > 0 && rise <= PHYS.maxStepHeight) {
        stepUp = Math.max(stepUp, c.maxY);
        continue;
      }
      blocked = true;
      if (axis === 'x') {
        blockMin = Math.min(blockMin, c.minX);
        blockMax = Math.max(blockMax, c.maxX);
      } else {
        blockMin = Math.min(blockMin, c.minZ);
        blockMax = Math.max(blockMax, c.maxZ);
      }
    }

    if (stepUp > -Infinity && !blocked) {
      const lifted = stepUp + 0.002;
      const clear = !world.isBlocked(
        this.position.x - this.radius,
        lifted + 0.02,
        this.position.z - this.radius,
        this.position.x + this.radius,
        lifted + this.height,
        this.position.z + this.radius
      );
      if (clear) {
        this.position.y = lifted;
        return;
      }
    }

    if (!blocked) return;

    this.blocked = true;

    if (axis === 'x') {
      if (delta > 0) {
        this.position.x = blockMin - this.radius;
        this.blockedSpeed = Math.max(this.blockedSpeed, Math.hypot(this.velocity.x, this.velocity.z));
        this.velocity.x = 0;
        this.recordWallHit(1, 0, 0);
      } else {
        this.position.x = blockMax + this.radius;
        this.blockedSpeed = Math.max(this.blockedSpeed, Math.hypot(this.velocity.x, this.velocity.z));
        this.velocity.x = 0;
        this.recordWallHit(-1, 0, 0);
      }
    } else {
      if (delta > 0) {
        this.position.z = blockMin - this.radius;
        this.blockedSpeed = Math.max(this.blockedSpeed, Math.hypot(this.velocity.x, this.velocity.z));
        this.velocity.z = 0;
        this.recordWallHit(0, 0, 1);
      } else {
        this.position.z = blockMax + this.radius;
        this.blockedSpeed = Math.max(this.blockedSpeed, Math.hypot(this.velocity.x, this.velocity.z));
        this.velocity.z = 0;
        this.recordWallHit(0, 0, -1);
      }
    }
  }

  private recordWallHit(nx: number, ny: number, nz: number): void {
    let best: Collider | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.hits.length; i++) {
      const c = this.hits[i];
      const d =
        nx !== 0
          ? Math.abs(c.maxX - this.position.x)
          : Math.abs(c.maxZ - this.position.z);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best) {
      this.wallHit = { normal: new THREE.Vector3(nx, ny, nz), collider: best };
    }
  }
}
