import * as THREE from 'three';
import type { CheckpointDef } from './Level';

/** Checkpoint beacons: red until reached, then they turn white. */
export class Checkpoints {
  current = -1;
  private beacons: THREE.Mesh[] = [];
  private activeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fc4ff, emissiveIntensity: 0.5 });
  private idleMat = new THREE.MeshStandardMaterial({ color: 0xff2a1f, emissive: 0xff1a10, emissiveIntensity: 0.5 });

  constructor(public defs: CheckpointDef[], scene: THREE.Scene) {
    const poleGeo = new THREE.BoxGeometry(0.12, 2.6, 0.12);
    const flagGeo = new THREE.BoxGeometry(0.9, 0.5, 0.04);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xb4bac2 });
    for (const d of defs) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(d.pos.x - 3, d.pos.y + 1.3, d.pos.z);
      pole.castShadow = true;
      const flag = new THREE.Mesh(flagGeo, this.idleMat);
      flag.position.set(d.pos.x - 2.5, d.pos.y + 2.3, d.pos.z);
      flag.castShadow = true;
      scene.add(pole, flag);
      this.beacons.push(flag);
    }
  }

  reset() {
    this.current = -1;
    for (const b of this.beacons) b.material = this.idleMat;
  }

  /** Returns the index of a newly reached checkpoint, or -1. Crossing its z-line counts. */
  update(pos: THREE.Vector3, time: number): number {
    for (const b of this.beacons) b.rotation.y = Math.sin(time * 2 + b.position.z) * 0.15;
    const next = this.current + 1;
    if (next >= this.defs.length) return -1;
    const d = this.defs[next];
    if (pos.z < d.pos.z + 1 && pos.y > d.pos.y - 2) {
      this.current = next;
      this.beacons[next].material = this.activeMat;
      return next;
    }
    return -1;
  }
}
