import * as THREE from 'three';
import { PLAYER } from '../game/Config';
import { CollisionWorld, Solid } from '../world/CollisionWorld';

const EPS = 1e-4;

/**
 * Lightweight AABB physics body.
 *
 * The player is an axis-aligned box. Movement is resolved one axis at a time
 * (X, then Z, then Y) which is stable for boxy geometry and guarantees the
 * player never tunnels through a wall at high speed because every step is
 * additionally sub-stepped to a maximum travel distance.
 */
export class PlayerPhysics {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  /** Current body height (shrinks while sliding). */
  height = PLAYER.height;

  grounded = false;
  wasGrounded = false;
  /** Set when the body touches down during the current move. */
  justLanded = false;
  /** Vertical speed of the last landing (used for the camera impact). */
  landImpact = 0;
  /** Set for one frame when the head hits a ceiling. */
  hitCeiling = false;

  private world: CollisionWorld;
  private tmpA = new THREE.Box3();
  private tmpB = new THREE.Box3();
  private overlapping: Solid[] = [];

  constructor(world: CollisionWorld) {
    this.world = world;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get eyeHeight(): number {
    return Math.max(this.height - PLAYER.eyeInset, 0.25);
  }

  reset(position: THREE.Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.height = PLAYER.height;
    this.grounded = false;
    this.wasGrounded = false;
    this.landImpact = 0;
    this.hitCeiling = false;
  }

  /** Build the AABB of the body for the given height. */
  bodyBox(height = this.height, out = this.tmpA): THREE.Box3 {
    const r = PLAYER.radius;
    out.min.set(this.position.x - r, this.position.y, this.position.z - r);
    out.max.set(this.position.x + r, this.position.y + height, this.position.z + r);
    return out;
  }

  /** True when a body of the given height fits at the current position. */
  fits(height: number): boolean {
    this.bodyBox(height, this.tmpB);
    return this.world.isFree(this.tmpB);
  }

  /** True when a body of the given height fits at an arbitrary position. */
  fitsAt(x: number, y: number, z: number, height: number, ignore?: Solid): boolean {
    const r = PLAYER.radius;
    this.tmpB.min.set(x - r, y, z - r);
    this.tmpB.max.set(x + r, y + height, z + r);
    return this.world.isFree(this.tmpB, ignore);
  }

  /**
   * Integrate the velocity over `dt`, resolving collisions.
   * Movement is split into sub-steps so no single step travels further than
   * 0.2 m, which makes tunnelling impossible even at 50 m/s.
   */
  move(dt: number): void {
    this.justLanded = false;
    const travel = this.velocity.length() * dt;
    const steps = Math.min(PLAYER.maxSubSteps, Math.max(1, Math.ceil(travel / 0.2)));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) this.integrate(sdt);
  }

  private integrate(dt: number): void {
    this.position.x += this.velocity.x * dt;
    this.resolveHorizontal('x');
    this.position.z += this.velocity.z * dt;
    this.resolveHorizontal('z');
    this.position.y += this.velocity.y * dt;
    // Ground contact is re-evaluated every sub-step.
    this.grounded = false;
    this.resolveVertical();
  }

  private resolveHorizontal(axis: 'x' | 'z'): void {
    const dir = Math.sign(this.velocity[axis]);
    const r = PLAYER.radius;

    for (const solid of this.world.solids) {
      const box = solid.box;
      const other = axis === 'x' ? 'z' : 'x';
      if (
        this.position[other] + r <= box.min[other] ||
        this.position[other] - r >= box.max[other]
      ) {
        continue;
      }
      if (this.position.y + this.height <= box.min.y || this.position.y >= box.max.y) continue;
      if (
        this.position[axis] + r <= box.min[axis] ||
        this.position[axis] - r >= box.max[axis]
      ) {
        continue;
      }

      // Overlapping. Try to step up onto low obstacles instead of blocking.
      const rise = box.max.y - this.position.y;
      if (rise > 0 && rise <= PLAYER.stepHeight) {
        // The obstacle itself must not count as an obstruction here.
        if (this.fitsAt(this.position.x, box.max.y, this.position.z, this.height, solid)) {
          this.position.y = box.max.y;
          continue;
        }
      }

      if (dir > 0) {
        this.position[axis] = box.min[axis] - r - EPS;
      } else if (dir < 0) {
        this.position[axis] = box.max[axis] + r + EPS;
      } else {
        // Pushed in from another axis: eject along the shallowest side.
        const pushMin = this.position[axis] - box.min[axis];
        const pushMax = box.max[axis] - this.position[axis];
        this.position[axis] = pushMin < pushMax ? box.min[axis] - r - EPS : box.max[axis] + r + EPS;
      }
      this.velocity[axis] = 0;
    }
  }

  private resolveVertical(): void {
    const dy = this.velocity.y;
    const r = PLAYER.radius;

    for (const solid of this.world.solids) {
      const box = solid.box;
      if (
        this.position.x + r <= box.min.x ||
        this.position.x - r >= box.max.x ||
        this.position.z + r <= box.min.z ||
        this.position.z - r >= box.max.z
      ) {
        continue;
      }
      if (this.position.y + this.height <= box.min.y || this.position.y >= box.max.y) continue;

      if (dy <= 0) {
        this.position.y = box.max.y;
        if (!this.grounded) {
          this.justLanded = true;
          this.landImpact = Math.max(this.landImpact, -dy);
        }
        this.grounded = true;
        this.velocity.y = 0;
      } else {
        this.position.y = box.min.y - this.height - EPS;
        this.velocity.y = 0;
        this.hitCeiling = true;
      }
    }
  }

  /**
   * Ground probe: is there a walkable surface directly under the feet?
   * Only counts surfaces whose top is level with the feet, so walls never
   * register as ground.
   */
  probeGround(): boolean {
    const r = PLAYER.radius;
    const minY = this.position.y - 0.14;
    const maxY = this.position.y + 0.04;
    for (const solid of this.world.solids) {
      const box = solid.box;
      if (this.position.x + r <= box.min.x || this.position.x - r >= box.max.x) continue;
      if (this.position.z + r <= box.min.z || this.position.z - r >= box.max.z) continue;
      if (box.max.y < minY || box.max.y > maxY) continue;
      if (box.max.y > this.position.y + 0.05) continue;
      return true;
    }
    return false;
  }

  /** Collect solids overlapping the body (used by the parkour system). */
  bodyOverlaps(): Solid[] {
    return this.world.query(this.bodyBox(), this.overlapping);
  }

  /**
   * True when a low obstacle blocks the path directly in front of the body.
   * Used to kick the player out of a dead stop so they can never get trapped
   * in front of a duct or a crate.
   */
  blockedAhead(forward: THREE.Vector3): boolean {
    const r = PLAYER.radius;
    const px = this.position.x + forward.x * (r + 0.18);
    const pz = this.position.z + forward.z * (r + 0.18);
    for (const solid of this.world.solids) {
      const b = solid.box;
      if (px < b.min.x || px > b.max.x) continue;
      if (pz < b.min.z || pz > b.max.z) continue;
      if (b.max.y <= this.position.y + 0.3) continue; // low enough to step over
      if (b.min.y >= this.position.y + 1.7) continue; // high enough to duck under
      return true;
    }
    return false;
  }

  /** Nudge the body out of any geometry it is stuck inside. */
  depenetrate(): void {
    for (let iter = 0; iter < 3; iter++) {
      const hits = this.world.query(this.bodyBox(), this.overlapping);
      if (!hits.length) return;
      let moved = false;
      for (const solid of hits) {
        const box = solid.box;
        const r = PLAYER.radius;
        const dxMin = this.position.x + r - box.min.x;
        const dxMax = box.max.x - (this.position.x - r);
        const dzMin = this.position.z + r - box.min.z;
        const dzMax = box.max.z - (this.position.z - r);
        const dyMin = this.position.y + this.height - box.min.y;
        const dyMax = box.max.y - this.position.y;
        const best = Math.min(dxMin, dxMax, dzMin, dzMax, dyMin, dyMax);
        if (best === dxMin) this.position.x = box.min.x - r - EPS;
        else if (best === dxMax) this.position.x = box.max.x + r + EPS;
        else if (best === dzMin) this.position.z = box.min.z - r - EPS;
        else if (best === dzMax) this.position.z = box.max.z + r + EPS;
        else if (best === dyMin) this.position.y = box.min.y - this.height - EPS;
        else this.position.y = box.max.y + EPS;
        moved = true;
      }
      if (!moved) return;
    }
  }
}
