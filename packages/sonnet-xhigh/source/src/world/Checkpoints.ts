/**
 * Checkpoints: runtime progression logic (CheckpointManager) and the in-world marker
 * visuals (CheckpointMarker).
 */

import * as THREE from 'three';
import { type CheckpointSpec } from './LevelSpec';

const RED = new THREE.Color(0xe0231c);
const WHITE = new THREE.Color(0xf4f6f8);

/** A red mast with a banner and a glowing light column. Turns white once activated. */
export class CheckpointMarker {
  readonly group = new THREE.Group();
  private readonly poleMat: THREE.MeshStandardMaterial;
  private readonly bannerMat: THREE.MeshStandardMaterial;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly beam: THREE.Mesh;

  constructor(spec: CheckpointSpec) {
    this.poleMat = new THREE.MeshStandardMaterial({
      color: RED, roughness: 0.4, emissive: new THREE.Color(0xff1408), emissiveIntensity: 0.18,
    });
    this.bannerMat = new THREE.MeshStandardMaterial({
      color: RED, roughness: 0.55, emissive: new THREE.Color(0xff1408), emissiveIntensity: 0.18,
    });
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xff2a1c, transparent: true, opacity: 0.13, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    });

    const pole = new THREE.BoxGeometry(0.16, 3.4, 0.16);
    pole.translate(0, 1.7, 0);
    const arm = new THREE.BoxGeometry(0.9, 0.08, 0.08);
    arm.translate(0.45, 3.3, 0);
    const banner = new THREE.BoxGeometry(0.85, 1.1, 0.04);
    banner.translate(0.5, 2.7, 0);
    const pad = new THREE.BoxGeometry(2.4, 0.03, 2.4);
    pad.translate(0, 0.015, 0);
    const beam = new THREE.CylinderGeometry(0.55, 0.55, 14, 20, 1, true);
    beam.translate(0, 7, 0);
    this.geos.push(pole, arm, banner, pad, beam);

    const poleMesh = new THREE.Mesh(pole, this.poleMat);
    const armMesh = new THREE.Mesh(arm, this.poleMat);
    const bannerMesh = new THREE.Mesh(banner, this.bannerMat);
    const padMesh = new THREE.Mesh(pad, this.poleMat);
    this.beam = new THREE.Mesh(beam, this.beamMat);
    this.beam.renderOrder = 5;
    for (const m of [poleMesh, armMesh, bannerMesh]) m.castShadow = true;
    padMesh.receiveShadow = true;
    this.group.add(poleMesh, armMesh, bannerMesh, padMesh, this.beam);
    this.group.position.set(spec.markerPos[0], spec.markerPos[1], spec.markerPos[2]);
    // The banner always points along the run direction (towards the next section).
    this.group.rotation.y = spec.yaw;
    // The start checkpoint (index 0) has no visible beam: you spawn there.
    this.setActive(false);
    if (spec.index === 0) this.group.visible = false;
  }

  setActive(active: boolean): void {
    this.poleMat.color.copy(active ? WHITE : RED);
    this.bannerMat.color.copy(active ? WHITE : RED);
    this.poleMat.emissiveIntensity = active ? 0.02 : 0.18;
    this.bannerMat.emissiveIntensity = active ? 0.02 : 0.18;
    this.beam.visible = !active;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.poleMat.dispose();
    this.bannerMat.dispose();
    this.beamMat.dispose();
  }
}

export class CheckpointManager {
  /** Index into `specs` of the last activated checkpoint. */
  private currentIndex = 0;
  private readonly reached = new Set<number>([0]);

  constructor(
    private readonly specs: CheckpointSpec[],
    private readonly markers: CheckpointMarker[],
  ) {
    this.reset();
  }

  get current(): CheckpointSpec {
    return this.specs[this.currentIndex];
  }

  get count(): number {
    return this.specs.length - 1;
  }

  reset(): void {
    this.currentIndex = 0;
    this.reached.clear();
    this.reached.add(0);
    this.markers.forEach((m, i) => m.setActive(i === 0));
  }

  /** Returns the checkpoint that was newly activated by the player at this position, if any. */
  update(x: number, y: number, z: number): CheckpointSpec | null {
    for (let i = this.currentIndex + 1; i < this.specs.length; i++) {
      const cp = this.specs[i];
      if (
        x >= cp.triggerMin[0] && x <= cp.triggerMax[0] &&
        y >= cp.triggerMin[1] - 1 && y <= cp.triggerMax[1] &&
        z >= cp.triggerMin[2] && z <= cp.triggerMax[2]
      ) {
        this.currentIndex = i;
        this.reached.add(i);
        // Mark this and any skipped checkpoints as done.
        for (let k = 0; k <= i; k++) this.markers[k].setActive(true);
        return cp;
      }
    }
    return null;
  }
}
