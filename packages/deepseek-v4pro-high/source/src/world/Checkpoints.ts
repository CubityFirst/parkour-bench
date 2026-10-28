import * as THREE from 'three';

export interface Checkpoint {
  position: THREE.Vector3;
  yaw: number;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface FinishTrigger {
  position: THREE.Vector3;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/**
 * Manages checkpoint progression and the finish trigger. Checkpoints only
 * advance forward (never regress), so respawning never sends the player
 * backward past a point they have already reached.
 */
export class Checkpoints {
  readonly list: Checkpoint[] = [];
  activeIndex = 0;
  finish: FinishTrigger | null = null;

  get active(): Checkpoint {
    return this.list[Math.max(0, this.activeIndex)];
  }

  reset(): void {
    this.activeIndex = 0;
  }

  /** Returns true if a new checkpoint was activated this call. */
  update(pos: THREE.Vector3): boolean {
    for (let i = this.activeIndex + 1; i < this.list.length; i++) {
      const c = this.list[i];
      if (this.contains(c.min, c.max, pos)) {
        this.activeIndex = i;
        return true;
      }
    }
    return false;
  }

  checkFinish(pos: THREE.Vector3): boolean {
    if (!this.finish) return false;
    return this.contains(this.finish.min, this.finish.max, pos);
  }

  private contains(min: THREE.Vector3, max: THREE.Vector3, pos: THREE.Vector3): boolean {
    return (
      pos.x >= min.x &&
      pos.x <= max.x &&
      pos.y >= min.y &&
      pos.y <= max.y &&
      pos.z >= min.z &&
      pos.z <= max.z
    );
  }
}
