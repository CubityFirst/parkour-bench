import * as THREE from 'three';

/**
 * Kinds of solid geometry. The kind only affects visuals/rules; every solid
 * blocks movement the same way.
 *  - white: default rooftop architecture
 *  - red:   traversal-relevant surfaces (vault obstacles, wall-run, platforms)
 *  - glass: reflective office buildings (decorative for the player)
 */
export type SolidKind = 'white' | 'red' | 'glass';

export interface Solid {
  min: THREE.Vector3;
  max: THREE.Vector3;
  kind: SolidKind;
  /** Surface can be wall-run'd along (vertical faces only). */
  wallRun: boolean;
}

export interface MoveResult {
  onGround: boolean;
  hitCeiling: boolean;
  /** Set to the wall normal (+1/-1) if a horizontal axis was blocked. */
  hitWallX: number;
  hitWallZ: number;
}

/** Largest single sub-step along one axis. Keeps fast movement from tunnelling. */
const MAX_STEP = 0.25;
const EPS = 1e-4;

/**
 * Axis-aligned collision world. The player is modelled as an AABB whose origin
 * is the centre of its feet. Movement is resolved one axis at a time in small
 * sub-steps, which is simple, robust and immune to most tunnelling.
 */
export class CollisionWorld {
  readonly solids: Solid[] = [];

  add(min: THREE.Vector3, max: THREE.Vector3, kind: SolidKind = 'white', wallRun = false): Solid {
    const solid: Solid = { min: min.clone(), max: max.clone(), kind, wallRun };
    this.solids.push(solid);
    return solid;
  }

  /** Returns true if the box [min,max] overlaps any solid. */
  overlaps(min: THREE.Vector3, max: THREE.Vector3): boolean {
    for (const s of this.solids) {
      if (
        min.x < s.max.x - EPS && max.x > s.min.x + EPS &&
        min.y < s.max.y - EPS && max.y > s.min.y + EPS &&
        min.z < s.max.z - EPS && max.z > s.min.z + EPS
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Moves a player AABB by `delta`, resolving collisions per axis.
   * `pos` is the feet centre and is mutated; `vel` components are zeroed on blocked axes.
   */
  move(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    halfWidth: number,
    height: number,
    delta: THREE.Vector3,
  ): MoveResult {
    const result: MoveResult = { onGround: false, hitCeiling: false, hitWallX: 0, hitWallZ: 0 };

    // Horizontal first so that a wall hit doesn't get masked by a vertical move.
    this.moveAxis(pos, vel, halfWidth, height, 'x', delta.x, result);
    this.moveAxis(pos, vel, halfWidth, height, 'z', delta.z, result);
    this.moveAxis(pos, vel, halfWidth, height, 'y', delta.y, result);

    // Ground probe: a tiny downward test confirms the player is actually supported.
    if (!result.onGround && vel.y <= 0.01) {
      const probe = 0.06;
      result.onGround = this.overlapsAt(pos, halfWidth, height, 0, -probe, 0);
    }
    return result;
  }

  private overlapsAt(
    pos: THREE.Vector3,
    hw: number,
    h: number,
    dx: number,
    dy: number,
    dz: number,
  ): boolean {
    const min = new THREE.Vector3(pos.x + dx - hw, pos.y + dy, pos.z + dz - hw);
    const max = new THREE.Vector3(pos.x + dx + hw, pos.y + dy + h, pos.z + dz + hw);
    return this.overlaps(min, max);
  }

  private moveAxis(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    hw: number,
    h: number,
    axis: 'x' | 'y' | 'z',
    amount: number,
    result: MoveResult,
  ): void {
    if (Math.abs(amount) < EPS) return;

    const steps = Math.max(1, Math.ceil(Math.abs(amount) / MAX_STEP));
    const stepAmount = amount / steps;

    for (let i = 0; i < steps; i++) {
      const dx = axis === 'x' ? stepAmount : 0;
      const dy = axis === 'y' ? stepAmount : 0;
      const dz = axis === 'z' ? stepAmount : 0;

      if (this.overlapsAt(pos, hw, h, dx, dy, dz)) {
        // Blocked: back off to contact by bisecting the step, then stop this axis.
        let lo = 0;
        let hi = stepAmount;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const ox = axis === 'x' ? mid : 0;
          const oy = axis === 'y' ? mid : 0;
          const oz = axis === 'z' ? mid : 0;
          if (this.overlapsAt(pos, hw, h, ox, oy, oz)) hi = mid;
          else lo = mid;
        }
        applyAxis(pos, axis, lo);
        this.recordBlock(axis, stepAmount, vel, result);
        return;
      }
      applyAxis(pos, axis, stepAmount);
    }
  }

  private recordBlock(axis: 'x' | 'y' | 'z', direction: number, vel: THREE.Vector3, result: MoveResult): void {
    const sign = Math.sign(direction);
    if (axis === 'x') {
      vel.x = 0;
      result.hitWallX = sign;
    } else if (axis === 'z') {
      vel.z = 0;
      result.hitWallZ = sign;
    } else {
      if (direction < 0) result.onGround = true;
      else result.hitCeiling = true;
      vel.y = 0;
    }
  }
}

function applyAxis(pos: THREE.Vector3, axis: 'x' | 'y' | 'z', amount: number): void {
  pos[axis] += amount;
}
