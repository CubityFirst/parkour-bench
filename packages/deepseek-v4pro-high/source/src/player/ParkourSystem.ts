import * as THREE from 'three';
import { CollisionWorld } from '../world/CollisionWorld';
import { CONST } from '../constants';

export interface VaultTarget {
  distance: number;
  height: number;
}

export interface WallTarget {
  axis: 'x' | 'z';
  wallCoord: number;
  lean: number; // +1 wall on right, -1 wall on left
  normal: THREE.Vector3;
}

/**
 * Detection helpers for the parkour moves. Pure raycast / height queries
 * against the collision world; the PlayerController drives the actual state
 * transitions and timing.
 */
export class ParkourSystem {
  constructor(private world: CollisionWorld) {}

  /** Find a vaultable obstacle directly ahead of the given feet position. */
  vaultTarget(feet: THREE.Vector3, forward: THREE.Vector3): VaultTarget | null {
    for (const h of [0.45, 1.0]) {
      const origin = feet.clone();
      origin.y += h;
      const hit = this.world.raycast(origin, forward, CONST.vaultDetectDist);
      if (!hit) continue;

      const probeX = hit.point.x + forward.x * 0.3;
      const probeZ = hit.point.z + forward.z * 0.3;
      const top = this.world.heightAt(probeX, probeZ);
      const height = top - feet.y;

      if (height >= CONST.vaultMinHeight && height <= CONST.vaultMaxHeight) {
        return { distance: hit.distance, height };
      }
      // hit a solid but it isn't vaultable (too tall) -> treat as a wall
      return null;
    }
    return null;
  }

  /** Find a ledge to mantle onto, just ahead and above the feet position. */
  ledgeTarget(feet: THREE.Vector3, forward: THREE.Vector3): { top: number } | null {
    const probeX = feet.x + forward.x * 0.55;
    const probeZ = feet.z + forward.z * 0.55;
    const top = this.world.heightAt(probeX, probeZ);
    if (!Number.isFinite(top)) return null;

    const rel = top - feet.y;
    if (rel >= CONST.mantleMinHeight && rel <= CONST.mantleMaxHeight) {
      return { top };
    }
    return null;
  }

  /** Detect a runnable vertical wall to the side of the player. */
  wallTarget(center: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3): WallTarget | null {
    for (const yOff of [0, 0.75]) {
      const origin = center.clone();
      origin.y += yOff;
      const hit = this.world.raycast(origin, dir, CONST.wallDetectDist);
      if (!hit || Math.abs(hit.normal.y) > 0.5) continue;

      // wall normal points away from the wall (toward the player)
      const axis: 'x' | 'z' = Math.abs(hit.normal.x) > 0.5 ? 'x' : 'z';
      const face = hit.point.getComponent(axis === 'x' ? 0 : 2);
      const nSign = hit.normal.getComponent(axis === 'x' ? 0 : 2);
      const wallCoord = face + nSign * CONST.playerRadius;

      // lean: which side of the player is the wall on?
      const lean = Math.sign(right.dot(hit.normal.clone().negate()));

      return { axis, wallCoord, lean, normal: hit.normal.clone() };
    }
    return null;
  }
}
