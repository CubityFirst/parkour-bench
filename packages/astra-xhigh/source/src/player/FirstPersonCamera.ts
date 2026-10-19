import * as THREE from "three";
import { PlayerController } from "./PlayerController";

export class FirstPersonCamera {
  private eyeHeight = 1.65;
  private bobTime = 0;
  private roll = 0;
  private body = new THREE.Group();
  private arms: THREE.Group[] = [];
  constructor(public camera: THREE.PerspectiveCamera) {
    camera.rotation.order = "YXZ";
    const skin = new THREE.MeshStandardMaterial({
      color: 0xb98e74,
      roughness: 0.85,
    });
    const sleeve = new THREE.MeshStandardMaterial({
      color: 0xeceee5,
      roughness: 0.9,
    });
    const glove = new THREE.MeshStandardMaterial({
      color: 0x253b43,
      roughness: 0.85,
    });
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.32, -0.45, -0.35);
      const forearm = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.35, 0.13),
        sleeve,
      );
      forearm.rotation.x = -0.5;
      arm.add(forearm);
      const hand = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.14, 0.15),
        skin,
      );
      hand.position.set(0, 0.18, -0.08);
      arm.add(hand);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.135, 0.075, 0.145),
        side === -1
          ? new THREE.MeshStandardMaterial({ color: 0xec3c29 })
          : glove,
      );
      band.position.set(0, 0.1, -0.04);
      arm.add(band);
      this.arms.push(arm);
      this.body.add(arm);
    }
    camera.add(this.body);
    this.body.visible = false;
  }
  update(player: PlayerController, dt: number, reduced: boolean) {
    const factor = 1 - Math.exp(-dt * 15),
      motion = reduced ? 0.12 : 1;
    this.eyeHeight = THREE.MathUtils.lerp(
      this.eyeHeight,
      player.height - 0.14,
      factor,
    );
    this.bobTime += dt * player.speed * 1.45;
    const bob =
      player.grounded && !player.sliding
        ? Math.sin(this.bobTime) *
          0.026 *
          Math.min(1, player.speed / 7) *
          motion
        : 0;
    this.camera.position.copy(player.position);
    this.camera.position.y += this.eyeHeight + bob - player.impact * motion;
    this.camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
    const strafe =
      player.velocity.x * Math.cos(player.yaw) -
      player.velocity.z * Math.sin(player.yaw);
    const tilt =
      player.wallSide * 0.105 -
      strafe * 0.002 +
      Math.sin(this.bobTime * 0.5) * 0.004 * Math.min(1, player.speed / 8);
    this.roll = THREE.MathUtils.lerp(this.roll, tilt, 1 - Math.exp(-dt * 8));
    this.camera.rotation.z = this.roll * motion;
    const targetFov =
      77 + Math.min(1, player.speed / 13.5) * 8 * (reduced ? 0.3 : 1);
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      targetFov,
      1 - Math.exp(-dt * 6),
    );
    this.camera.updateProjectionMatrix();
    this.body.visible = true;
    this.arms.forEach((arm, i) => {
      const sprint = player.speed > 9 && player.grounded;
      arm.position.y =
        -0.69 +
        (sprint ? Math.sin(this.bobTime * 0.5 + i * Math.PI) * 0.085 : 0) +
        player.vaultMotion * 0.43 +
        (player.sliding ? 0.12 : 0);
      arm.position.z = -0.3 - player.vaultMotion * 0.25;
      arm.rotation.x =
        player.vaultMotion * 1.05 +
        (sprint ? Math.sin(this.bobTime * 0.5 + i * Math.PI) * 0.22 : 0);
      arm.visible =
        sprint ||
        player.vaultMotion > 0.02 ||
        player.sliding ||
        player.pitch < -0.6;
    });
  }
  hideBody() {
    this.body.visible = false;
  }
}
