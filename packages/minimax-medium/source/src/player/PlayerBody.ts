import * as THREE from 'three';
import type { PlayerPhysics } from './PlayerPhysics';

/**
 * Low poly view model: a pair of stylised forearms that stay just inside the
 * bottom of the frame. They are purely decorative and never block the view.
 */
export class PlayerBody {
  readonly group = new THREE.Group();

  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private phase = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xf0f3f6, roughness: 0.7 });
    const cuff = new THREE.MeshStandardMaterial({ color: 0xd8202c, roughness: 0.5 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9b49a, roughness: 0.85 });

    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.22), sleeve);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.062, 0.045), cuff);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), skin);

    for (const arm of [this.leftArm, this.rightArm]) {
      upper.position.set(0, 0, -0.11);
      band.position.set(0, 0, -0.22);
      hand.position.set(0, 0, -0.265);
      upper.castShadow = false;
      band.castShadow = false;
      hand.castShadow = false;
      arm.add(upper, band, hand);
      this.group.add(arm);
    }

    this.leftArm.position.set(-0.2, -0.235, -0.5);
    this.rightArm.position.set(0.2, -0.235, -0.5);
    this.leftArm.rotation.set(-0.22, 0.2, 0.12);
    this.rightArm.rotation.set(-0.22, -0.2, -0.12);

    this.group.name = 'viewmodel';
    camera.add(this.group);
  }

  update(dt: number, physics: PlayerPhysics): void {
    const speed = physics.horizontalSpeed;
    const sprint = Math.min(1, speed / 11);

    if (physics.grounded && !physics.sliding && speed > 0.6) {
      this.phase += dt * (4.0 + speed * 0.9);
    } else {
      this.phase += dt * 1.2;
    }

    const swing = Math.sin(this.phase) * (0.12 + sprint * 0.45);
    const sway = Math.cos(this.phase * 0.5) * 0.02;

    let lx = -0.2;
    let rx = 0.2;
    let ly = -0.235;
    let ry = -0.235;
    let lz = -0.5;
    let rz = -0.5;
    let lrx = -0.22;
    let rrx = -0.22;
    let lry = 0.2;
    let rry = -0.2;

    if (physics.sliding) {
      lz = -0.38;
      rz = -0.38;
      ly = -0.3;
      ry = -0.3;
      lrx = 0.55;
      rrx = 0.55;
    } else if (physics.action?.type === 'vault') {
      lz = -0.62;
      rz = -0.62;
      ly = -0.19;
      ry = -0.19;
      lrx = -0.85;
      rrx = -0.85;
    } else if (physics.wallRun) {
      // The normal points from the wall towards the player. Project it onto
      // the player's right axis to work out which side the wall is on.
      const side = physics.wallRun.normal.x * physics.right.x +
        physics.wallRun.normal.z * physics.right.z;
      if (side > 0) {
        rx = 0.34;
        rz = -0.55;
        rrx = -0.6;
      } else {
        lx = -0.34;
        lz = -0.55;
        lrx = -0.6;
      }
    }

    this.leftArm.position.set(lx, ly + sway, lz);
    this.rightArm.position.set(rx, ry - sway, rz);
    this.leftArm.rotation.set(lrx + swing * 0.35, lry, 0.12);
    this.rightArm.rotation.set(rrx - swing * 0.35, rry, -0.12);
  }
}
