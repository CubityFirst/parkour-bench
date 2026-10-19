import type { Point3 } from './Geometry';
import type { LevelLayout, Spawn, Zone } from './LevelLayout';

export type ZoneEvent = { kind: 'checkpoint'; index: number; name: string } | { kind: 'finish' };

function inside(zone: Zone, p: Point3): boolean {
  return (
    p.x >= zone.min.x &&
    p.x <= zone.max.x &&
    p.y >= zone.min.y &&
    p.y <= zone.max.y &&
    p.z >= zone.min.z &&
    p.z <= zone.max.z
  );
}

/**
 * Tracks checkpoint progress along the route. Checkpoints only count in order, so cutting
 * across a later zone cannot skip one. Falling respawns the player at the latest one.
 */
export class Checkpoints {
  private reached = -1;

  constructor(private readonly layout: LevelLayout) {}

  /** Index of the latest checkpoint reached, or -1 before the first one. */
  get index(): number {
    return this.reached;
  }

  reset(): void {
    this.reached = -1;
  }

  /** Where the player respawns: the latest checkpoint, or the level start. */
  spawnPoint(): Spawn {
    return this.reached >= 0 ? this.layout.checkpoints[this.reached].spawn : this.layout.spawn;
  }

  /** Returns a zone event when the feet enter the next checkpoint or the finish. */
  check(p: Point3): ZoneEvent | null {
    const checkpoints = this.layout.checkpoints;
    for (let i = this.reached + 1; i < checkpoints.length; i++) {
      if (inside(checkpoints[i], p)) {
        this.reached = i;
        return { kind: 'checkpoint', index: i, name: checkpoints[i].name };
      }
    }
    if (inside(this.layout.finish, p)) return { kind: 'finish' };
    return null;
  }
}
