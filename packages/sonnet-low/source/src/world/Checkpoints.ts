import * as THREE from 'three';

export interface Checkpoint {
  pos: THREE.Vector3;
  minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number;
  active: boolean;
  disc?: THREE.Mesh;
}

export class Checkpoints {
  list: Checkpoint[] = [];
  current = 0;

  add(pos: THREE.Vector3, halfW: number, disc?: THREE.Mesh): void {
    this.list.push({
      pos: pos.clone(),
      minX: pos.x - halfW, maxX: pos.x + halfW,
      minZ: pos.z - 2.5, maxZ: pos.z + 2.5,
      minY: pos.y - 2, maxY: pos.y + 4,
      active: this.list.length === 0, disc,
    });
  }

  get respawn(): THREE.Vector3 { return this.list[this.current].pos; }

  /** Returns a checkpoint when the player has just activated a new one. */
  update(p: THREE.Vector3): Checkpoint | null {
    for (let i = this.current + 1; i < this.list.length; i++) {
      const c = this.list[i];
      if (p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && p.y > c.minY && p.y < c.maxY) {
        c.active = true;
        this.current = i;
        return c;
      }
    }
    return null;
  }

  reset(): void {
    this.current = 0;
    this.list.forEach((c, i) => { c.active = i === 0; });
  }
}
