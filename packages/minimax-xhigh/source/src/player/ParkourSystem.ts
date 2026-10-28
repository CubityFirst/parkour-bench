import * as THREE from 'three';
import { PLAYER } from '../game/Config';
import { CollisionWorld, Solid } from '../world/CollisionWorld';

export interface WallHit {
  /** Unit normal pointing away from the wall, towards the player. */
  normal: THREE.Vector3;
  /** Horizontal gap between the body centre and the wall surface. */
  distance: number;
  /** -1 when the wall is on the player's left, +1 when on the right. */
  side: -1 | 1;
  solid: Solid;
}

export interface VaultTarget {
  /** Height of the obstacle top relative to the player's feet. */
  top: number;
  /** Where the player ends up after vaulting. */
  destination: THREE.Vector3;
  /** Horizontal extent of the obstacle along the forward axis. */
  depth: number;
}

export interface LedgeTarget {
  /** Absolute world height of the ledge surface. */
  top: number;
  /** Where the player ends up after mantling. */
  destination: THREE.Vector3;
}

/**
 * Detection helpers for the parkour moves.
 *
 * All of them work on the axis-aligned solid list, so they are exact and cheap.
 */export class ParkourSystem {
  private world: CollisionWorld;
  private tmp = new THREE.Vector3();
  private corners: THREE.Vector3[] = [];

  constructor(world: CollisionWorld) {
    this.world = world;
    for (let i = 0; i < 8; i++) this.corners.push(new THREE.Vector3());
  }

  /**
   * Find a runnable wall beside the player.
   *
   * @param centre  horizontal centre of the body
   * @param right   unit vector pointing to the player's right
   */
  findWall(centre: THREE.Vector3, right: THREE.Vector3, feetY: number, height: number): WallHit | null {
    const reach = PLAYER.radius + PLAYER.wallRunRange;
    let best: WallHit | null = null;

    for (const solid of this.world.solids) {
      const box = solid.box;
      // A wall has to be tall enough to run along and low enough to touch.
      if (box.max.y < feetY + height * 0.7) continue;
      if (box.min.y > feetY + height * 0.55) continue;

      const dx = outside(centre.x, box.min.x, box.max.x);
      const dz = outside(centre.z, box.min.z, box.max.z);
      if (dx > reach || dz > reach) continue;
      if (dx > 0.001 && dz > 0.001) continue; // diagonal: not flush against a face

      let normal: THREE.Vector3;
      if (dx >= dz) {
        normal = new THREE.Vector3(centre.x < box.min.x ? -1 : 1, 0, 0);
      } else {
        normal = new THREE.Vector3(0, 0, centre.z < box.min.z ? -1 : 1);
      }

      const distance = dx + dz;
      const side: -1 | 1 = normal.dot(right) > 0 ? 1 : -1;

      // When two solids share the same face (e.g. a coloured band in front of
      // a tower) prefer the taller one: it stays runnable for longer.
      if (!best || distance < best.distance - 0.01 || (Math.abs(distance - best.distance) <= 0.01 && box.max.y > best.solid.box.max.y)) {
        best = { normal, distance, side, solid };
      }
    }
    return best;
  }

  /** Is the wall still in reach? Used to keep a wall run alive. */
  wallStillPresent(solid: Solid, centre: THREE.Vector3, feetY: number, height: number): boolean {
    const box = solid.box;
    if (box.max.y < feetY + height * 0.7) return false;
    const dx = outside(centre.x, box.min.x, box.max.x);
    const dz = outside(centre.z, box.min.z, box.max.z);
    if (dx > PLAYER.radius + PLAYER.wallRunRange * 1.6) return false;
    if (dz > PLAYER.radius + PLAYER.wallRunRange * 1.6) return false;
    return true;
  }

  /**
   * Detect a low obstacle directly in front of the player that can be vaulted.
   */
  findVaultTarget(position: THREE.Vector3, forward: THREE.Vector3, right: THREE.Vector3): VaultTarget | null {
    const maxTop = position.y + PLAYER.vaultMaxHeight;
    const minTop = position.y + PLAYER.vaultMinHeight;
    let best: VaultTarget | null = null;

    for (const solid of this.world.solids) {
      const top = solid.box.max.y;
      if (top < minTop || top > maxTop) continue;

      const span = this.projectBox(solid.box, position, forward, right);
      if (!span) continue;
      if (span.alongMax < 0.05) continue; // behind the player
      if (span.alongMin > 1.35) continue; // too far away
      if (span.latMax < -PLAYER.radius - 0.25) continue;
      if (span.latMin > PLAYER.radius + 0.25) continue;

      const depth = span.alongMax - span.alongMin;
      if (depth > 1.6) continue; // walls are not vaultable

      const destination = this.tmp
        .copy(position)
        .addScaledVector(forward, span.alongMax + 0.85)
        .clone();
      destination.y = position.y;

      // There has to be room to land on the other side.
      const r = PLAYER.radius;
      const landing = new THREE.Box3(
        new THREE.Vector3(destination.x - r, destination.y + 0.05, destination.z - r),
        new THREE.Vector3(destination.x + r, destination.y + PLAYER.height, destination.z + r),
      );
      if (!this.world.isFree(landing)) continue;

      if (!best || span.alongMin < best.depth) {
        best = { top: top - position.y, destination, depth: span.alongMin };
      }
    }
    return best;
  }

  /**
   * Detect a ledge the player can pull themselves onto: a surface just above
   * the feet whose top is clear and deep enough to stand on.
   */
  findLedge(position: THREE.Vector3, forward: THREE.Vector3, right: THREE.Vector3, bodyHeight: number): LedgeTarget | null {
    const maxTop = position.y + PLAYER.mantleMaxHeight;
    const minTop = position.y + PLAYER.mantleMinHeight;
    let best: LedgeTarget | null = null;

    for (const solid of this.world.solids) {
      const top = solid.box.max.y;
      if (top < minTop || top > maxTop) continue;
      // The head must still be below (or near) the ledge for a grab to make sense.
      if (position.y + bodyHeight > top + 0.35) continue;

      const span = this.projectBox(solid.box, position, forward, right);
      if (!span) continue;
      if (span.alongMax < 0.05) continue;
      if (span.alongMin > 0.95) continue;
      if (span.latMax < -PLAYER.radius - 0.15) continue;
      if (span.latMin > PLAYER.radius + 0.15) continue;

      const depth = span.alongMax - span.alongMin;
      if (depth < PLAYER.mantleMinDepth) continue;

      const destination = this.tmp
        .copy(position)
        .addScaledVector(forward, span.alongMin + 0.5)
        .clone();
      destination.y = top;

      // There has to be room to stand once we are up there.
      const r = PLAYER.radius;
      const probe = new THREE.Box3(
        new THREE.Vector3(destination.x - r, top + 0.05, destination.z - r),
        new THREE.Vector3(destination.x + r, top + bodyHeight, destination.z + r),
      );
      if (!this.world.isFree(probe, solid)) continue;

      if (!best || top > best.top) {
        best = { top, destination };
      }
    }
    return best;
  }

  /**
   * Project a solid's box onto the player's forward / right axes.
   * Returns null when the box is degenerate in that frame.
   */
  private projectBox(
    box: THREE.Box3,
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    right: THREE.Vector3,
  ): { alongMin: number; alongMax: number; latMin: number; latMax: number } | null {
    let alongMin = Infinity;
    let alongMax = -Infinity;
    let latMin = Infinity;
    let latMax = -Infinity;

    let i = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const c = this.corners[i++];
          c.set(x, y, z).sub(origin);
          const a = c.x * forward.x + c.z * forward.z;
          const l = c.x * right.x + c.z * right.z;
          if (a < alongMin) alongMin = a;
          if (a > alongMax) alongMax = a;
          if (l < latMin) latMin = l;
          if (l > latMax) latMax = l;
        }
      }
    }
    return { alongMin, alongMax, latMin, latMax };
  }
}

/** Distance from `v` to the interval [min,max] (0 when inside). */
function outside(v: number, min: number, max: number): number {
  if (v < min) return min - v;
  if (v > max) return v - max;
  return 0;
}
