import { Vec3, containsPoint } from './CollisionWorld';

export interface Checkpoint {
  name: string;
  /** Trigger volume. Entering it activates the checkpoint. */
  zone: { min: Vec3; max: Vec3 };
  /** Feet position the player respawns at. */
  spawn: Vec3;
}

/**
 * Tracks the furthest checkpoint reached. Checkpoints only move forward,
 * so respawning never sends the player back to an earlier section.
 */
export class Checkpoints {
  /** Index into `list`. -1 means the level start. */
  private active = -1;

  constructor(
    private readonly list: Checkpoint[],
    private readonly start: Vec3,
  ) {}

  /** Returns the newly activated checkpoint, if the position entered the next zone. */
  update(pos: Vec3): Checkpoint | null {
    for (let i = this.active + 1; i < this.list.length; i++) {
      const cp = this.list[i];
      if (containsPoint(pos, cp.zone.min, cp.zone.max)) {
        this.active = i;
        return cp;
      }
    }
    return null;
  }

  /** Respawn point for the currently active checkpoint. */
  get spawn(): Vec3 {
    return this.active < 0 ? this.start : this.list[this.active].spawn;
  }

  get activeName(): string {
    return this.active < 0 ? 'START' : this.list[this.active].name;
  }

  reset(): void {
    this.active = -1;
  }
}
