import * as THREE from 'three';
import { Box, CollisionWorld } from '../world/CollisionWorld';

/** Physical state of the player (approximated as an upright AABB). */
export class PlayerBody {
  pos = new THREE.Vector3();   // feet position
  vel = new THREE.Vector3();
  radius = 0.35;
  height = 1.8;
  grounded = false;
}

export interface MoveResult { landed: boolean; impact: number; hitWall: boolean; }

export const STEP_HEIGHT = 0.45;
const hits: Box[] = [];

function overlaps(body: PlayerBody, b: Box): boolean {
  const p = body.pos, r = body.radius;
  return p.x - r < b.max.x - 1e-4 && p.x + r > b.min.x + 1e-4 &&
         p.y < b.max.y - 1e-4 && p.y + body.height > b.min.y + 1e-4 &&
         p.z - r < b.max.z - 1e-4 && p.z + r > b.min.z + 1e-4;
}

/**
 * Moves the body by vel*dt resolving collisions one axis at a time (x, z, then y).
 * Called at a fixed 120 Hz, so per-step displacement stays well below the
 * player radius and tunnelling cannot happen at the speeds the game allows.
 */
export function moveAndCollide(body: PlayerBody, world: CollisionWorld, dt: number): MoveResult {
  const res: MoveResult = { landed: false, impact: 0, hitWall: false };
  const wasGrounded = body.grounded;
  const r = body.radius;

  for (const axis of ['x', 'z'] as const) {
    const d = body.vel[axis] * dt;
    if (d === 0) continue;
    body.pos[axis] += d;
    world.queryPlayer(body.pos.x, body.pos.y, body.pos.z, r, body.height, hits);
    for (const b of hits) {
      if (!overlaps(body, b)) continue;
      // Step up onto small ledges (curbs, parapets) while walking.
      const rise = b.max.y - body.pos.y;
      if (wasGrounded && rise > 0 && rise <= STEP_HEIGHT &&
          world.isFree(body.pos.x, b.max.y + 0.001, body.pos.z, r, body.height)) {
        body.pos.y = b.max.y + 0.001;
        continue;
      }
      body.pos[axis] = d > 0 ? b.min[axis] - r - 1e-4 : b.max[axis] + r + 1e-4;
      body.vel[axis] = 0;
      res.hitWall = true;
    }
  }

  const vyBefore = body.vel.y;
  body.pos.y += body.vel.y * dt;
  world.queryPlayer(body.pos.x, body.pos.y, body.pos.z, r, body.height, hits);
  if (hits.length) {
    if (body.vel.y <= 0) {
      let top = -Infinity;
      for (const b of hits) top = Math.max(top, b.max.y);
      body.pos.y = top;
    } else {
      let bottom = Infinity;
      for (const b of hits) bottom = Math.min(bottom, b.min.y);
      body.pos.y = bottom - body.height - 1e-4;
    }
    body.vel.y = 0;
  }

  // Ground probe: a thin slab just under the feet.
  body.grounded = body.vel.y <= 0 && world.hasSupport(body.pos.x, body.pos.y, body.pos.z, r * 0.95, 0.06);
  if (body.grounded && body.vel.y < 0) body.vel.y = 0;
  if (body.grounded && !wasGrounded) { res.landed = true; res.impact = Math.max(0, -vyBefore); }
  return res;
}
