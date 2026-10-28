import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { COLORS, PHYSICS } from '../game/Config';
import type { PlayerController } from './PlayerController';

/**
 * Minimal body feedback: two stylised arms that live in the bottom corners of
 * the view. They are deliberately small and low poly - they hint at the
 * movement state without ever blocking the route ahead.
 */
export class ViewModel {
  readonly group = new Group();
  private readonly leftArm = new Group();
  private readonly rightArm = new Group();
  private phase = 0;
  private reach = 0;

  constructor(camera: PerspectiveCamera) {
    const skin = new MeshStandardMaterial({ color: 0xdedad4, roughness: 0.78, metalness: 0.02 });
    const cuff = new MeshStandardMaterial({ color: COLORS.red, roughness: 0.55, metalness: 0.05 });

    const upper = new BoxGeometry(0.1, 0.18, 0.1);
    const fore = new BoxGeometry(0.085, 0.2, 0.085);
    const hand = new BoxGeometry(0.09, 0.1, 0.11);

    for (const arm of [this.leftArm, this.rightArm]) {
      const upperMesh = new Mesh(upper, skin);
      upperMesh.position.set(0, -0.09, 0);
      const foreMesh = new Mesh(fore, skin);
      foreMesh.position.set(0, -0.26, 0.02);
      const cuffMesh = new Mesh(new BoxGeometry(0.095, 0.05, 0.095), cuff);
      cuffMesh.position.set(0, -0.18, 0.015);
      const handMesh = new Mesh(hand, skin);
      handMesh.position.set(0, -0.4, 0.04);
      arm.add(upperMesh, foreMesh, cuffMesh, handMesh);
      arm.rotation.set(-0.45, 0, 0);
      this.group.add(arm);
    }

    this.leftArm.position.set(-0.33, 0.01, -0.8);
    this.rightArm.position.set(0.33, 0.01, -0.8);
    this.leftArm.scale.setScalar(0.72);
    this.rightArm.scale.setScalar(0.72);
    this.group.position.set(0, 0, 0);
    camera.add(this.group);
  }

  update(dt: number, player: PlayerController): void {
    const speed = player.speed;
    const speedFactor = Math.min(1, speed / PHYSICS.sprintSpeed);
    this.phase += speed * dt * 1.55;

    const parkour = player.parkour;
    const sliding = parkour.state === 'slide';
    const wallRunning = parkour.state === 'wallrun';
    const vaulting = parkour.state === 'vault';

    // Arms reach forward and up while vaulting.
    const reachTarget = vaulting ? 1 : 0;
    this.reach += (reachTarget - this.reach) * Math.min(1, dt * 9);

    const swing = Math.sin(this.phase) * 0.55 * speedFactor;
    const swing2 = Math.sin(this.phase + Math.PI) * 0.55 * speedFactor;

    const baseX = sliding ? -1.15 : -0.5;
    const baseZ = sliding ? 0.25 : 0;

    this.leftArm.rotation.set(baseX + swing * 0.5 - this.reach * 0.9, 0.12, 0.22 + this.reach * 0.2);
    this.rightArm.rotation.set(baseX + swing2 * 0.5 - this.reach * 0.9, -0.12, -0.22 - this.reach * 0.2);

    this.leftArm.position.set(-0.33, 0.01 - (sliding ? 0.05 : 0), -0.8 + baseZ);
    this.rightArm.position.set(0.33, 0.01 - (sliding ? 0.05 : 0), -0.8 + baseZ);

    if (wallRunning) {
      // One arm reaches towards the wall the player is attached to.
      const side = parkour.wallSide;
      const wallArm = side > 0 ? this.rightArm : this.leftArm;
      wallArm.rotation.z = (side > 0 ? -0.9 : 0.9);
      wallArm.rotation.x = -0.9;
    }

    this.group.visible = speed > 0.4 || sliding || vaulting || wallRunning;
  }
}
