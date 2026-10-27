import { Vector3 } from 'three';
import { ColliderFlags, circleOverlapsRect, type Collider, type CollisionWorld } from '../world/CollisionWorld.ts';
import { PlayerConfig as C } from './PlayerConfig.ts';

/** A wall/obstacle the body was pushed away from during the last move. */
export interface Contact {
  nx: number;
  nz: number;
  collider: Collider;
}

/** The player's collision volume: a vertical cylinder standing on `pos` (feet centre). */
export class KinematicBody {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  radius: number = C.RADIUS;
  height: number = C.STAND_HEIGHT;
  grounded = false;
  groundCollider: Collider | null = null;
  hitCeiling = false;
  /** Net vertical pop from step-ups / snaps in the last move (the camera smooths it out). */
  stepOffset = 0;
  contacts: Contact[] = [];
  contactCount = 0;
}

export interface MoveOptions {
  /** Max height of geometry the body may step onto instead of being blocked (0 = none). */
  stepHeight: number;
  /** Stick to the ground when walking down small steps. */
  snapDown: boolean;
}

/** Longest distance moved in one collision sub-step. Thinner than any wall or floor. */
const MAX_STEP_DIST = 0.12;
const MAX_SUBSTEPS = 24;
/** Tolerance for "was above the surface before moving" when landing. */
const LAND_EPS = 0.05;
const Y_EPS = 0.002;
const SKIN = 0.001;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Kinematic character mover.
 *
 * Each fixed step is split into small sub-steps (so even 45 m/s falls never skip a floor);
 * every sub-step moves vertically first (landing / ceiling bumps), then horizontally
 * (circle-vs-box push-out, with automatic step-up onto low geometry).
 */
export class PlayerPhysics {
  readonly world: CollisionWorld;
  private readonly listA: Collider[] = [];
  private readonly listB: Collider[] = [];
  private readonly listC: Collider[] = [];

  constructor(world: CollisionWorld) {
    this.world = world;
  }

  move(body: KinematicBody, dt: number, opts: MoveOptions): void {
    const wasGrounded = body.grounded;
    body.grounded = false;
    body.groundCollider = null;
    body.hitCeiling = false;
    body.stepOffset = 0;
    body.contactCount = 0;

    const horiz = Math.hypot(body.vel.x, body.vel.z) * dt;
    const vert = Math.abs(body.vel.y) * dt;
    const steps = clamp(Math.ceil(Math.max(horiz, vert) / MAX_STEP_DIST), 1, MAX_SUBSTEPS);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.moveVertical(body, body.vel.y * h);
      this.moveHorizontal(body, body.vel.x * h, body.vel.z * h, opts.stepHeight);
    }

    if (!body.grounded && opts.snapDown && wasGrounded && body.vel.y <= 0.01) this.snapDown(body);
  }

  private moveVertical(b: KinematicBody, dy: number): void {
    if (dy === 0) return;
    const prevY = b.pos.y;
    b.pos.y += dy;
    // Slightly thinner than the body so walls we are touching don't count as floor/ceiling.
    const r = b.radius - 0.015;
    const lo = Math.min(prevY, b.pos.y);
    const hi = Math.max(prevY, b.pos.y) + b.height;
    const list = this.world.query(b.pos.x - r, lo, b.pos.z - r, b.pos.x + r, hi, b.pos.z + r, this.listA);
    for (const c of list) {
      if (!circleOverlapsRect(b.pos.x, b.pos.z, r, c)) continue;
      if (dy < 0) {
        // Falling: land on any surface we were above at the start of this sub-step.
        if (prevY >= c.maxY - LAND_EPS && b.pos.y < c.maxY) {
          b.pos.y = c.maxY;
          if (b.vel.y < 0) b.vel.y = 0;
          b.grounded = true;
          b.groundCollider = c;
        }
      } else {
        const prevTop = prevY + b.height;
        if (prevTop <= c.minY + LAND_EPS && b.pos.y + b.height > c.minY) {
          b.pos.y = c.minY - b.height;
          if (b.vel.y > 0) b.vel.y = 0;
          b.hitCeiling = true;
        }
      }
    }
  }

  private moveHorizontal(b: KinematicBody, dx: number, dz: number, stepHeight: number): void {
    b.pos.x += dx;
    b.pos.z += dz;
    const r = b.radius;
    for (let iter = 0; iter < 4; iter++) {
      let resolved = false;
      const list = this.world.query(
        b.pos.x - r, b.pos.y + Y_EPS, b.pos.z - r,
        b.pos.x + r, b.pos.y + b.height - Y_EPS, b.pos.z + r,
        this.listB,
      );
      for (const c of list) {
        if (b.pos.y >= c.maxY - Y_EPS || b.pos.y + b.height <= c.minY + Y_EPS) continue;
        const cx = clamp(b.pos.x, c.minX, c.maxX);
        const cz = clamp(b.pos.z, c.minZ, c.maxZ);
        const ox = b.pos.x - cx;
        const oz = b.pos.z - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= r * r) continue;

        // Low geometry: step up onto it instead of stopping dead.
        const rise = c.maxY - b.pos.y;
        if (
          stepHeight > 0 &&
          rise <= stepHeight &&
          !(c.flags & ColliderFlags.NO_STEP) &&
          this.fits(b.pos.x, c.maxY + Y_EPS, b.pos.z, r - 0.02, b.height)
        ) {
          b.pos.y = c.maxY;
          b.stepOffset += rise;
          // While rising (mid-jump) just lift over the corner and keep the jump going.
          if (b.vel.y <= 0) {
            b.grounded = true;
            b.groundCollider = c;
            b.vel.y = 0;
          }
          resolved = true;
          continue;
        }

        let nx: number;
        let nz: number;
        let push: number;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          nx = ox / d;
          nz = oz / d;
          push = r - d;
        } else {
          // Centre inside the footprint (only after teleports): leave through the nearest side.
          const left = b.pos.x - c.minX;
          const right = c.maxX - b.pos.x;
          const back = b.pos.z - c.minZ;
          const front = c.maxZ - b.pos.z;
          const m = Math.min(left, right, back, front);
          if (m === left) { nx = -1; nz = 0; push = left + r; }
          else if (m === right) { nx = 1; nz = 0; push = right + r; }
          else if (m === back) { nx = 0; nz = -1; push = back + r; }
          else { nx = 0; nz = 1; push = front + r; }
        }
        b.pos.x += nx * (push + SKIN);
        b.pos.z += nz * (push + SKIN);
        const vn = b.vel.x * nx + b.vel.z * nz;
        if (vn < 0) {
          b.vel.x -= nx * vn;
          b.vel.z -= nz * vn;
        }
        this.addContact(b, nx, nz, c);
        resolved = true;
      }
      if (!resolved) break;
    }
  }

  private addContact(b: KinematicBody, nx: number, nz: number, c: Collider): void {
    if (b.contactCount < b.contacts.length) {
      const ct = b.contacts[b.contactCount];
      ct.nx = nx;
      ct.nz = nz;
      ct.collider = c;
    } else {
      b.contacts.push({ nx, nz, collider: c });
    }
    b.contactCount++;
  }

  private snapDown(b: KinematicBody): void {
    const r = b.radius - 0.015;
    const top = this.world.supportTop(b.pos.x, b.pos.z, r, b.pos.y + Y_EPS, b.pos.y - C.SNAP_DOWN);
    if (top === -Infinity) return;
    if (!this.fits(b.pos.x, top + Y_EPS, b.pos.z, r, b.height)) return;
    b.stepOffset -= b.pos.y - top;
    b.pos.y = top;
    b.grounded = true;
    b.vel.y = 0;
  }

  /** True if a cylinder of the given size overlaps no geometry. */
  fits(x: number, y: number, z: number, radius: number, height: number): boolean {
    const list = this.world.query(x - radius, y, z - radius, x + radius, y + height, z + radius, this.listC);
    for (const c of list) {
      if (y >= c.maxY - Y_EPS || y + height <= c.minY + Y_EPS) continue;
      if (circleOverlapsRect(x, z, radius, c)) return false;
    }
    return true;
  }

  /** Pushes the body out of anything it overlaps (used after scripted moves and teleports). */
  depenetrate(b: KinematicBody): void {
    this.moveHorizontal(b, 0, 0, 0);
  }
}
