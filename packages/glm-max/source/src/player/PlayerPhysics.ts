import * as THREE from 'three';
import { CollisionWorld, Collider, Contact } from '../world/CollisionWorld';

/**
 * PlayerPhysics — custom AABB "capsule" mover against a static AABB world.
 *
 * The player body is an axis-aligned box (half width, height) anchored at its
 * feet. Movement is resolved axis by axis (X, Z, then Y) inside substeps so
 * fast motion cannot tunnel through geometry. Grounded state is detected from
 * downward blocks plus a small "sticky ground" probe so that walking down tiny
 * steps stays smooth. Blocked horizontal moves while grounded can trigger a
 * small automatic step-up.
 */

export const PLAYER_HALF_W = 0.36;
export const PLAYER_STAND_H = 1.8;
export const PLAYER_SLIDE_H = 0.95;

const SKIN = 0.002;
const STEP_HEIGHT = 0.45;
const MAX_SUBSTEP = 0.3;
const STICKY_DOWN = 0.17;

interface AxisBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export class PlayerPhysics {
  /** Feet position. */
  pos = new THREE.Vector3(0, 24, 4);
  vel = new THREE.Vector3();

  height = PLAYER_STAND_H;
  halfW = PLAYER_HALF_W;

  grounded = false;
  groundCollider: Collider | null = null;

  /** Most recent wall/ceiling contact from the last move (computed per axis). */
  wallContact: Contact | null = null;
  /** Impact speed when the ground was hit during this move (>0 = landing). */
  landedImpact = 0;
  bumpedHead = false;
  /** Total height gained by automatic step-ups during this move. */
  steppedUp = 0;

  /** Optional hooks (set by PlayerController). */
  onLanded?: (impactSpeed: number) => void;
  onStepUp?: (height: number) => void;

  private scratchColliders: Collider[] = [];
  private box: AxisBox = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  constructor(private collision: CollisionWorld) {}

  setHeight(h: number): void {
    this.height = h;
  }

  teleport(pos: THREE.Vector3, vel: THREE.Vector3 | null, height: number): void {
    this.pos.copy(pos);
    if (vel) this.vel.copy(vel); else this.vel.set(0, 0, 0);
    this.height = height;
    this.grounded = false;
    this.groundCollider = null;
    this.wallContact = null;
    this.landedImpact = 0;
    this.steppedUp = 0;
  }

  getHeight(): number {
    return this.height;
  }

  getHeadY(): number {
    return this.pos.y + this.height;
  }

  /** True if the body can occupy `height` at the current position. */
  canStandAtHeight(height: number): boolean {
    const p = this.pos;
    return !this.collision.isBlocked(
      p.x - this.halfW + 0.02, p.y + SKIN, p.z - this.halfW + 0.02,
      p.x + this.halfW - 0.02, p.y + height - SKIN, p.z + this.halfW - 0.02
    );
  }

  /** True if the body (with a small margin shrunk) is intersecting anything. */
  isTouching(): boolean {
    const p = this.pos;
    const m = 0.02;
    return this.collision.isBlocked(
      p.x - this.halfW + m, p.y + m, p.z - this.halfW + m,
      p.x + this.halfW - m, p.y + this.height - m, p.z + this.halfW - m
    );
  }

  /**
   * Returns all colliders overlapping a box built from feet position, size and height.
   */
  overlapsAt(feet: THREE.Vector3, height: number, out: Collider[] = this.scratchColliders): Collider[] {
    this.collision.overlaps(
      feet.x - this.halfW, feet.y, feet.z - this.halfW,
      feet.x + this.halfW, feet.y + height, feet.z + this.halfW,
      out
    );
    return out;
  }

  /**
   * Fixed-step move: axis-separated sweeps with substepping, step-up and
   * sticky-ground handling. Modifies pos/vel in place.
   */
  move(dt: number): void {
    const dispLen = _tmpVec1.copy(this.vel).multiplyScalar(dt).length();
    const steps = Math.min(10, Math.max(1, Math.ceil(dispLen / MAX_SUBSTEP)));
    const sx = (this.vel.x * dt) / steps;
    const sy = (this.vel.y * dt) / steps;
    const sz = (this.vel.z * dt) / steps;

    this.wallContact = null;
    this.landedImpact = 0;
    this.bumpedHead = false;
    this.steppedUp = 0;

    let stepGrounded = false;
    let stepGroundCollider: Collider | null = null;
    const wasGrounded = this.grounded;

    for (let i = 0; i < steps; i++) {
      this.tryHorizontal('x', sx);
      this.tryHorizontal('z', sz);

      // Vertical: any downward clamp counts as grounding (flush-stationary
      // stands included — Applied deltas can be near zero when the body rests
      // exactly on the surface).
      const vyStep = this.vel.y;
      const blockedY = this.moveAxis('y', sy);
      if (sy < 0 && blockedY) {
        stepGrounded = true;
        stepGroundCollider = this.groundCollider;
        if (vyStep < -3.5) this.landedImpact = Math.max(this.landedImpact, -vyStep);
      }
      // upward blocks (head bumps) are handled inside moveAxis
    }

    // Sticky ground: smooths stepping down over small lips.
    if (!stepGrounded && wasGrounded && this.vel.y <= 0.01) {
      const g = this.findGroundBelow(STICKY_DOWN);
      if (g.collider) {
        this.pos.y = g.collider.maxY;
        this.vel.y = 0;
        stepGrounded = true;
        stepGroundCollider = g.collider;
      }
    }

    this.grounded = stepGrounded;
    this.groundCollider = stepGrounded ? stepGroundCollider : null;

    if (this.landedImpact > 0 && !wasGrounded && this.onLanded) {
      this.onLanded(this.landedImpact);
    }
  }

  /** Horizontal move with automatic step-up when grounded. */
  private tryHorizontal(axis: 'x' | 'z', amount: number): void {
    if (amount === 0) return;
    const before = axis === 'x' ? this.pos.x : this.pos.z;
    this.moveAxis(axis, amount);
    const applied = (axis === 'x' ? this.pos.x : this.pos.z) - before;
    const blocked = Math.abs(applied - amount) > SKIN;
    if (blocked && this.grounded) {
      this.attemptStepUp(axis, amount, before);
    }
  }

  /**
   * When a horizontal move is blocked and we are standing on the ground,
   * try to lift the body by up to STEP_HEIGHT, redo the move and settle back
   * down onto whatever surface is there.
   */
  private attemptStepUp(axis: 'x' | 'z', amount: number, blockedPos: number): void {
    const startX = this.pos.x, startY = this.pos.y, startZ = this.pos.z;
    void blockedPos;

    // Lift in slices so low ceilings stop the lift.
    let lift = 0;
    const slice = 0.15;
    while (lift < STEP_HEIGHT) {
      const next = Math.min(STEP_HEIGHT, lift + slice);
      this.pos.y = startY + next;
      if (this.isTouching()) { this.pos.y = startY; lift = 0; break; }
      lift = next;
    }
    if (lift <= SKIN) {
      this.pos.x = startX; this.pos.y = startY; this.pos.z = startZ;
      return;
    }

    // Retry horizontal move at the lifted position.
    const before = axis === 'x' ? this.pos.x : this.pos.z;
    this.moveAxis(axis, amount);
    const applied = (axis === 'x' ? this.pos.x : this.pos.z) - before;
    const movedEnough = Math.abs(applied) > 0.04;

    // Find ground beneath the lifted body (within lift height).
    if (movedEnough) {
      const g = this.findGroundBelow(lift + 0.06);
      if (g.collider) {
        this.pos.y = g.collider.maxY;
        this.vel.y = Math.min(this.vel.y, 0);
        this.steppedUp += lift;
        if (this.onStepUp && lift > 0.03) this.onStepUp(lift);
        return;
      }
    }

    // Revert.
    this.pos.x = startX; this.pos.y = startY; this.pos.z = startZ;
  }

  /**
   * Core axis move: translate along `axis`, then clamp to the nearest
   * blocking face of any collider the body now overlaps.
   * Returns true when the movement was clamped by a collider.
   */
  private moveAxis(axis: 'x' | 'y' | 'z', amount: number): boolean {
    if (amount === 0) return false;
    const p = this.pos;
    const dir = Math.sign(amount);

    if (axis === 'x') p.x += amount;
    else if (axis === 'y') p.y += amount;
    else p.z += amount;

    const b = this.bodyBox();
    const list = this.collision.colliders;

    let bestFace: number | null = null;
    let bestCollider: Collider | null = null;

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (
        b.minX < c.maxX && b.maxX > c.minX &&
        b.minY < c.maxY && b.maxY > c.minY &&
        b.minZ < c.maxZ && b.maxZ > c.minZ
      ) {
        // Overlap found — compute face the body would be clamped to.
        let face: number;
        if (axis === 'x') face = dir > 0 ? c.minX - this.halfW - SKIN : c.maxX + this.halfW + SKIN;
        else if (axis === 'y') face = dir > 0 ? c.minY - this.height - SKIN : c.maxY;
        else face = dir > 0 ? c.minZ - this.halfW - SKIN : c.maxZ + this.halfW + SKIN;

        if (bestFace === null || (dir > 0 ? face < bestFace : face > bestFace)) {
          bestFace = face;
          bestCollider = c;
        }
      }
    }

    if (bestFace !== null && bestCollider !== null) {
      if (axis === 'x') p.x = bestFace;
      else if (axis === 'y') p.y = bestFace;
      else p.z = bestFace;

      if (axis === 'y') {
        if (dir < 0) {
          this.groundCollider = bestCollider;
          this.vel.y = 0;
        } else {
          this.bumpedHead = true;
          this.vel.y = Math.min(this.vel.y, 0);
        }
      } else {
        // Record wall contact (normal points at the player).
        const nx = axis === 'x' ? -dir : 0;
        const nz = axis === 'z' ? -dir : 0;
        const wallHeight = bestCollider.maxY - this.pos.y;
        const c: Contact = { nx, ny: 0, nz, collider: bestCollider, wallHeight } as Contact;
        this.wallContact = c;
        if (axis === 'x') this.vel.x = 0;
        else this.vel.z = 0;
      }
      return true;
    }
    return false;
  }

  private bodyBox(): AxisBox {
    const p = this.pos;
    const b = this.box;
    b.minX = p.x - this.halfW;
    b.minY = p.y;
    b.minZ = p.z - this.halfW;
    b.maxX = p.x + this.halfW;
    b.maxY = p.y + this.height;
    b.maxZ = p.z + this.halfW;
    return b;
  }

  /**
   * Finds ground directly beneath the feet (up to `maxDown` depth) using the
   * body footprint. Returns the highest supporting collider.
   */
  findGroundBelow(maxDown: number): { collider: Collider | null; distance: number } {
    const p = this.pos;
    let bestCollider: Collider | null = null;
    let bestTop = -Infinity;
    const bottom = p.y - maxDown;
    const list = this.collision.colliders;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (
        p.x - this.halfW < c.maxX && p.x + this.halfW > c.minX &&
        p.z - this.halfW < c.maxZ && p.z + this.halfW > c.minZ &&
        c.maxY <= p.y + SKIN && c.maxY > bottom
      ) {
        if (c.maxY > bestTop) { bestTop = c.maxY; bestCollider = c; }
      }
    }
    if (!bestCollider) return { collider: null, distance: Infinity };
    return { collider: bestCollider, distance: p.y - bestCollider.maxY };
  }
}

const _tmpVec1 = new THREE.Vector3();
