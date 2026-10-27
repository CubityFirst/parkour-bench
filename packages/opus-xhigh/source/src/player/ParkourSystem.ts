import { Vector3 } from 'three';
import type { Collider, CollisionWorld } from '../world/CollisionWorld';
import { MOVE } from './MovementConfig';
import type { PlayerPhysics } from './PlayerPhysics';

/** A wall the player can run along. */
export interface WallContact {
  /** -1 = wall on the player's left, +1 = wall on the right (relative to the run direction). */
  side: -1 | 1;
  /** Horizontal unit normal pointing out of the wall, toward the player. */
  normal: Vector3;
  /** Horizontal unit direction along the wall, in the direction of travel. */
  tangent: Vector3;
  collider: Collider;
  /** Identifies the wall plane, used to stop players re-running the same wall. */
  key: string;
}

export interface LedgeInfo {
  top: number;
  /** Feet position on top of the ledge after the mantle. */
  target: Vector3;
  /** Horizontal distance from the player centre to the ledge face. */
  faceDistance: number;
}

export interface VaultInfo {
  /** Height of the obstacle top above the player's feet. */
  rise: number;
  /** Horizontal distance (along dir) from the player centre to the near face. */
  nearDistance: number;
  /** Horizontal distance from the player centre to the far face. */
  farDistance: number;
  /** True when there is ground just beyond the obstacle (not a roof edge). */
  groundBeyond: boolean;
}

/**
 * A short scripted movement (vault or mantle). The player's position follows
 * an analytic path for a fraction of a second, then normal physics resumes.
 *
 * Path: during the "rise" phase the player lifts to clearance height while
 * creeping toward the obstacle; then it crosses horizontally at constant
 * speed. Because horizontal progress never passes the obstacle's near face
 * before clearance height is reached, the path cannot cut through it.
 */
export class TraversalMove {
  readonly start = new Vector3();
  readonly dir = new Vector3();
  time = 0;
  readonly duration: number;

  constructor(
    readonly kind: 'vault' | 'mantle',
    start: Vector3,
    dir: Vector3,
    /** Horizontal distance covered during the rise phase. */
    readonly riseDistance: number,
    /** Total horizontal distance of the move. */
    readonly totalDistance: number,
    /** Absolute Y of the feet at clearance height. */
    readonly clearY: number,
    readonly riseTime: number,
    readonly crossSpeed: number,
    /** Speed to continue with after the move ends. */
    readonly exitSpeed: number,
  ) {
    this.start.copy(start);
    this.dir.copy(dir);
    this.duration = riseTime + Math.max(0, totalDistance - riseDistance) / crossSpeed;
  }

  get progress(): number {
    return Math.min(1, this.time / this.duration);
  }

  get finished(): boolean {
    return this.time >= this.duration;
  }

  sample(t: number, out: Vector3): Vector3 {
    let horizontal: number;
    let y: number;
    if (t < this.riseTime) {
      const k = t / this.riseTime;
      horizontal = this.riseDistance * k;
      const e = this.kind === 'vault' ? 1 - (1 - k) * (1 - k) : k * k * (3 - 2 * k);
      y = this.start.y + (this.clearY - this.start.y) * e;
    } else {
      horizontal = Math.min(this.totalDistance, this.riseDistance + (t - this.riseTime) * this.crossSpeed);
      y = this.clearY;
    }
    out.set(this.start.x + this.dir.x * horizontal, y, this.start.z + this.dir.z * horizontal);
    return out;
  }
}

const _surface = { blocked: false };

/**
 * Environment queries for parkour moves: wall detection for wall-running,
 * ledge detection for mantling and obstacle detection for vaulting.
 */
export class ParkourSystem {
  constructor(
    private readonly world: CollisionWorld,
    private readonly physics: PlayerPhysics,
  ) {}

  /**
   * Looks for a tall vertical surface beside the player, on the left or right
   * of `moveDir`. If `onlySide` is given only that side is checked.
   */
  findWall(pos: Vector3, height: number, moveDir: Vector3, onlySide: -1 | 1 | 0 = 0): WallContact | null {
    // Right-hand vector of the move direction (looking along moveDir, +Y up).
    const rx = -moveDir.z;
    const rz = moveDir.x;
    const reach = MOVE.HALF_WIDTH + MOVE.WALLRUN_PROBE;
    const lowY = pos.y + 0.35;
    const highY = pos.y + Math.min(height - 0.15, 1.55);

    let best: WallContact | null = null;
    let bestDist = Infinity;
    for (const side of [-1, 1] as const) {
      if (onlySide !== 0 && side !== onlySide) continue;
      const px = pos.x + rx * side * reach;
      const pz = pos.z + rz * side * reach;
      const c = this.world.pointInside(px, lowY, pz);
      if (!c) continue;
      // The wall must also be tall enough to run on (covers head height).
      if (!this.world.pointInside(px, highY, pz)) continue;

      // Which face of the box is the player beside?
      const outX = Math.max(c.min[0] - pos.x, 0, pos.x - c.max[0]);
      const outZ = Math.max(c.min[2] - pos.z, 0, pos.z - c.max[2]);
      if (outX <= 0 && outZ <= 0) continue; // above/inside the box — not a wall
      const normal = new Vector3();
      let key: string;
      let dist: number;
      if (outX >= outZ) {
        const s = pos.x > c.max[0] ? 1 : -1;
        normal.set(s, 0, 0);
        key = `x${s}:${(s > 0 ? c.max[0] : c.min[0]).toFixed(2)}`;
        dist = outX;
      } else {
        const s = pos.z > c.max[2] ? 1 : -1;
        normal.set(0, 0, s);
        key = `z${s}:${(s > 0 ? c.max[2] : c.min[2]).toFixed(2)}`;
        dist = outZ;
      }
      if (dist - MOVE.HALF_WIDTH > MOVE.WALLRUN_PROBE + 0.01) continue;

      // Running mostly into the wall is not a wall run.
      const into = moveDir.x * normal.x + moveDir.z * normal.z;
      if (Math.abs(into) > 0.8) continue;
      const tangent = new Vector3(moveDir.x - normal.x * into, 0, moveDir.z - normal.z * into);
      if (tangent.lengthSq() < 1e-6) continue;
      tangent.normalize();

      if (dist < bestDist) {
        bestDist = dist;
        best = { side, normal, tangent, collider: c, key };
      }
    }
    return best;
  }

  /**
   * Finds a ledge in front of the player whose top is between `minRise` and
   * `maxRise` above the feet, with room to stand on it.
   */
  findLedge(pos: Vector3, dir: Vector3, minRise: number, maxRise: number): LedgeInfo | null {
    const hw = MOVE.HALF_WIDTH;
    const fromY = pos.y + maxRise + 0.05;
    for (const d of [hw + 0.12, hw + 0.3, hw + 0.48]) {
      const px = pos.x + dir.x * d;
      const pz = pos.z + dir.z * d;
      const hit = this.world.surfaceBelow(px, pz, fromY, maxRise + 0.05 - minRise, _surface);
      if (_surface.blocked) return null; // wall continues above our reach
      if (!hit) continue;

      const top = hit.y;
      const face = this.faceDistance(pos, dir, hit.collider);
      if (face === null || face <= 0.01) continue;

      // Stand fully on the top, a little past the edge (AABB extent along a diagonal is larger).
      const extent = hw * (Math.abs(dir.x) + Math.abs(dir.z));
      const along = Math.max(face + extent + 0.1, d);
      const target = new Vector3(pos.x + dir.x * along, top, pos.z + dir.z * along);

      // The surface beyond the edge may be a little lower (a parapet with a roof behind it).
      const groundAtTarget = this.world.surfaceBelow(target.x, target.z, top + 0.05, 0.9);
      if (!groundAtTarget) continue;
      target.y = groundAtTarget.y + 0.001;

      // Room to stand at the target, and a clear path: straight up, then forward.
      if (!this.physics.isFree(target, MOVE.STAND_HEIGHT) && !this.physics.isFree(target, MOVE.CROUCH_HEIGHT)) continue;
      const liftTop = top + MOVE.CROUCH_HEIGHT;
      if (!this.physics.isBoxFree(pos.x - hw + 0.01, pos.y + 0.01, pos.z - hw + 0.01, pos.x + hw - 0.01, liftTop, pos.z + hw - 0.01)) {
        return null;
      }
      const minX = Math.min(pos.x, target.x) - hw + 0.01;
      const maxX = Math.max(pos.x, target.x) + hw - 0.01;
      const minZ = Math.min(pos.z, target.z) - hw + 0.01;
      const maxZ = Math.max(pos.z, target.z) + hw - 0.01;
      if (!this.physics.isBoxFree(minX, top + 0.01, minZ, maxX, liftTop, maxZ)) continue;

      return { top, target, faceDistance: face };
    }
    return null;
  }

  /**
   * Marches forward looking for a low obstacle (between VAULT_MIN_HEIGHT and
   * VAULT_MAX_HEIGHT) that is thin enough to vault over.
   */
  findVault(pos: Vector3, dir: Vector3, reach: number): VaultInfo | null {
    const hw = MOVE.HALF_WIDTH;
    const step = 0.08;
    const fromY = pos.y + MOVE.VAULT_MAX_HEIGHT + 0.05;
    const maxT = hw + reach + MOVE.VAULT_MAX_DEPTH + 0.3;
    let near = -1;
    let far = -1;
    let rise = 0;
    for (let t = hw * 0.5; t <= maxT; t += step) {
      const px = pos.x + dir.x * t;
      const pz = pos.z + dir.z * t;
      const hit = this.world.surfaceBelow(px, pz, fromY, MOVE.VAULT_MAX_HEIGHT + 1.5, _surface);
      if (_surface.blocked) {
        // Something taller than a vault obstacle is in the way.
        if (near < 0 && t > hw + reach) break;
        return null;
      }
      const h = hit ? hit.y - pos.y : -Infinity;
      if (near < 0) {
        if (t > hw + reach) break;
        if (h >= MOVE.VAULT_MIN_HEIGHT) {
          near = t;
          rise = h;
        }
      } else if (h >= MOVE.VAULT_MIN_HEIGHT) {
        rise = Math.max(rise, h);
        if (t - near > MOVE.VAULT_MAX_DEPTH) return null; // too deep — it's a platform
      } else {
        far = t;
        break;
      }
    }
    if (near < 0 || far < 0) return null;

    // Is there ground beyond, roughly at our level?
    const landT = far + hw + 0.3;
    const lx = pos.x + dir.x * landT;
    const lz = pos.z + dir.z * landT;
    const ground = this.world.surfaceBelow(lx, lz, pos.y + MOVE.VAULT_MIN_HEIGHT, 1.2);
    return {
      rise,
      nearDistance: Math.max(0, near - step),
      farDistance: far,
      groundBeyond: ground !== null,
    };
  }

  /** Validates a traversal path by sampling the player box along it. */
  pathIsClear(move: TraversalMove, boxHeight: number): boolean {
    const p = new Vector3();
    const samples = 10;
    for (let i = 1; i <= samples; i++) {
      move.sample((move.duration * i) / samples, p);
      if (!this.physics.isFree(p, boxHeight, MOVE.HALF_WIDTH - 0.04)) return false;
    }
    return true;
  }

  /** Horizontal distance along `dir` from `pos` to where the ray enters the collider's footprint. */
  private faceDistance(pos: Vector3, dir: Vector3, c: Collider): number | null {
    let tMin = 0;
    let tMax = Infinity;
    const o = [pos.x, pos.z];
    const d = [dir.x, dir.z];
    const mn = [c.min[0], c.min[2]];
    const mx = [c.max[0], c.max[2]];
    for (let i = 0; i < 2; i++) {
      if (Math.abs(d[i]) < 1e-8) {
        if (o[i] < mn[i] || o[i] > mx[i]) return null;
      } else {
        let t1 = (mn[i] - o[i]) / d[i];
        let t2 = (mx[i] - o[i]) / d[i];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
      }
    }
    return tMin;
  }
}
