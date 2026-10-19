import { CollisionWorld, EPS, overlaps } from '../world/CollisionWorld.ts';
import type { AABB, Solid } from '../world/CollisionWorld.ts';

export const PLAYER_RADIUS = 0.35;
export const STAND_HEIGHT = 1.8;
export const SLIDE_HEIGHT = 0.9;

/** Ledges up to this tall are climbed automatically while walking (curbs, pipes, rooftop lips). */
const STEP_HEIGHT = 0.32;
/** Largest distance travelled per collision sub-step; far smaller than the thinnest solid + player. */
const MAX_SUBSTEP = 0.12;
/** How far we will snap down to stay glued to descending steps. */
const SNAP_DOWN = 0.3;

export interface MoveResult {
  hitX: boolean;
  hitZ: boolean;
  hitCeiling: boolean;
  landed: boolean;
  /** Downward speed at the moment of landing (positive number). */
  landImpact: number;
  /** Total height gained from automatic step-ups this tick (for camera smoothing). */
  stepUp: number;
}

/**
 * Kinematic AABB character body. The controller owns velocity; this class integrates it with
 * swept (sub-stepped) per-axis collision so even 16 m/s movement cannot tunnel through geometry.
 *
 * Position is the centre of the feet. The collision box is a square prism of half-width
 * PLAYER_RADIUS and the current height.
 */
export class PlayerPhysics {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  height = STAND_HEIGHT;
  grounded = false;

  readonly result: MoveResult = {
    hitX: false,
    hitZ: false,
    hitCeiling: false,
    landed: false,
    landImpact: 0,
    stepUp: 0,
  };

  private readonly hits: Solid[] = [];
  private readonly box: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  private canStep = false;

  readonly world: CollisionWorld;

  constructor(world: CollisionWorld) {
    this.world = world;
  }

  /** Writes the player's current AABB into `out` (or an internal scratch box). */
  aabb(out: AABB = this.box): AABB {
    out.minX = this.x - PLAYER_RADIUS;
    out.maxX = this.x + PLAYER_RADIUS;
    out.minZ = this.z - PLAYER_RADIUS;
    out.maxZ = this.z + PLAYER_RADIUS;
    out.minY = this.y;
    out.maxY = this.y + this.height;
    return out;
  }

  /** Whether a player-sized box of `height` placed at (x, y, z) would be free of solids. */
  isFreeAt(x: number, y: number, z: number, height: number, shrink = 0): boolean {
    const b = this.scratchBox;
    const r = PLAYER_RADIUS - shrink;
    b.minX = x - r;
    b.maxX = x + r;
    b.minZ = z - r;
    b.maxZ = z + r;
    b.minY = y;
    b.maxY = y + height;
    return !this.world.intersectsAny(b);
  }
  private readonly scratchBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  /** Is there room to stand up at the current position? */
  canStand(): boolean {
    return this.isFreeAt(this.x, this.y, this.z, STAND_HEIGHT);
  }

  teleport(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.height = STAND_HEIGHT;
    this.grounded = false;
  }

  /** Recomputes `grounded` from geometry (used after scripted moves such as vaulting). */
  settle(): void {
    this.grounded = this.vy <= 0.01 && !this.isFreeAt(this.x, this.y - 0.03, this.z, 0.03);
  }

  /** Integrates velocity over `dt` with collision. */
  step(dt: number): MoveResult {
    const res = this.result;
    res.hitX = res.hitZ = res.hitCeiling = res.landed = false;
    res.landImpact = 0;
    res.stepUp = 0;

    const wasGrounded = this.grounded;
    this.canStep = wasGrounded;

    const dist = Math.max(Math.abs(this.vx), Math.abs(this.vy), Math.abs(this.vz)) * dt;
    const n = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
    const h = dt / n;

    for (let i = 0; i < n; i++) {
      this.x += this.vx * h;
      this.resolveHorizontal(0, res);
      this.z += this.vz * h;
      this.resolveHorizontal(1, res);
      const prevY = this.y;
      this.y += this.vy * h;
      this.resolveVertical(prevY, res);
      if (res.landed) this.canStep = true;
    }

    this.fixPenetration();

    // Glue to the ground when walking down small steps / off curbs.
    if (wasGrounded && this.vy <= 0.01 && this.isFreeAt(this.x, this.y - 0.03, this.z, 0.03)) {
      const below = this.world.groundBelow(this.x, this.z, PLAYER_RADIUS, this.y, SNAP_DOWN);
      if (below !== null && below < this.y - EPS) {
        res.stepUp -= this.y - below;
        this.y = below;
        this.vy = 0;
      }
    }

    this.grounded = this.vy <= 0.01 && !this.isFreeAt(this.x, this.y - 0.03, this.z, 0.03);
    return res;
  }

  private resolveHorizontal(axis: 0 | 1, res: MoveResult): void {
    const box = this.aabb();
    const hits = this.world.query(box, this.hits);
    if (hits.length === 0) return;
    for (let i = 0; i < hits.length; i++) {
      const s = hits[i];
      if (!overlaps(this.aabb(), s)) continue;

      // Auto step-up onto low ledges.
      if (this.canStep && this.vy <= 0.5) {
        const rise = s.maxY - this.y;
        if (rise > EPS && rise <= STEP_HEIGHT && this.isFreeAt(this.x, s.maxY, this.z, this.height)) {
          res.stepUp += rise;
          this.y = s.maxY;
          continue;
        }
      }

      if (axis === 0) {
        if (this.vx > 0) this.x = s.minX - PLAYER_RADIUS;
        else if (this.vx < 0) this.x = s.maxX + PLAYER_RADIUS;
        else this.x = this.x < (s.minX + s.maxX) / 2 ? s.minX - PLAYER_RADIUS : s.maxX + PLAYER_RADIUS;
        this.vx = 0;
        res.hitX = true;
      } else {
        if (this.vz > 0) this.z = s.minZ - PLAYER_RADIUS;
        else if (this.vz < 0) this.z = s.maxZ + PLAYER_RADIUS;
        else this.z = this.z < (s.minZ + s.maxZ) / 2 ? s.minZ - PLAYER_RADIUS : s.maxZ + PLAYER_RADIUS;
        this.vz = 0;
        res.hitZ = true;
      }
    }
  }

  private resolveVertical(prevY: number, res: MoveResult): void {
    const hits = this.world.query(this.aabb(), this.hits);
    for (let i = 0; i < hits.length; i++) {
      const s = hits[i];
      if (!overlaps(this.aabb(), s)) continue;
      if (this.vy <= 0) {
        // Only treat as a floor if we were above its top before this move (not a side overlap).
        if (prevY >= s.maxY - 0.05) {
          const impact = -this.vy;
          if (impact > res.landImpact) res.landImpact = impact;
          res.landed = true;
          this.y = s.maxY;
          this.vy = 0;
        }
      } else if (prevY + this.height <= s.minY + 0.05) {
        this.y = s.minY - this.height;
        this.vy = 0;
        res.hitCeiling = true;
      }
    }
  }

  /** Last-resort depenetration along the axis of least penetration (should be very rare). */
  private fixPenetration(): void {
    for (let iter = 0; iter < 3; iter++) {
      const hits = this.world.query(this.aabb(), this.hits);
      if (hits.length === 0) return;
      const s = hits[0];
      const b = this.aabb();
      const pxPos = s.maxX - b.minX; // push +x
      const pxNeg = b.maxX - s.minX; // push -x
      const pzPos = s.maxZ - b.minZ;
      const pzNeg = b.maxZ - s.minZ;
      const pyUp = s.maxY - b.minY;
      const pyDown = b.maxY - s.minY;
      const m = Math.min(pxPos, pxNeg, pzPos, pzNeg, pyUp, pyDown);
      if (m === pxPos) this.x += pxPos;
      else if (m === pxNeg) this.x -= pxNeg;
      else if (m === pzPos) this.z += pzPos;
      else if (m === pzNeg) this.z -= pzNeg;
      else if (m === pyUp) {
        this.y += pyUp;
        if (this.vy < 0) this.vy = 0;
      } else {
        this.y -= pyDown;
        if (this.vy > 0) this.vy = 0;
      }
    }
  }
}
