import * as THREE from 'three';

/**
 * A checkpoint: a trigger volume on the route plus the respawn transform.
 */
export class Checkpoint {
  readonly position: THREE.Vector3;
  readonly radius = 3.2;

  constructor(
    readonly index: number,
    x: number,
    y: number,
    z: number,
    readonly label: string
  ) {
    this.position = new THREE.Vector3(x, y, z);
  }

  contains(p: THREE.Vector3): boolean {
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    if (dx * dx + dz * dz > this.radius * this.radius) return false;
    return Math.abs(p.y - this.position.y) < 3.5;
  }
}

/**
 * Keeps track of the latest checkpoint the player has passed.
 */
export class CheckpointManager {
  active: Checkpoint | null = null;
  activeIndex = -1;

  constructor(private readonly checkpoints: Checkpoint[]) {
    if (checkpoints.length > 0) this.active = checkpoints[0];
  }

  /** Returns the checkpoint that was just reached, if any. */
  update(playerPosition: THREE.Vector3): Checkpoint | null {
    for (const checkpoint of this.checkpoints) {
      if (checkpoint.index <= this.activeIndex) continue;
      if (checkpoint.contains(playerPosition)) {
        this.active = checkpoint;
        this.activeIndex = checkpoint.index;
        return checkpoint;
      }
    }
    return null;
  }

  reset(): void {
    this.activeIndex = -1;
    this.active = this.checkpoints.length > 0 ? this.checkpoints[0] : null;
  }

  get list(): Checkpoint[] {
    return this.checkpoints;
  }
}
