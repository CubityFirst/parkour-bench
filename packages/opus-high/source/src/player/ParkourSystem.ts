import * as THREE from 'three';
import type { Collider } from '../world/CollisionWorld';
import { PLAYER, PlayerPhysics } from './PlayerPhysics';

/** A wall face the player can run along. Normals are axis aligned and point away from the wall. */
export interface WallContact {
  collider: Collider;
  normal: THREE.Vector3;
  /** Gap between the player's side and the wall face. */
  distance: number;
}

export interface VaultPlan {
  top: number;
  target: THREE.Vector3;
  crouchAtEnd: boolean;
}

export interface MantlePlan {
  top: number;
  target: THREE.Vector3;
  crouchAtEnd: boolean;
}

const tmpList: Collider[] = [];

/**
 * Environment queries used by the parkour moves (wall run, vault, ledge recovery).
 * Pure detection: the player controller decides when to act on the results.
 */
export class ParkourSystem {
  constructor(private readonly physics: PlayerPhysics) {}

  private get world() {
    return this.physics.world;
  }

  /** Stable key for a wall face, used to stop players re-running the same wall forever. */
  static wallKey(w: WallContact): string {
    return `${w.collider.id}:${Math.round(w.normal.x)}:${Math.round(w.normal.z)}`;
  }

  /**
   * Finds the closest runnable wall beside the player. The wall must be taller than
   * the player's body, and the player's velocity must be roughly parallel to it.
   */
  findWall(pos: THREE.Vector3, vel: THREE.Vector3, exclude?: Set<string>): WallContact | null {
    const r = PLAYER.radius;
    const maxD = PLAYER.wallDetectDist;
    const hs = Math.hypot(vel.x, vel.z);
    if (hs < 0.01) return null;
    const vx = vel.x / hs;
    const vz = vel.z / hs;

    let best: WallContact | null = null;
    for (const c of this.world.colliders) {
      if (c.flags.noWallRun) continue;
      // The wall must cover the whole body: from the knees to above the head.
      if (c.maxY < pos.y + 1.6 || c.minY > pos.y + 0.6) continue;

      const inZ = pos.z > c.minZ + 0.1 && pos.z < c.maxZ - 0.1;
      const inX = pos.x > c.minX + 0.1 && pos.x < c.maxX - 0.1;
      const candidates: Array<[number, number, number]> = [];
      if (inZ) {
        candidates.push([c.minX - (pos.x + r), -1, 0]);
        candidates.push([pos.x - r - c.maxX, 1, 0]);
      }
      if (inX) {
        candidates.push([c.minZ - (pos.z + r), 0, -1]);
        candidates.push([pos.z - r - c.maxZ, 0, 1]);
      }
      for (const [dist, nx, nz] of candidates) {
        if (dist < -0.06 || dist > maxD) continue;
        // Running straight into a wall is not a wall run.
        if (Math.abs(vx * nx + vz * nz) > 0.62) continue;
        if (!best || dist < best.distance) {
          const contact: WallContact = { collider: c, normal: new THREE.Vector3(nx, 0, nz), distance: dist };
          if (exclude && exclude.has(ParkourSystem.wallKey(contact))) continue;
          best = contact;
        }
      }
    }
    return best;
  }

  /** Re-checks contact with a specific wall face during a wall run. */
  stillOnWall(pos: THREE.Vector3, wall: WallContact): boolean {
    const c = wall.collider;
    const r = PLAYER.radius;
    const n = wall.normal;
    if (c.maxY < pos.y + 1.0 || c.minY > pos.y + 0.6) return false;
    let dist: number;
    let inside: boolean;
    if (n.x !== 0) {
      dist = n.x < 0 ? c.minX - (pos.x + r) : pos.x - r - c.maxX;
      inside = pos.z > c.minZ - 0.05 && pos.z < c.maxZ + 0.05;
    } else {
      dist = n.z < 0 ? c.minZ - (pos.z + r) : pos.z - r - c.maxZ;
      inside = pos.x > c.minX - 0.05 && pos.x < c.maxX + 0.05;
    }
    return inside && dist > -0.1 && dist < PLAYER.wallDetectDist + 0.15;
  }

  /**
   * Ledge recovery: looks for a box edge directly ahead whose top is within reach
   * and whose top surface has room for the player.
   */
  findMantle(pos: THREE.Vector3, forward: THREE.Vector3, minReach: number, maxReach: number): MantlePlan | null {
    const r = PLAYER.radius;
    let top = -Infinity;
    // Probe a few points just in front of the player's face.
    for (const probe of [0.12, 0.3, 0.45]) {
      const px = pos.x + forward.x * (r + probe);
      const pz = pos.z + forward.z * (r + probe);
      for (const c of this.world.atPoint(px, pz, tmpList)) {
        if (c.flags.noMantle) continue;
        const rise = c.maxY - pos.y;
        if (rise >= minReach && rise <= maxReach && c.minY < pos.y + 1.2 && c.maxY > top) top = c.maxY;
      }
      if (top > -Infinity) break;
    }
    if (top === -Infinity) return null;

    // The column straight above the player must be clear up to the ledge height.
    const climbH = Math.max(top - pos.y, 0) + PLAYER.crouchHeight;
    if (!this.world.isFree(pos.x - r, pos.y + 0.05, pos.z - r, pos.x + r, pos.y + climbH, pos.z + r)) return null;

    for (const reach of [1.05, 0.85, 0.7]) {
      const tx = pos.x + forward.x * reach;
      const tz = pos.z + forward.z * reach;
      const ground = this.world.groundBelow(tx, tz, r - 0.05, top + 0.02);
      if (Math.abs(ground - top) > 0.03) continue;
      const y = top + 0.002;
      if (this.physics.fits(tx, y, tz, PLAYER.standHeight)) {
        return { top, target: new THREE.Vector3(tx, y, tz), crouchAtEnd: false };
      }
      if (this.physics.fits(tx, y, tz, PLAYER.crouchHeight)) {
        return { top, target: new THREE.Vector3(tx, y, tz), crouchAtEnd: true };
      }
    }
    return null;
  }

  /**
   * Vault: finds a low obstacle directly ahead, measures how deep it is and
   * checks that the player fits over it and on the other side.
   * Tall obstacles (walls) are rejected so the player can never vault through them.
   */
  findVault(pos: THREE.Vector3, forward: THREE.Vector3): VaultPlan | null {
    const r = PLAYER.radius;
    const low = pos.y + PLAYER.vaultMinHeight;
    const high = pos.y + PLAYER.vaultMaxHeight;

    // 1. Find the obstacle's near face.
    let hitAt = -1;
    let top = -Infinity;
    for (let s = 0.02; s <= PLAYER.vaultReach; s += 0.08) {
      const px = pos.x + forward.x * (r + s);
      const pz = pos.z + forward.z * (r + s);
      let hit = false;
      for (const c of this.world.atPoint(px, pz, tmpList)) {
        if (c.maxY > low && c.minY < high) {
          hit = true;
          top = Math.max(top, c.maxY);
        }
      }
      if (hit) {
        hitAt = s;
        break;
      }
    }
    if (hitAt < 0 || top > high) return null;

    // 2. March across the obstacle to find its far side.
    let far = -1;
    for (let s = hitAt; s <= hitAt + PLAYER.vaultMaxDepth; s += 0.08) {
      const px = pos.x + forward.x * (r + s);
      const pz = pos.z + forward.z * (r + s);
      let solid = false;
      for (const c of this.world.atPoint(px, pz, tmpList)) {
        if (c.maxY > low && c.minY < top + PLAYER.crouchHeight) {
          solid = true;
          top = Math.max(top, c.maxY);
        }
      }
      if (top > high) return null;
      if (!solid) {
        far = s;
        break;
      }
    }
    if (far < 0) return null;

    // 3. Landing spot on the other side.
    const land = r + far + r + 0.25;
    const tx = pos.x + forward.x * land;
    const tz = pos.z + forward.z * land;
    const ground = this.world.groundBelow(tx, tz, r - 0.05, top + 0.05);
    let ty = pos.y;
    if (ground > pos.y - 1.6 && ground <= top + 0.05) ty = ground + 0.002;

    // 4. Clearance: room to rise at the start, over the top, and at the landing spot.
    const overY = top + 0.03;
    if (!this.world.isFree(pos.x - r, pos.y + 0.05, pos.z - r, pos.x + r, overY + PLAYER.crouchHeight, pos.z + r)) return null;
    for (const f of [0.35, 0.65]) {
      const mx = pos.x + forward.x * land * f;
      const mz = pos.z + forward.z * land * f;
      if (!this.physics.fits(mx, overY, mz, PLAYER.crouchHeight)) return null;
    }
    let crouchAtEnd = false;
    if (!this.physics.fits(tx, ty, tz, PLAYER.standHeight)) {
      if (!this.physics.fits(tx, ty, tz, PLAYER.crouchHeight)) return null;
      crouchAtEnd = true;
    }
    return { top, target: new THREE.Vector3(tx, ty, tz), crouchAtEnd };
  }
}
