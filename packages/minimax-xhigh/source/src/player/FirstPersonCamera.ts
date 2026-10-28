import * as THREE from 'three';
import { CAMERA, PLAYER } from '../game/Config';
import { PlayerController } from './PlayerController';

const DEG = Math.PI / 180;

/**
 * First person camera rig.
 *
 * Adds the small amounts of feedback that make movement readable:
 * speed based field of view, subtle head bob, strafe lean, wall run tilt,
 * a landing dip and a vault push. Everything scales with `motionScale` so the
 * player can dial the camera motion down (or off) in the settings menu.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** 0 = no camera motion, 1 = full. */
  motionScale = 1;
  /** Multiplier on top of the base mouse sensitivity. */
  sensitivity = 1;

  private bobPhase = 0;
  private roll = 0;
  private fov = CAMERA.fovBase;
  private landDip = 0;
  private landVel = 0;
  private vaultTilt = 0;
  private vaultAmount = 0;
  private eyeOffset = PLAYER.height - PLAYER.eyeInset;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovBase, aspect, 0.05, 4000);
    this.camera.rotation.order = 'YXZ';
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Trigger the landing compression. */
  impact(strength: number): void {
    const amount = Math.min(strength * CAMERA.landDipScale, CAMERA.landDipMax) * this.motionScale;
    this.landVel -= amount * 8;
  }

  /** Called when a vault starts so the camera dips in sync with the body. */
  vault(): void {
    this.vaultAmount = 1;
  }

  update(dt: number, player: PlayerController): void {
    const phys = player.physics;
    const speed = phys.horizontalSpeed;
    const ratio = Math.min(1, speed / PLAYER.sprintSpeed);

    // ---------------- field of view ----------------
    let fovTarget = CAMERA.fovBase + (CAMERA.fovSprint - CAMERA.fovBase) * Math.pow(ratio, 1.5);
    if (player.sliding) fovTarget = CAMERA.fovSlide;
    if (player.isWallRunning) fovTarget += 4;
    this.fov += (fovTarget - this.fov) * Math.min(1, CAMERA.fovLerp * dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // ---------------- head bob ----------------
    const bobbing = phys.grounded && !player.sliding && !player.isWallRunning;
    if (bobbing) this.bobPhase += speed * dt * CAMERA.bobFrequency;
    const amp = bobbing ? ratio * this.motionScale : 0;
    const bobY = Math.sin(this.bobPhase * 2.0) * CAMERA.bobVertical * amp;
    const bobX = Math.cos(this.bobPhase) * CAMERA.bobLateral * amp;

    // ---------------- landing spring ----------------
    this.landVel += (-this.landDip * CAMERA.landSpring - this.landVel * CAMERA.landDamp) * dt;
    this.landDip += this.landVel * dt;

    // ---------------- roll ----------------
    let rollTarget = -player.strafeInput * CAMERA.strafeRoll;
    if (player.isWallRunning) rollTarget = -player.wallSide * CAMERA.wallRoll;
    if (player.sliding) rollTarget = -player.strafeInput * CAMERA.strafeRoll * 0.6;
    this.roll += (rollTarget - this.roll) * Math.min(1, 9 * dt);

    // ---------------- vault tilt ----------------
    if (this.vaultAmount > 0) this.vaultAmount = Math.max(0, this.vaultAmount - dt / 0.4);
    this.vaultTilt += (this.vaultAmount * CAMERA.vaultDip - this.vaultTilt) * Math.min(1, 10 * dt);

    // ---------------- assemble ----------------
    // The eye follows the body height, but it is never allowed to sit higher
    // than the body itself (that would clip through low obstacles).
    const targetEye = phys.eyeHeight;
    if (targetEye < this.eyeOffset) this.eyeOffset = targetEye;
    else this.eyeOffset += (targetEye - this.eyeOffset) * Math.min(1, 12 * dt);
    const eye = Math.min(this.eyeOffset, targetEye);

    this.camera.position.set(
      phys.position.x + bobX * 0.5,
      phys.position.y + eye + bobY + this.landDip,
      phys.position.z,
    );

    this.camera.rotation.set(
      player.pitch - this.vaultTilt * 0.5,
      player.yaw,
      this.roll * DEG,
    );
  }
}
