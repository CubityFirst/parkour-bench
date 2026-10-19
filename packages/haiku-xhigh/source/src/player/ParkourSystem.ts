import { BoxCollider, CollisionWorld, EPS, Vec3 } from '../world/CollisionWorld';
import { PLAYER_RADIUS, PlayerPhysics, STAND_HEIGHT } from './PlayerPhysics';

/** How close to a wall face the body must be to latch onto it. */
const WALL_REACH = 0.45;
/** How far in front of the body the vault probe reaches. */
const VAULT_REACH = 0.6;
/** Max thickness of something the player may vault over (metres along the facing direction). */
const VAULT_MAX_DEPTH = 3;

/** A wall-run surface the body is currently beside. */
export interface WallRunContact {
  box: BoxCollider;
  /** Axis the wall face points along (the side the player is touching). */
  normalAxis: 'x' | 'z';
  /** Sign of the normal pointing from the wall toward the player. */
  normalSign: 1 | -1;
  /** Axis the player runs along, i.e. the wall's long axis. */
  tangentAxis: 'x' | 'z';
  /** Direction of travel along the wall. */
  tangentSign: 1 | -1;
}

export interface Transition {
  box: BoxCollider;
  /** Feet position the body should end at. */
  target: Vec3;
}

/**
 * Read-only queries that turn the world geometry into parkour opportunities.
 * It never moves the body; PlayerController decides what to do with the results.
 */
export class ParkourSystem {
  constructor(private readonly world: CollisionWorld) {}

  /**
   * Finds a wall-run surface beside the body that runs roughly in the body's direction of travel.
   * `minSpeed` is the horizontal speed the body must already have.
   */
  findWallRun(p: PlayerPhysics, exclude: BoxCollider | null, minSpeed: number): WallRunContact | null {
    const lo = p.bodyMin();
    const hi = p.bodyMax();
    const v = p.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < minSpeed) return null;

    for (const b of this.world.boxes) {
      if (!b.wallRun || b === exclude) continue;
      if (!(lo.y < b.max.y - EPS && hi.y > b.min.y + EPS)) continue;

      const longX = b.max.x - b.min.x;
      const longZ = b.max.z - b.min.z;

      // Walls that face along X are long in Z: the player runs along Z beside them.
      if (longZ > longX && lo.z < b.max.z - EPS && hi.z > b.min.z + EPS) {
        const contact = this.sideContact(b, 'x', lo.x, hi.x);
        if (contact && Math.abs(v.z) >= 0.6 * speed) {
          return { box: b, normalAxis: 'x', normalSign: contact, tangentAxis: 'z', tangentSign: v.z > 0 ? 1 : -1 };
        }
      }
      // Walls that face along Z are long in X.
      if (longX > longZ && lo.x < b.max.x - EPS && hi.x > b.min.x + EPS) {
        const contact = this.sideContact(b, 'z', lo.z, hi.z);
        if (contact && Math.abs(v.x) >= 0.6 * speed) {
          return { box: b, normalAxis: 'z', normalSign: contact, tangentAxis: 'x', tangentSign: v.x > 0 ? 1 : -1 };
        }
      }
    }
    return null;
  }

  /** Whether the body is still beside a wall-run surface it is already attached to. */
  isAlongside(p: PlayerPhysics, c: WallRunContact): boolean {
    const lo = p.bodyMin();
    const hi = p.bodyMax();
    const b = c.box;
    const gap = c.normalSign < 0 ? b.min[c.normalAxis] - hi[c.normalAxis] : lo[c.normalAxis] - b.max[c.normalAxis];
    if (gap < -EPS || gap > WALL_REACH + 0.05) return false;
    const t = c.tangentAxis;
    return lo.y < b.max.y - EPS && hi.y > b.min.y + EPS && lo[t] < b.max[t] - EPS && hi[t] > b.min[t] + EPS;
  }

  /** Pushes the body flush against the wall face so it does not drift during a wall run. */
  snapToWall(p: PlayerPhysics, c: WallRunContact): void {
    const b = c.box;
    if (c.normalAxis === 'x') {
      p.position.x = c.normalSign < 0 ? b.min.x - PLAYER_RADIUS : b.max.x + PLAYER_RADIUS;
    } else {
      p.position.z = c.normalSign < 0 ? b.min.z - PLAYER_RADIUS : b.max.z + PLAYER_RADIUS;
    }
  }

  /**
   * Finds a low vaultable obstacle directly in front of the body.
   * `fx`/`fz` is the normalised horizontal facing direction.
   */
  findVault(p: PlayerPhysics, fx: number, fz: number): Transition | null {
    const lo = p.bodyMin();
    const hi = p.bodyMax();
    const feet = p.position.y;
    let best: BoxCollider | null = null;
    let bestDist = Infinity;

    // Probe: the body footprint stretched forward by VAULT_REACH.
    const px0 = lo.x + Math.min(0, fx * VAULT_REACH);
    const px1 = hi.x + Math.max(0, fx * VAULT_REACH);
    const pz0 = lo.z + Math.min(0, fz * VAULT_REACH);
    const pz1 = hi.z + Math.max(0, fz * VAULT_REACH);

    for (const b of this.world.boxes) {
      if (!b.vaultable) continue;
      const topRel = b.max.y - feet;
      if (topRel < 0.2 || topRel > 1.3) continue;
      if (!(px0 < b.max.x - EPS && px1 > b.min.x + EPS && pz0 < b.max.z - EPS && pz1 > b.min.z + EPS)) continue;

      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      const dx = cx - p.position.x;
      const dz = cz - p.position.z;
      if (dx * fx + dz * fz <= 0) continue;
      const depth = Math.abs(fx) * (b.max.x - b.min.x) + Math.abs(fz) * (b.max.z - b.min.z);
      if (depth > VAULT_MAX_DEPTH) continue;

      const dist = Math.hypot(dx, dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    if (!best) return null;

    const hx = (best.max.x - best.min.x) / 2;
    const hz = (best.max.z - best.min.z) / 2;
    const offset = Math.abs(fx) * hx + Math.abs(fz) * hz + PLAYER_RADIUS + 0.35;
    const target = {
      x: (best.min.x + best.max.x) / 2 + fx * offset,
      y: best.max.y,
      z: (best.min.z + best.max.z) / 2 + fz * offset,
    };
    if (!p.fits(target.x, target.y, target.z, STAND_HEIGHT)) return null;
    return { box: best, target };
  }

  /**
   * If the airborne body just bumped into a climbable ledge whose top is within reach,
   * returns the standing position on top of it.
   */
  findMantle(p: PlayerPhysics): Transition | null {
    const hit = p.horizontalHit;
    if (!hit || !hit.box.climbable) return null;
    const b = hit.box;
    const rel = b.max.y - p.position.y;
    if (rel < 0.35 || rel > 1.75) return null;

    // Land a little way onto the top surface, clamped so the body stays over the box.
    let x = p.position.x;
    let z = p.position.z;
    const inset = PLAYER_RADIUS + 0.12;
    if (hit.axis === 'x') {
      x = hit.dir > 0 ? b.min.x + inset : b.max.x - inset;
      z = clamp(z, b.min.z + PLAYER_RADIUS, b.max.z - PLAYER_RADIUS);
    } else {
      z = hit.dir > 0 ? b.min.z + inset : b.max.z - inset;
      x = clamp(x, b.min.x + PLAYER_RADIUS, b.max.x - PLAYER_RADIUS);
    }
    if (!p.fits(x, b.max.y, z, STAND_HEIGHT)) return null;
    return { box: b, target: { x, y: b.max.y, z } };
  }

  /** Returns the side of a wall the body touches (+1 or -1), or 0 if no contact. */
  private sideContact(b: BoxCollider, axis: 'x' | 'z', lo: number, hi: number): 1 | -1 | 0 {
    // Wall on the positive side of the body: its min face is just past the body's max.
    if (b.min[axis] >= hi - EPS && b.min[axis] <= hi + WALL_REACH) return -1;
    // Wall on the negative side of the body: its max face is just before the body's min.
    if (b.max[axis] <= lo + EPS && b.max[axis] >= lo - WALL_REACH) return 1;
    return 0;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
