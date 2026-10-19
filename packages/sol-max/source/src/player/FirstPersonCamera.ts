import * as THREE from "three";
import { PlayerPhysics } from "./PlayerPhysics";
import { Input } from "./Input";

export class FirstPersonCamera {
  reducedMotion = false;
  private eyeHeight = 1.63;
  private bobPhase = 0;
  private arms = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private pitch = 0;
  private yaw = 0;
  private roll = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private player: PlayerPhysics,
    private input: Input,
  ) {
    camera.rotation.order = "YXZ";
    const sleeve = new THREE.MeshStandardMaterial({
      color: "#eff0e6",
      roughness: 0.9,
    });
    const glove = new THREE.MeshStandardMaterial({
      color: "#df3326",
      roughness: 0.75,
    });
    const skin = new THREE.MeshStandardMaterial({
      color: "#c18c6b",
      roughness: 0.9,
    });
    for (const [group, side] of [
      [this.leftArm, -1],
      [this.rightArm, 1],
    ] as const) {
      const forearm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.09, 0.4, 7),
        sleeve,
      );
      forearm.rotation.x = -0.8;
      forearm.position.set(0, -0.09, 0.08);
      group.add(forearm);
      const hand = new THREE.Mesh(
        new THREE.BoxGeometry(0.105, 0.14, 0.13),
        glove,
      );
      hand.position.set(0, 0.07, -0.06);
      hand.rotation.x = -0.4;
      group.add(hand);
      const fingers = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.045, 0.095),
        skin,
      );
      fingers.position.set(0, 0.13, -0.075);
      group.add(fingers);
      group.position.set(side * 0.43, -0.6, -0.66);
      group.rotation.z = side * -0.2;
      group.scale.setScalar(0.8);
      this.arms.add(group);
    }
    this.arms.visible = false;
    camera.add(this.arms);
  }

  reset(): void {
    this.yaw = this.input.yaw;
    this.pitch = this.input.pitch;
    this.eyeHeight = 1.63;
    this.roll = 0;
  }

  update(dt: number, alpha: number): void {
    const p = this.player,
      motion = this.reducedMotion ? 0.15 : 1;
    const position = p.previous.clone().lerp(p.position, alpha);
    this.eyeHeight = THREE.MathUtils.damp(
      this.eyeHeight,
      p.crouching ? 0.69 : 1.63,
      15,
      dt,
    );
    this.bobPhase += dt * p.speed * 0.95;
    const bob =
      p.grounded && p.speed > 1
        ? Math.sin(this.bobPhase * 2) *
          0.026 *
          motion *
          Math.min(1, p.speed / 10)
        : 0;
    this.camera.position.copy(position);
    this.camera.position.y += this.eyeHeight + bob - p.landingImpact * motion;
    this.pitch = THREE.MathUtils.damp(this.pitch, this.input.pitch, 40, dt);
    this.yaw = THREE.MathUtils.damp(this.yaw, this.input.yaw, 40, dt);
    const sideVelocity =
      p.velocity.x * Math.cos(this.yaw) - p.velocity.z * Math.sin(this.yaw);
    const targetRoll = p.activeWall
      ? p.wallSide * 0.13
      : -sideVelocity * 0.0018;
    this.roll = THREE.MathUtils.damp(this.roll, targetRoll * motion, 10, dt);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, "YXZ");
    this.camera.fov = THREE.MathUtils.damp(
      this.camera.fov,
      78 + Math.min(p.speed / 14.2, 1) * (this.reducedMotion ? 3 : 10),
      5,
      dt,
    );
    this.camera.updateProjectionMatrix();
    this.arms.visible = p.speed > 1 || !!p.traversal || p.sliding;
    const vault = p.traversal
      ? Math.sin((p.traversal.elapsed / p.traversal.duration) * Math.PI)
      : 0;
    const run = Math.min(1, p.speed / 12);
    for (const [arm, side] of [
      [this.leftArm, -1],
      [this.rightArm, 1],
    ] as const) {
      arm.position.y =
        -0.6 +
        Math.sin(this.bobPhase + (side > 0 ? Math.PI : 0)) *
          0.035 *
          run *
          motion +
        vault * 0.23;
      arm.position.x = side * (0.43 - vault * 0.07);
      arm.position.z =
        -0.66 -
        vault * 0.06 +
        Math.cos(this.bobPhase + side) * 0.025 * run * motion;
      arm.rotation.x = vault * -0.6 + (p.sliding ? -0.4 : 0);
    }
  }

  hideBody(): void {
    this.arms.visible = false;
  }
}
