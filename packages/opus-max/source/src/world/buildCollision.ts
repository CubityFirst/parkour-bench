import { CollisionWorld } from './CollisionWorld.ts';
import type { LevelDef, Vec3 } from './LevelData.ts';

export interface ExtraCollider {
  min: Vec3;
  max: Vec3;
  flags: number;
}

/** Creates the collision world for the route plus any extra boxes (background buildings). */
export function buildCollisionWorld(def: LevelDef, extra: readonly ExtraCollider[] = []): CollisionWorld {
  const world = new CollisionWorld(8);
  for (const s of def.solids) {
    if (!s.collide) continue;
    world.add(s.min[0], s.min[1], s.min[2], s.max[0], s.max[1], s.max[2], s.flags);
  }
  for (const e of extra) world.add(e.min[0], e.min[1], e.min[2], e.max[0], e.max[1], e.max[2], e.flags);
  return world;
}
