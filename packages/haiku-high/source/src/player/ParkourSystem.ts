import { CollisionWorld, SolidBox } from '../world/CollisionWorld';
import { Body, isBodyFree, PLAYER_HALF_WIDTH, STAND_HEIGHT, STEP_HEIGHT } from './PlayerPhysics';

/**
 * Parkour detection: vaulting over small obstacles, mantling ledges, and finding
 * vertical walls to run along. All queries are read-only; the PlayerController
 * decides when to act on them.
 */

/** Tallest obstacle that can be vaulted, measured from the feet. */
export const VAULT_MAX_HEIGHT = 1.25;
/** Highest ledge that can be mantled, measured from the feet. */
export const MANTLE_MAX_HEIGHT = 2.2;
/** Thickest obstacle that can be vaulted. Stops the player vaulting through walls. */
const VAULT_MAX_THICKNESS = 2.6;
/** Minimum depth of a surface that can be mantled onto. */
const MANTLE_MIN_DEPTH = 0.8;
/** How far ahead of the body to look for a vault or ledge. */
const VAULT_REACH = 1.0;
const MANTLE_REACH = 0.6;
/** Distance from a wall face the body's side probe reaches. */
const WALL_PROBE_GAP = 0.16;
/** Walls shorter than this (from the feet) are not runnable. */
const WALL_MIN_TOP = 1.6;

/** Where a vault or mantle should end up. Feet position. */
export interface ClimbTarget {
  x: number;
  y: number;
  z: number;
  kind: 'vault' | 'mantle';
  /** Feet height the body rises to while passing over the obstacle (vault only). */
  peakY: number;
}

/** A vertical wall beside the body that can be wall-run. */
export interface WallContact {
  box: SolidBox;
  /** Horizontal normal pointing from the wall toward the player. */
  normalX: number;
  normalZ: number;
  /** +1 if the wall is on the player's right, -1 if on the left. */
  side: 1 | -1;
}

/** Converts a facing direction into the dominant axis-aligned direction. */
function dominantAxis(dirX: number, dirZ: number): { x: number; z: number } {
  if (Math.abs(dirX) >= Math.abs(dirZ)) return { x: Math.sign(dirX) || 1, z: 0 };
  return { x: 0, z: Math.sign(dirZ) || 1 };
}

/** Highest solid top under a small footprint at (x, z), ignoring anything above `maxY`. */
function surfaceHeightAt(world: CollisionWorld, x: number, z: number, minY: number, maxY: number): number | null {
  let best: number | null = null;
  const hits = world.overlapping({
    minX: x - 0.05,
    maxX: x + 0.05,
    minY,
    maxY,
    minZ: z - 0.05,
    maxZ: z + 0.05,
  });
  for (const box of hits) {
    if (box.maxY <= maxY && (best === null || box.maxY > best)) best = box.maxY;
  }
  return best;
}

/**
 * Looks for an obstacle ahead that can be vaulted over. Returns the landing spot
 * beyond it, or null if there is no vaultable obstacle or no safe landing.
 */
export function findVaultTarget(world: CollisionWorld, body: Body, dirX: number, dirZ: number): ClimbTarget | null {
  const axis = dominantAxis(dirX, dirZ);
  const hit = world.probeHorizontal(
    body.x,
    body.y + STEP_HEIGHT * 0.5,
    body.y + VAULT_MAX_HEIGHT,
    body.z,
    axis.x,
    axis.z,
    VAULT_REACH,
    0.25,
  );
  if (!hit) return null;

  // Must be taller than a step, and not taller than the vault limit.
  if (hit.maxY - body.y <= STEP_HEIGHT || hit.maxY - body.y > VAULT_MAX_HEIGHT) return null;

  const nearFace = axis.x !== 0 ? (axis.x > 0 ? hit.minX : hit.maxX) : axis.z > 0 ? hit.minZ : hit.maxZ;
  const farFace = axis.x !== 0 ? (axis.x > 0 ? hit.maxX : hit.minX) : axis.z > 0 ? hit.maxZ : hit.minZ;
  if (Math.abs(farFace - nearFace) > VAULT_MAX_THICKNESS) return null;

  // Land a little past the far face, on whatever surface is there.
  const landX = axis.x !== 0 ? farFace + axis.x * (PLAYER_HALF_WIDTH + 0.35) : body.x;
  const landZ = axis.z !== 0 ? farFace + axis.z * (PLAYER_HALF_WIDTH + 0.35) : body.z;
  const landY = surfaceHeightAt(world, landX, landZ, body.y - 1.5, body.y + VAULT_MAX_HEIGHT);
  if (landY === null) return null;
  if (!isBodyFree(world, landX, landY + 0.01, landZ, STAND_HEIGHT)) return null;

  // Clear the obstacle top with a little margin while travelling across it.
  const peakY = Math.max(body.y, hit.maxY) + 0.2;
  return { x: landX, y: landY, z: landZ, kind: 'vault', peakY };
}

/**
 * Looks for a ledge ahead that the body can pull itself onto. Used while airborne
 * when the body is falling beside a wall whose top is just above the vault height.
 */
export function findMantleTarget(world: CollisionWorld, body: Body, dirX: number, dirZ: number): ClimbTarget | null {
  const axis = dominantAxis(dirX, dirZ);
  const hit = world.probeHorizontal(
    body.x,
    body.y + VAULT_MAX_HEIGHT,
    body.y + MANTLE_MAX_HEIGHT,
    body.z,
    axis.x,
    axis.z,
    MANTLE_REACH,
    0.25,
  );
  if (!hit) return null;
  if (hit.maxY - body.y > MANTLE_MAX_HEIGHT || hit.maxY - body.y <= VAULT_MAX_HEIGHT) return null;

  const nearFace = axis.x !== 0 ? (axis.x > 0 ? hit.minX : hit.maxX) : axis.z > 0 ? hit.minZ : hit.maxZ;
  const farFace = axis.x !== 0 ? (axis.x > 0 ? hit.maxX : hit.minX) : axis.z > 0 ? hit.maxZ : hit.minZ;
  if (Math.abs(farFace - nearFace) < MANTLE_MIN_DEPTH) return null;

  // Put the feet a short distance onto the top surface, away from the edge.
  const landX = axis.x !== 0 ? nearFace + axis.x * (PLAYER_HALF_WIDTH + 0.45) : body.x;
  const landZ = axis.z !== 0 ? nearFace + axis.z * (PLAYER_HALF_WIDTH + 0.45) : body.z;
  const landY = hit.maxY;
  if (!isBodyFree(world, landX, landY + 0.01, landZ, STAND_HEIGHT)) return null;

  return { x: landX, y: landY, z: landZ, kind: 'mantle', peakY: landY };
}

/**
 * Checks both sides of the body for a tall, flat wall. Returns the first one found,
 * preferring the side that matches `preferSide` (the side the player is drifting toward).
 */
export function findWallContact(
  world: CollisionWorld,
  body: Body,
  rightX: number,
  rightZ: number,
  preferSide: 1 | -1,
): WallContact | null {
  const order: Array<1 | -1> = preferSide === 1 ? [1, -1] : [-1, 1];
  for (const side of order) {
    const dirX = rightX * side;
    const dirZ = rightZ * side;
    const hit = world.probeHorizontal(
      body.x,
      body.y + 0.6,
      body.y + body.height - 0.2,
      body.z,
      dirX,
      dirZ,
      PLAYER_HALF_WIDTH + WALL_PROBE_GAP,
      0.05,
    );
    if (!hit || hit.maxY - body.y < WALL_MIN_TOP) continue;

    // Normal points from the wall back toward the player.
    const axis = dominantAxis(dirX, dirZ);
    return {
      box: hit,
      normalX: -axis.x,
      normalZ: -axis.z,
      side,
    };
  }
  return null;
}
