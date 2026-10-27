import { ColliderFlags, type Collider, type CollisionWorld } from '../world/CollisionWorld.ts';
import { PlayerConfig as C } from './PlayerConfig.ts';
import type { PlayerPhysics } from './PlayerPhysics.ts';

/** A planned vault over (or onto) a low obstacle. Distances are along (dirX, dirZ) from the start. */
export interface VaultPlan {
  dirX: number;
  dirZ: number;
  topY: number;
  /** Height the body travels at while over the obstacle. */
  clearY: number;
  /** Where the body starts overlapping the obstacle in plan view. */
  frontS: number;
  /** Where the body has fully passed the obstacle. */
  backS: number;
  endS: number;
  endY: number;
  /** True when there is ground to land on; false = vault into a drop (released mid-air). */
  landing: boolean;
  /** Obstacle deeper than a vault: the move ends standing on top of it. */
  onto: boolean;
}

/** A ledge the player can climb from their current position. */
export interface LedgePlan {
  dirX: number;
  dirZ: number;
  topY: number;
  /** Horizontal distance from the start to the standing spot on the ledge. */
  destS: number;
  /** Destination is under a low ceiling: finish the climb crouched. */
  crouch: boolean;
}

/** A runnable wall beside the player. (nx, nz) points out of the wall, towards the player. */
export interface WallProbe {
  nx: number;
  nz: number;
  dist: number;
  collider: Collider;
}

export interface ZiplineLine {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  dx: number; dy: number; dz: number;
  length: number;
}

export function makeZipline(a: readonly [number, number, number], b: readonly [number, number, number]): ZiplineLine {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz);
  return { ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], dx: dx / length, dy: dy / length, dz: dz / length, length };
}

/**
 * Geometry probes for every parkour move. All detection is done against the same box
 * world the physics uses, so a move is only ever offered when it can actually complete:
 * each plan validates clearance along its whole path before it is returned.
 */
export class ParkourSystem {
  private readonly world: CollisionWorld;
  private readonly physics: PlayerPhysics;

  constructor(world: CollisionWorld, physics: PlayerPhysics) {
    this.world = world;
    this.physics = physics;
  }

  /**
   * Looks for a low obstacle directly ahead (dir must be a unit vector).
   * @param requireLanding only accept vaults with ground on the far side (used for the jump key,
   *                       so pressing jump next to a parapet never throws the player off a roof).
   */
  findVault(px: number, py: number, pz: number, dirX: number, dirZ: number, speed: number, requireLanding: boolean): VaultPlan | null {
    const w = this.world;
    const r = C.RADIUS;
    // Reach grows with speed so a sprinting runner can commit to the vault a stride early.
    const reach = r + 0.5 + Math.min(1.7, speed * 0.17);

    let hitT = Infinity;
    let hitX = 0;
    let hitZ = 0;
    let hitNx = 0;
    let hitNz = 0;
    for (const hy of [0.3, 0.65, 1.0]) {
      const h = w.raycast(px, py + hy, pz, dirX, 0, dirZ, reach);
      if (h && h.t < hitT) {
        hitT = h.t;
        hitX = h.x;
        hitZ = h.z;
        hitNx = h.nx;
        hitNz = h.nz;
      }
    }
    if (hitT === Infinity) return null;
    // Must be facing the obstacle reasonably squarely.
    if (hitNx * dirX + hitNz * dirZ > -0.55) return null;

    const qx = hitX + dirX * 0.06;
    const qz = hitZ + dirZ * 0.06;
    const top = w.columnTop(qx, qz, py + C.VAULT_MIN_HEIGHT, py + C.VAULT_MAX_HEIGHT);
    if (top === -Infinity) return null;
    // Something directly above the obstacle top means it's a wall, not a vaultable block.
    if (!w.isColumnFree(qx, qz, top + 0.01, top + 1.7)) return null;

    // Measure how deep the obstacle is along the move direction.
    let depth = -1;
    for (let s = 0.1; s <= C.VAULT_MAX_DEPTH + 0.001; s += 0.1) {
      const x = qx + dirX * s;
      const z = qz + dirZ * s;
      const surface = w.columnTop(x, z, top - 0.25, top + 0.3);
      if (surface === -Infinity) {
        depth = s;
        break;
      }
      if (!w.isColumnFree(x, z, surface + 0.01, surface + 1.2)) return null;
    }

    const clearY = top + 0.06;
    const onto = depth < 0;
    const frontS = Math.max(0, hitT - r - 0.02);
    const backS = onto ? hitT + 0.06 + r + 0.25 : hitT + 0.06 + depth + r;
    const endS = onto ? backS : backS + 0.25;

    // Sweep a tucked body over the obstacle to make sure nothing blocks the vault.
    const tuck = 1.0;
    for (let s = frontS; s <= endS + 0.001; s += 0.2) {
      if (!this.physics.fits(px + dirX * s, clearY, pz + dirZ * s, r - 0.05, tuck)) return null;
    }

    const ex = px + dirX * endS;
    const ez = pz + dirZ * endS;
    let landing: boolean;
    let endY: number;
    if (onto) {
      landing = true;
      endY = top;
      if (!this.physics.fits(ex, top + 0.01, ez, r - 0.02, C.CROUCH_HEIGHT)) return null;
    } else {
      const ground = w.supportTop(ex, ez, r - 0.05, top + 0.01, top - 3.2);
      landing = ground !== -Infinity && top - ground <= 1.6;
      if (requireLanding && !landing) return null;
      endY = landing ? ground : clearY;
      if (!this.physics.fits(ex, endY + 0.01, ez, r - 0.02, landing ? C.CROUCH_HEIGHT : tuck)) return null;
    }
    return { dirX, dirZ, topY: top, clearY, frontS, backS, endS, endY, landing, onto };
  }

  /** Looks for a climbable ledge directly ahead of an airborne (or jumping) player. */
  findLedge(px: number, py: number, pz: number, dirX: number, dirZ: number): LedgePlan | null {
    const w = this.world;
    const r = C.RADIUS;
    let hit = null;
    for (const hy of [0.45, 1.05, 1.6]) {
      const h = w.raycast(px, py + hy, pz, dirX, 0, dirZ, r + 0.45);
      if (h && (!hit || h.t < hit.t)) hit = h;
    }
    if (!hit) return null;
    if (hit.ny !== 0) return null;
    if (hit.nx * dirX + hit.nz * dirZ > -0.6) return null;

    // Sample the top just inside the face we touched.
    const qx = hit.x - hit.nx * 0.08;
    const qz = hit.z - hit.nz * 0.08;
    const topCollider = w.columnTopCollider(qx, qz, py + C.MANTLE_MIN_HEIGHT, py + C.MANTLE_REACH);
    if (!topCollider || topCollider.flags & ColliderFlags.NO_GRAB) return null;
    const top = topCollider.maxY;
    if (!w.isColumnFree(qx, qz, top + 0.01, top + C.CROUCH_HEIGHT)) return null;

    // Lifting straight up beside the wall must be possible (no overhang above us).
    if (!this.physics.fits(px, top + 0.02, pz, r - 0.03, C.CROUCH_HEIGHT)) return null;

    // Face-normal direction is the most reliable "onto the ledge" direction.
    const mx = -hit.nx;
    const mz = -hit.nz;
    const faceDist = (hit.x - px) * mx + (hit.z - pz) * mz;
    const destS = Math.max(0, faceDist) + r + 0.15;
    const dx = px + mx * destS;
    const dz = pz + mz * destS;
    const support = w.supportTop(dx, dz, r - 0.05, top + 0.01, top - 0.05);
    if (support === -Infinity) return null;
    let crouch = false;
    if (!this.physics.fits(dx, top + 0.02, dz, r - 0.02, C.STAND_HEIGHT)) {
      if (!this.physics.fits(dx, top + 0.02, dz, r - 0.02, C.CROUCH_HEIGHT)) return null;
      crouch = true;
    }
    return { dirX: mx, dirZ: mz, topY: top, destS, crouch };
  }

  /**
   * Probes for a runnable wall on one side of a movement direction.
   * @param side -1 = left of the direction, +1 = right.
   */
  findWall(px: number, py: number, pz: number, dirX: number, dirZ: number, side: number, extraReach = 0): WallProbe | null {
    const w = this.world;
    // Right-hand perpendicular of the direction (y-up, -Z forward convention).
    const sx = -dirZ * side;
    const sz = dirX * side;
    const reach = C.RADIUS + C.WALLRUN_PROBE + extraReach;
    const h1 = w.raycast(px, py + 0.9, pz, sx, 0, sz, reach);
    if (!h1 || h1.ny !== 0) return null;
    if (h1.collider.flags & ColliderFlags.NO_WALLRUN) return null;
    const h2 = w.raycast(px, py + 1.5, pz, sx, 0, sz, reach + 0.1);
    if (!h2 || h2.ny !== 0 || h2.collider.flags & ColliderFlags.NO_WALLRUN) return null;
    if (h1.nx !== h2.nx || h1.nz !== h2.nz) return null;
    // Must be a proper wall that spans the body, not a crate.
    const c = h1.collider;
    if (c.maxY < py + 1.7 || c.minY > py + 0.25) return null;
    return { nx: h1.nx, nz: h1.nz, dist: h1.t, collider: c };
  }

  /**
   * Closest zipline attach point to the player's hands.
   * Returns the distance along the line, or -1 when nothing is in reach.
   */
  findZipline(lines: readonly ZiplineLine[], px: number, py: number, pz: number, explicit: boolean, airborne: boolean): { line: ZiplineLine; s: number } | null {
    const hy = py + C.ZIP_HANG;
    for (const l of lines) {
      const s = (px - l.ax) * l.dx + (hy - l.ay) * l.dy + (pz - l.az) * l.dz;
      if (s < 0 || s > l.length - 8) continue;
      const cx = l.ax + l.dx * s;
      const cy = l.ay + l.dy * s;
      const cz = l.az + l.dz * s;
      const dh = Math.hypot(px - cx, pz - cz);
      const dv = cy - hy;
      const ok = explicit
        ? dh < 1.7 && dv > -1.0 && dv < 1.9
        : airborne && dh < 0.8 && Math.abs(dv) < 0.7;
      if (ok) return { line: l, s };
    }
    return null;
  }

  /** Whether a zipline is close enough to show an interaction prompt. */
  ziplineNearby(lines: readonly ZiplineLine[], px: number, py: number, pz: number): boolean {
    return this.findZipline(lines, px, py, pz, true, false) !== null;
  }
}
