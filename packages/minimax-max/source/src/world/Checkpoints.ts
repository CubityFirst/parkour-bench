import { Vector3 } from 'three';
import type { Checkpoint, Level } from './Level';

/**
 * Keeps track of the checkpoints the player has activated.
 *
 * The most recently reached checkpoint is where the player respawns after a
 * fall or when the restart key is pressed.
 */
export class Checkpoints {
  /** Checkpoint the player respawns at. */
  current: Checkpoint | null = null;
  /** Index of the current checkpoint. */
  index = -1;

  private readonly level: Level;

  constructor(level: Level) {
    this.level = level;
  }

  reset(): void {
    this.current = null;
    this.index = -1;
  }

  /** Returns the checkpoint that was entered this frame, if any. */
  update(position: Vector3): Checkpoint | null {
    for (const checkpoint of this.level.checkpoints) {
      if (checkpoint.id <= this.index) continue;
      // A corridor trigger: the player has to pass the checkpoint while it is
      // roughly on their path.
      if (Math.abs(position.x - checkpoint.position.x) > checkpoint.radius) continue;
      if (Math.abs(position.z - checkpoint.position.z) > checkpoint.radius * 2.5) continue;
      this.index = checkpoint.id;
      this.current = checkpoint;
      return checkpoint;
    }
    return null;
  }

  get spawnPosition(): Vector3 {
    if (this.current) return this.current.position;
    return this.level.spawn.position;
  }

  get spawnYaw(): number {
    if (this.current) return this.current.yaw;
    return this.level.spawn.yaw;
  }
}
