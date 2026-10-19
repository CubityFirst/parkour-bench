import { CollisionWorld } from './CollisionWorld';
import { type LevelSpec } from './LevelSpec';

/** Creates the collision world for a level spec (shared by the game and the headless verifier). */
export function createCollisionWorld(spec: LevelSpec): CollisionWorld {
  const world = new CollisionWorld();
  for (const p of spec.parts) {
    if (!p.collide) continue;
    world.add(p.min[0], p.min[1], p.min[2], p.max[0], p.max[1], p.max[2], p.flags ?? {});
  }
  return world;
}
