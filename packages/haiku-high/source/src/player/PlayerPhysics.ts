import { Aabb, CollisionWorld, OVERLAP_EPS, SolidBox } from '../world/CollisionWorld';

/** Half of the player's collision width (the body is a box, not a capsule). */
export const PLAYER_HALF_WIDTH = 0.3;
export const STAND_HEIGHT = 1.8;
export const SLIDE_HEIGHT = 0.9;
/** Solids whose top is at most this far above the feet are stepped onto automatically. */
export const STEP_HEIGHT = 0.45;
/** Max distance moved per collision substep. Keeps fast movement from tunnelling. */
const SUBSTEP = 0.08;
/** Small gap kept between the body and any surface it is pushed out of. */
const SKIN = 0.002;

/** Kinematic state of the player's collision body. `x, y, z` is the centre of the feet. */
export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  height: number;
  grounded: boolean;
  /** Id of the solid the player is standing on, or -1. */
  groundId: number;
}

export function createBody(x: number, y: number, z: number): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, height: STAND_HEIGHT, grounded: false, groundId: -1 };
}

/** Builds the query volume of a body standing at the given position with the given height. */
export function bodyBox(x: number, y: number, z: number, height: number, out: Aabb = {} as Aabb): Aabb {
  out.minX = x - PLAYER_HALF_WIDTH;
  out.maxX = x + PLAYER_HALF_WIDTH;
  out.minY = y;
  out.maxY = y + height;
  out.minZ = z - PLAYER_HALF_WIDTH;
  out.maxZ = z + PLAYER_HALF_WIDTH;
  return out;
}

/** True when a body of the given height fits at the given position without touching solids. */
export function isBodyFree(world: CollisionWorld, x: number, y: number, z: number, height: number): boolean {
  return world.isFree(bodyBox(x, y, z, height));
}

const scratchQuery = {} as Aabb;
const scratchHits: SolidBox[] = [];

/**
 * Moves the body horizontally, resolving against solids axis by axis.
 * Returns whether each axis was blocked. Low ledges (<= STEP_HEIGHT) are stepped onto
 * when the body is grounded.
 */
export function moveHorizontal(
  world: CollisionWorld,
  body: Body,
  dx: number,
  dz: number,
): { blockedX: boolean; blockedZ: boolean } {
  const result = { blockedX: false, blockedZ: false };
  const distance = Math.max(Math.abs(dx), Math.abs(dz));
  const steps = Math.max(1, Math.ceil(distance / SUBSTEP));
  const sx = dx / steps;
  const sz = dz / steps;

  for (let i = 0; i < steps; i++) {
    if (sx !== 0) {
      body.x += sx;
      if (resolveHorizontalAxis(world, body, sx, 'x')) result.blockedX = true;
    }
    if (sz !== 0) {
      body.z += sz;
      if (resolveHorizontalAxis(world, body, sz, 'z')) result.blockedZ = true;
    }
  }
  return result;
}

/** Pushes the body out of any solids along one horizontal axis. Returns true if it was blocked. */
function resolveHorizontalAxis(world: CollisionWorld, body: Body, delta: number, axis: 'x' | 'z'): boolean {
  let blocked = false;
  for (let iter = 0; iter < 6; iter++) {
    bodyBox(body.x, body.y, body.z, body.height, scratchQuery);
    const hits = world.overlapping(scratchQuery, scratchHits);
    if (hits.length === 0) break;

    // Try stepping up onto a low ledge first.
    if (body.grounded) {
      let stepTop = -Infinity;
      for (const box of hits) {
        const rise = box.maxY - body.y;
        if (rise > OVERLAP_EPS && rise <= STEP_HEIGHT && box.maxY > stepTop) stepTop = box.maxY;
      }
      if (stepTop > -Infinity && isBodyFree(world, body.x, stepTop + SKIN, body.z, body.height)) {
        body.y = stepTop + SKIN;
        continue;
      }
    }

    const box = hits[0];
    blocked = true;
    if (axis === 'x') {
      body.x = delta > 0 ? box.minX - PLAYER_HALF_WIDTH - SKIN : box.maxX + PLAYER_HALF_WIDTH + SKIN;
    } else {
      body.z = delta > 0 ? box.minZ - PLAYER_HALF_WIDTH - SKIN : box.maxZ + PLAYER_HALF_WIDTH + SKIN;
    }
  }
  return blocked;
}

/**
 * Moves the body vertically. Landing on a solid sets `grounded`; hitting a ceiling
 * returns `hitCeiling` so the caller can zero upward velocity.
 */
export function moveVertical(world: CollisionWorld, body: Body, dy: number): { hitCeiling: boolean } {
  const result = { hitCeiling: false };
  if (dy === 0) return result;

  // Sub-divide long vertical moves so a fast fall cannot skip over a thin floor.
  const steps = Math.max(1, Math.ceil(Math.abs(dy) / SUBSTEP));
  const sy = dy / steps;

  for (let i = 0; i < steps; i++) {
    body.y += sy;
    for (let iter = 0; iter < 4; iter++) {
      bodyBox(body.x, body.y, body.z, body.height, scratchQuery);
      const hits = world.overlapping(scratchQuery, scratchHits);
      if (hits.length === 0) break;
      const box = hits[0];
      if (sy < 0) {
        body.y = box.maxY + SKIN;
      } else {
        body.y = box.minY - body.height - SKIN;
        result.hitCeiling = true;
      }
    }
  }
  return result;
}

/** Recomputes `grounded` and `groundId` by probing just below the feet. */
export function updateGrounded(world: CollisionWorld, body: Body): void {
  const query: Aabb = {
    minX: body.x - PLAYER_HALF_WIDTH + 0.02,
    maxX: body.x + PLAYER_HALF_WIDTH - 0.02,
    minY: body.y - 0.06,
    maxY: body.y + 0.01,
    minZ: body.z - PLAYER_HALF_WIDTH + 0.02,
    maxZ: body.z + PLAYER_HALF_WIDTH - 0.02,
  };
  const hits = world.overlapping(query);
  // Only surfaces whose top is at the feet count as ground.
  const support = hits.find((box) => Math.abs(box.maxY - body.y) < 0.06);
  body.grounded = support !== undefined;
  body.groundId = support ? support.id : -1;
}
