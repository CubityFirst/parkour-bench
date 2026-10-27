import type { Mesh, MeshStandardMaterial } from 'three';
import { pointInTrigger, type TriggerBox } from './CollisionWorld';

export interface Checkpoint {
  name: string;
  trigger: TriggerBox;
  spawn: { x: number; y: number; z: number; yaw: number };
  /** Meshes whose material swaps when activated. */
  markers: Mesh[];
  activated: boolean;
}

/**
 * Tracks the latest reached checkpoint and switches its marker from red
 * (unvisited) to glowing white (activated).
 */
export class Checkpoints {
  private current = -1;

  constructor(
    readonly list: Checkpoint[],
    private start: Checkpoint['spawn'],
    private offMat: MeshStandardMaterial,
    private onMat: MeshStandardMaterial,
  ) {}

  /** Returns the checkpoint that was just activated, if any. */
  update(x: number, y: number, z: number): Checkpoint | null {
    for (let i = this.current + 1; i < this.list.length; i++) {
      const cp = this.list[i];
      if (!cp.activated && pointInTrigger(cp.trigger, x, y, z)) {
        // Activate this and any skipped earlier checkpoints.
        for (let j = 0; j <= i; j++) this.activate(this.list[j]);
        this.current = i;
        return cp;
      }
    }
    return null;
  }

  private activate(cp: Checkpoint): void {
    cp.activated = true;
    for (const m of cp.markers) m.material = this.onMat;
  }

  get respawn(): Checkpoint['spawn'] {
    return this.current >= 0 ? this.list[this.current].spawn : this.start;
  }

  get index(): number { return this.current; }

  reset(): void {
    this.current = -1;
    for (const cp of this.list) {
      cp.activated = false;
      for (const m of cp.markers) m.material = this.offMat;
    }
  }
}
