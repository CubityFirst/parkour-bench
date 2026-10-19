import * as THREE from 'three';
import { applyLook, readPlanarBasis } from './basis';
import { BASE_SENS, SPRINT_SPEED } from './constants';
import type { PlayerController } from './PlayerController';

/** Yaw/pitch live on the rig. Roll and bob live on the child camera so movement basis stays level. */
export class FirstPersonCamera {
  readonly rig = new THREE.Object3D();
  readonly camera: THREE.PerspectiveCamera;
  yaw = -Math.PI / 2;
  pitch = -0.08;
  private roll = 0;
  private fov = 76;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(76, aspect, 0.08, 640);
    this.rig.add(this.camera);
    this.syncRig();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  addLook(dx: number, dy: number, sensitivity: number): void {
    const s = BASE_SENS * sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
  }

  syncRig(): void {
    applyLook(this.rig, this.yaw, this.pitch);
  }

  basis(): { fx: number; fz: number; rx: number; rz: number } {
    readPlanarBasis(this.rig, this.forward, this.right);
    return { fx: this.forward.x, fz: this.forward.z, rx: this.right.x, rz: this.right.z };
  }

  updateEffects(
    player: PlayerController,
    strafe: number,
    dt: number,
    motion: number,
    menu: boolean,
  ): void {
    const speed = player.horizontalSpeed;
    const sprinting = speed / SPRINT_SPEED;
    const bobAmp = menu ? 0 : 0.018 * Math.min(1, sprinting) * motion;
    const bob = Math.sin(player.stepCycle) * bobAmp;
    const sway = Math.cos(player.stepCycle * 0.5) * bobAmp * 0.45;
    this.camera.position.set(sway, bob - player.landDip * motion, 0);

    let rollTarget = menu ? 0 : strafe * -0.04 * motion;
    if (player.state === 'wallrun') {
      const side = this.right.x * player.wallNx + this.right.z * player.wallNz;
      rollTarget += side * 0.2 * (0.35 + 0.65 * motion);
    }
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-8 * dt));
    this.camera.rotation.z = this.roll;
    this.camera.rotation.x = -player.actionBlend * 0.06 * motion;

    const kick = menu ? 0 : Math.min(1, sprinting) * 11 * motion;
    const targetFov = 76 + kick;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-6 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
