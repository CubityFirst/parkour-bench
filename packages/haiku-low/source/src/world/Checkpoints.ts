import { Vector3 } from 'three';

export interface CheckpointDef {
  readonly spawn: Vector3;
  /** Activated once the player's feet pass this z (moving towards -z). */
  readonly triggerZ: number;
}

/** Tracks the latest checkpoint the player has crossed. */
export class Checkpoints {
  private activeIndex = -1;

  constructor(
    private readonly defs: readonly CheckpointDef[],
    private readonly startSpawn: Vector3,
  ) {}

  get spawn(): Vector3 {
    return this.activeIndex < 0 ? this.startSpawn : this.defs[this.activeIndex].spawn;
  }

  reset(): void {
    this.activeIndex = -1;
  }

  /** Activates the next checkpoint when its trigger line is crossed. Returns true when one activates. */
  update(feet: Vector3): boolean {
    const next = this.activeIndex + 1;
    if (next >= this.defs.length || feet.z >= this.defs[next].triggerZ) return false;
    this.activeIndex = next;
    return true;
  }
}
