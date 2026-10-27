import { PHYS } from '../config';
import type { Collider, CollisionWorld } from '../world/CollisionWorld';
import type { PlayerPhysics } from './PlayerPhysics';

export interface WallContact {
  collider: Collider;
  /** Wall surface normal (points away from the wall, towards the player). */
  nx: number;
  nz: number;
  /** Unit direction along the wall in which the player is travelling. */
  tx: number;
  tz: number;
  /** Speed along the tangent. */
  along: number;
  /** +1 wall on the player's right, -1 on the left (relative to travel). */
  side: number;
  distance: number;
}

export interface MovePlan {
  fromX: number; fromY: number; fromZ: number;
  toX: number; toY: number; toZ: number;
  /** Peak feet height of the arc. */
  apexY: number;
}

/**
 * Environment queries for parkour moves. Pure detection - the PlayerController
 * owns all state changes.
 */
export class ParkourSystem {
  constructor(private world: CollisionWorld) {}

  /**
   * Finds a runnable vertical surface beside the player. All level geometry is
   * axis-aligned, so wall normals are always +-X or +-Z.
   */
  findWall(body: PlayerPhysics, excludeId: number): WallContact | null {
    const p = body.position, r = body.radius, v = body.velocity;
    const hs = Math.hypot(v.x, v.z);
    if (hs < PHYS.wallRunMinSpeed) return null;
    const probe = PHYS.wallRunProbe;
    const y0 = p.y + 0.35, y1 = p.y + 1.45;
    let best: WallContact | null = null;

    const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      // Query a thin slab on that side of the player.
      const minX = dx > 0 ? p.x + r : dx < 0 ? p.x - r - probe : p.x - r * 0.6;
      const maxX = dx > 0 ? p.x + r + probe : dx < 0 ? p.x - r : p.x + r * 0.6;
      const minZ = dz > 0 ? p.z + r : dz < 0 ? p.z - r - probe : p.z - r * 0.6;
      const maxZ = dz > 0 ? p.z + r + probe : dz < 0 ? p.z - r : p.z + r * 0.6;
      const hits = this.world.query(minX, y0, minZ, maxX, y1, maxZ);
      for (const c of hits) {
        if (c.id === excludeId) continue;
        // Wall must cover the whole body band, otherwise it is an obstacle, not a wall.
        if (c.minY > p.y + 0.4 || c.maxY < p.y + 1.6) continue;
        let dist: number;
        if (dx > 0) dist = c.minX - (p.x + r);
        else if (dx < 0) dist = (p.x - r) - c.maxX;
        else if (dz > 0) dist = c.minZ - (p.z + r);
        else dist = (p.z - r) - c.maxZ;
        if (dist < -0.05) continue; // beside its corner, not facing its side
        const nx = -dx, nz = -dz;
        // Tangent = horizontal velocity projected on the wall plane.
        let tx = dz !== 0 ? 1 : 0, tz = dx !== 0 ? 1 : 0;
        const along = v.x * tx + v.z * tz;
        if (along < 0) { tx = -tx; tz = -tz; }
        const alongAbs = Math.abs(along);
        // Must be running mostly along the wall, not straight into it.
        if (alongAbs < hs * 0.55 || alongAbs < PHYS.wallRunMinSpeed * 0.85) continue;
        // Right of travel direction (x right, -z forward): right = (-tz, tx)
        const side = (-tz * dx + tx * dz) > 0 ? 1 : -1;
        if (!best || dist < best.distance) {
          best = { collider: c, nx, nz, tx, tz, along: alongAbs, side, distance: dist };
        }
      }
    }
    return best;
  }

  /**
   * Vault check along the horizontal facing direction (fx, fz normalised).
   * Returns a motion plan or null if nothing vaultable is directly ahead.
   */
  findVault(body: PlayerPhysics, fx: number, fz: number): MovePlan | null {
    const p = body.position, r = body.radius;
    const feet = p.y;
    const col = 0.08;
    let hit: Collider | null = null;
    let faceDist = 0;
    for (let d = r + 0.02; d <= r + PHYS.vaultReach; d += 0.08) {
      const x = p.x + fx * d, z = p.z + fz * d;
      const hits = this.world.query(x - col, feet + 0.05, z - col, x + col, feet + 2.4, z + col);
      if (hits.length) {
        hit = hits[0];
        for (const c of hits) if (c.maxY > hit.maxY) hit = c;
        faceDist = d;
        break;
      }
    }
    if (!hit) return null;
    const top = hit.maxY;
    const h = top - feet;
    if (h < PHYS.vaultMinHeight || h > PHYS.vaultMaxHeight) return null;

    // Measure obstacle depth: march until the column just below "top" becomes empty.
    let depth = 0;
    let farDist = faceDist;
    for (let d = faceDist; d <= faceDist + PHYS.vaultMaxDepth + 0.1; d += 0.08) {
      const x = p.x + fx * d, z = p.z + fz * d;
      const blocked = !this.world.isFree(x - col, top - 0.1, z - col, x + col, top - 0.02, z + col);
      if (!blocked) break;
      farDist = d;
      depth = d - faceDist;
    }

    const clearance = 1.0; // tucked body passes over the obstacle
    if (depth < PHYS.vaultMaxDepth) {
      // Full vault: cross over and land on the far side.
      const landD = farDist + r + 0.35;
      const lx = p.x + fx * landD, lz = p.z + fz * landD;
      let ly = this.world.groundHeightAt(lx, lz, top + 0.2, r * 0.9);
      if (ly === -Infinity || ly < feet - 6) ly = feet; // vaulting into open air: keep height, fall afterwards
      if (ly > top + 0.05) return null;
      const landY = Math.max(ly, feet);
      if (!body.boxFreeAt(lx, landY + 0.02, lz, PHYS.slideHeight)) return null;
      // Arc clearance above obstacle and above the start position.
      const mx = p.x + fx * (faceDist + depth * 0.5), mz = p.z + fz * (faceDist + depth * 0.5);
      if (!body.boxFreeAt(mx, top + 0.05, mz, clearance)) return null;
      if (!body.boxFreeAt(p.x, feet + 0.02, p.z, top - feet + clearance)) return null;
      return { fromX: p.x, fromY: feet, fromZ: p.z, toX: lx, toY: landY, toZ: lz, apexY: top + 0.12 };
    }

    // Deep obstacle: vault up onto it.
    const landD = faceDist + r + 0.1;
    const lx = p.x + fx * landD, lz = p.z + fz * landD;
    if (!body.boxFreeAt(lx, top + 0.02, lz, PHYS.slideHeight)) return null;
    if (!body.boxFreeAt(p.x, feet + 0.02, p.z, top - feet + 1.0)) return null;
    return { fromX: p.x, fromY: feet, fromZ: p.z, toX: lx, toY: top + 0.002, toZ: lz, apexY: top + 0.1 };
  }

  /** Ledge grab check when airborne and pushing forward into a higher surface. */
  findLedge(body: PlayerPhysics, fx: number, fz: number): MovePlan | null {
    const p = body.position, r = body.radius;
    const feet = p.y;
    const col = 0.06;
    for (let d = r + 0.02; d <= r + 0.5; d += 0.06) {
      const x = p.x + fx * d, z = p.z + fz * d;
      const hits = this.world.query(x - col, feet + PHYS.mantleMinHeight, z - col, x + col, feet + PHYS.mantleMaxHeight, z + col);
      if (!hits.length) continue;
      // Pick the highest surface in reach.
      let top = -Infinity;
      for (const c of hits) if (c.maxY <= feet + PHYS.mantleMaxHeight && c.maxY > top) top = c.maxY;
      if (top === -Infinity) return null; // wall continues above reach
      // Nothing above the ledge in the probe column.
      if (!this.world.isFree(x - col, top + 0.01, z - col, x + col, top + PHYS.slideHeight, z + col)) return null;
      const landD = d + r + 0.05;
      const lx = p.x + fx * landD, lz = p.z + fz * landD;
      const support = this.world.groundHeightAt(lx, lz, top + 0.01, 0.12);
      if (Math.abs(support - top) > 0.06) return null;
      if (!body.boxFreeAt(lx, top + 0.003, lz, PHYS.slideHeight)) return null;
      // Room to pull the body up in place.
      if (!body.boxFreeAt(p.x, feet + 0.02, p.z, top - feet + Math.min(body.height, 1.2))) return null;
      return { fromX: p.x, fromY: feet, fromZ: p.z, toX: lx, toY: top + 0.003, toZ: lz, apexY: top + 0.05 };
    }
    return null;
  }
}
