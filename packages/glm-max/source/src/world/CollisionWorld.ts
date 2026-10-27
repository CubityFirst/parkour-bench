import * as THREE from 'three';

/**
 * CollisionWorld — a lightweight static AABB collider set.
 *
 * CallbackSignature: every collider is an axis-aligned box stored on a plain
 * object for fast access. The player is resolved as an AABB against these
 * boxes axis by axis (see PlayerPhysics), which is simple but robust for
 * rooftop-style levels.
 */
export interface Collider {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** A contact recorded while moving: normal points towards the player. */
export interface Contact {
  nx: number;
  ny: number;
  nz: number;
  collider: Collider;
}

/** A trigger volume (checkpoints, finish line). Not solid. */
export interface TriggerBox extends Collider {
  id: number;
}

export class CollisionWorld {
  readonly colliders: Collider[] = [];

  /** Adds an axis-aligned box defined by center + size. */
  addBoxCentered(center: THREE.Vector3Like, size: THREE.Vector3Like): Collider {
    const c: Collider = {
      minX: center.x - size.x / 2,
      minY: center.y - size.y / 2,
      minZ: center.z - size.z / 2,
      maxX: center.x + size.x / 2,
      maxY: center.y + size.y / 2,
      maxZ: center.z + size.z / 2
    };
    this.colliders.push(c);
    return c;
  }

  addBoxMinMax(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Collider {
    const c: Collider = { minX, minY, minZ, maxX, maxY, maxZ };
    this.colliders.push(c);
    return c;
  }

  /**
   * Returns true when the given box intersects any collider.
   */
  isBlocked(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number
  ): boolean {
    const list = this.colliders;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (
        minX < c.maxX && maxX > c.minX &&
        minY < c.maxY && maxY > c.minY &&
        minZ < c.maxZ && maxZ > c.minZ
      ) return true;
    }
    return false;
  }

  /** Collects all colliders intersecting the given box into `out`. */
  overlaps(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    out: Collider[]
  ): void {
    out.length = 0;
    const list = this.colliders;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (
        minX < c.maxX && maxX > c.minX &&
        minY < c.maxY && maxY > c.minY &&
        minZ < c.maxZ && maxZ > c.minZ
      ) out.push(c);
    }
  }

  /**
   * Probes forward with a box (feet position, half width, height) and
   * returns the first blocker within reach — used for vault and ledge
   * detection. Returns null when nothing blocks the sweep.
   */
  probeForward(
    feetX: number, feetY: number, feetZ: number,
    halfW: number, height: number,
    dirX: number, dirZ: number,
    reach: number,
    outOverlaps: Collider[]
  ): { collider: Collider; distance: number } | null {
    const chunk = 0.3;
    const steps = Math.max(1, Math.ceil(reach / chunk));
    for (let i = 1; i <= steps; i++) {
      const t = (i * chunk <= reach) ? i * chunk : reach;
      const ox = feetX + dirX * t;
      const oz = feetZ + dirZ * t;
      this.overlaps(
        ox - halfW, feetY + 0.08, oz - halfW,
        ox + halfW, feetY + height - 0.08, oz + halfW,
        outOverlaps
      );
      if (outOverlaps.length > 0) {
        // pick nearest blocker along the probe axis
        let best: Collider = outOverlaps[0];
        let bestDist = Infinity;
        for (const c of outOverlaps) {
          let d: number;
          if (dirX > 0.01) d = c.minX - (feetX + halfW);
          else if (dirX < -0.01) d = (feetX - halfW) - c.maxX;
          else if (dirZ > 0.01) d = c.minZ - (feetZ + halfW);
          else d = (feetZ - halfW) - c.maxZ;
          if (d < bestDist) { bestDist = d; best = c; }
        }
        return { collider: best, distance: Math.max(0, bestDist) };
      }
    }
    return null;
  }

  /**
   * Probes sideways (wall detection) next to the player's body.
   * Returns the nearest tall wall and its inward normal, or null.
   */
  probeWall(
    feetX: number, feetY: number, feetZ: number,
    halfW: number, height: number,
    dirX: number, dirZ: number,
    reach: number,
    minWallHeight: number,
    outOverlaps: Collider[]
  ): { collider: Collider; distance: number; nX: number; nZ: number } | null {
    // Test a bar next to the player, spanning from knee to chest height.
    const testY = feetY + height * 0.32;
    const testH = height * 0.42;
    const cx = feetX + dirX * reach;
    const cz = feetZ + dirZ * reach;
    this.overlaps(
      cx - halfW, testY, cz - halfW,
      cx + halfW, testY + testH, cz + halfW,
      outOverlaps
    );
    let best: Collider | null = null;
    let bestDist = Infinity;
    for (const c of outOverlaps) {
      const wallHeight = c.maxY - feetY;
      if (wallHeight < minWallHeight) continue;
      let d: number;
      if (Math.abs(dirX) > Math.abs(dirZ)) d = dirX > 0 ? c.minX - (feetX + halfW) : (feetX - halfW) - c.maxX;
      else d = dirZ > 0 ? c.minZ - (feetZ + halfW) : (feetZ - halfW) - c.maxZ;
      if (d < bestDist) { bestDist = d; best = c; }
    }
    if (best === null) return null;
    const nX = Math.abs(dirX) > Math.abs(dirZ) ? (dirX > 0 ? -1 : 1) : 0;
    const nZ = Math.abs(dirZ) >= Math.abs(dirX) ? (dirZ > 0 ? -1 : 1) : 0;
    return { collider: best, distance: bestDist, nX, nZ };
  }

  addTriggerBox(
    id: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number
  ): TriggerBox {
    return { id, minX, minY, minZ, maxX, maxY, maxZ };
  }

  isPointInBox(x: number, y: number, z: number, b: TriggerBox): boolean {
    // Tolerance: grounded players stand with feet exactly on the roof surface,
    // so the minimum planes need a small downward pad.
    const TOL_XZ = 0.3;
    return (
      x > b.minX - TOL_XZ && x < b.maxX + TOL_XZ &&
      y > b.minY - 1.0 && y < b.maxY + 0.2 &&
      z > b.minZ - TOL_XZ && z < b.maxZ + TOL_XZ
    );
  }
}
