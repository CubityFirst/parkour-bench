import * as THREE from 'three';
import { CollisionWorld } from '../world/CollisionWorld';
import { CONST } from '../constants';

const AXIS: Record<'x' | 'y' | 'z', number> = { x: 0, y: 1, z: 2 };

/**
 * Lightweight first-person physics: an axis-aligned box (AABB) moving through
 * the collision world with gravity, momentum and per-axis collision resolution.
 * Movement uses a fixed timestep so behaviour is identical across frame rates.
 */
export class PlayerPhysics {
  position = new THREE.Vector3(); // center of the AABB
  velocity = new THREE.Vector3();
  half = new THREE.Vector3(CONST.playerRadius, CONST.heightStand / 2, CONST.playerRadius);
  grounded = false;
  /** Multiplier applied to gravity each step (1 = normal, 0 = wall run hold). */
  gravityScale = 1;

  constructor(private world: CollisionWorld) {}

  get feetY(): number {
    return this.position.y - this.half.y;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  setHalfHeight(h: number): void {
    this.half.y = h / 2;
  }

  reset(position: THREE.Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.setHalfHeight(CONST.heightStand);
    this.grounded = false;
    this.gravityScale = 1;
  }

  /** Apply gravity + axis-separated movement for one fixed step. */
  integrate(dt: number): void {
    this.velocity.y -= CONST.gravity * this.gravityScale * dt;
    if (this.velocity.y < CONST.terminalFall) this.velocity.y = CONST.terminalFall;

    this.grounded = false;

    this.moveAxis('x', dt);
    this.moveAxis('z', dt);
    this.moveAxis('y', dt);
  }

  private moveAxis(axis: 'x' | 'y' | 'z', dt: number): void {
    const idx = AXIS[axis];
    const delta = this.velocity.getComponent(idx) * dt;
    const applied = this.world.resolveAxis(this.position, this.half, axis, delta);
    this.position.setComponent(idx, this.position.getComponent(idx) + applied);

    if (Math.abs(applied - delta) > 1e-6) {
      this.velocity.setComponent(idx, 0);
      if (axis === 'y' && delta < 0) this.grounded = true;
    }
  }
}
