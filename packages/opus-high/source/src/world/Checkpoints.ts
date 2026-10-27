import * as THREE from 'three';
import { type CheckpointDef, type Level, zoneContains } from './Level';

const BEAM_RED = new THREE.Color('#e8261c');
const BEAM_DONE = new THREE.Color('#ffffff');

interface Beacon {
  beam: THREE.Mesh;
  ring: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  ringMaterial: THREE.MeshBasicMaterial;
  activatedAt: number;
}

/**
 * Checkpoint progression, finish detection and their light-beam markers.
 */
export class Checkpoints {
  readonly group = new THREE.Group();
  current = 0;
  private beacons: Array<Beacon | null> = [];
  private finishBeam: THREE.Mesh;
  private time = 0;

  constructor(private readonly level: Level) {
    this.group.name = 'checkpoints';
    const beamGeo = new THREE.CylinderGeometry(0.28, 0.28, 60, 16, 1, true).translate(0, 30, 0);
    const ringGeo = new THREE.RingGeometry(0.55, 0.8, 32).rotateX(-Math.PI / 2);

    for (const cp of level.checkpoints) {
      if (cp.index === 0) {
        this.beacons.push(null);
        continue;
      }
      const material = new THREE.MeshBasicMaterial({
        color: BEAM_RED,
        transparent: true,
        opacity: 0.35,
                depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ringMaterial = new THREE.MeshBasicMaterial({ color: BEAM_RED, transparent: true, opacity: 0.9, depthWrite: false });
      const beam = new THREE.Mesh(beamGeo, material);
      beam.position.copy(cp.marker);
      const ring = new THREE.Mesh(ringGeo, ringMaterial);
      ring.position.copy(cp.marker).add(new THREE.Vector3(0, 0.04, 0));
      this.group.add(beam, ring);
      this.beacons.push({ beam, ring, material, ringMaterial, activatedAt: -1 });
    }

    const finishMat = new THREE.MeshBasicMaterial({
      color: BEAM_RED,
      transparent: true,
      opacity: 0.45,
            depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.finishBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 140, 20, 1, true).translate(0, 70, 0), finishMat);
    this.finishBeam.position.copy(level.finishMarker);
    this.group.add(this.finishBeam);
  }

  get active(): CheckpointDef {
    return this.level.checkpoints[this.current];
  }

  /** Returns the newly reached checkpoint, if any. */
  check(pos: THREE.Vector3): CheckpointDef | null {
    for (let i = this.current + 1; i < this.level.checkpoints.length; i++) {
      const cp = this.level.checkpoints[i];
      if (zoneContains(cp.zone, pos)) {
        this.current = i;
        const b = this.beacons[i];
        if (b) b.activatedAt = this.time;
        return cp;
      }
    }
    return null;
  }

  reachedFinish(pos: THREE.Vector3): boolean {
    return zoneContains(this.level.finishZone, pos);
  }

  reset(): void {
    this.current = 0;
    for (const b of this.beacons) {
      if (!b) continue;
      b.activatedAt = -1;
      b.material.color.copy(BEAM_RED);
      b.material.opacity = 0.35;
      b.ringMaterial.color.copy(BEAM_RED);
      b.beam.scale.set(1, 1, 1);
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.beacons) {
      if (!b) continue;
      if (b.activatedAt < 0) {
        b.material.opacity = 0.3 + 0.08 * Math.sin(this.time * 3);
      } else {
        // Flash white, then settle into a thin pale beam.
        const t = this.time - b.activatedAt;
        const k = Math.min(1, t / 0.6);
        b.material.color.copy(BEAM_RED).lerp(BEAM_DONE, k);
        b.ringMaterial.color.copy(BEAM_RED).lerp(BEAM_DONE, k);
        b.material.opacity = t < 0.25 ? 0.8 : THREE.MathUtils.lerp(0.8, 0.12, Math.min(1, (t - 0.25) / 1.2));
        const s = t < 0.25 ? 1 + t * 6 : THREE.MathUtils.lerp(2.5, 0.5, Math.min(1, (t - 0.25) / 0.8));
        b.beam.scale.set(s, 1, s);
      }
    }
    (this.finishBeam.material as THREE.MeshBasicMaterial).opacity = 0.32 + 0.1 * Math.sin(this.time * 2.2);
  }
}
