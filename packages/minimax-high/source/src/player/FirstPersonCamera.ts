import * as THREE from 'three';
import { CAM, PHYS } from '../core/Config';
import { clamp, damp } from '../core/MathUtil';
import { Input } from '../game/Input';
import { PlayerController } from './PlayerController';

/**
 * First person camera rig.
 *
 * Handles mouse look, the head bob, speed based field of view, strafe and
 * wall-run roll, landing impact and the vault "dip". All of it is scaled by
 * the camera-motion setting so the game stays comfortable to play.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;

  yaw = -Math.PI / 2;
  pitch = 0;

  /** 0 = no camera motion, 1 = full camera motion. */
  motionScale = 1;

  private bobPhase = 0;
  private bobAmount = 0;
  private landOffset = 0;
  private landVelocity = 0;
  private pitchOffset = 0;
  private roll = 0;
  private eyeHeight = PHYS.eyeStand;
  private fov = CAM.fovBase;

  private readonly tmp = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAM.fovBase, aspect, 0.05, 2600);
    this.camera.rotation.order = 'YXZ';
  }

  /** Applies mouse look. Called once per rendered frame. */
  handleMouse(input: Input): void {
    const s = 0.0022 * input.sensitivity;
    this.yaw -= input.mouseDX * s;
    this.pitch -= input.mouseDY * s;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  }

  /** Small downward pitch kick used to sell a vault. */
  vaultKick(): void {
    this.pitchOffset += CAM.vaultPitch;
  }

  /** Landing impact kick. */
  land(impact: number): void {
    this.landVelocity -= impact * CAM.landingKick;
  }

  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0;
    this.landOffset = 0;
    this.landVelocity = 0;
    this.pitchOffset = 0;
    this.roll = 0;
    this.bobPhase = 0;
    this.fov = CAM.fovBase;
    this.eyeHeight = PHYS.eyeStand;
  }

  update(dt: number, player: PlayerController): void {
    const body = player.body;
    const speed = body.horizontalSpeed;

    // --- eye height (slide transition) -----------------------------------
    const targetEye =
      PHYS.eyeStand + (PHYS.eyeSlide - PHYS.eyeStand) * clamp(player.slideAmount, 0, 1);
    this.eyeHeight = damp(this.eyeHeight, targetEye, 12, dt);

    // --- head bob ---------------------------------------------------------
    const moving = body.grounded && speed > 0.5 ? 1 : 0;
    const speedFactor = clamp(speed / PHYS.sprintSpeed, 0, 1);
    const targetBob = moving * speedFactor;
    this.bobAmount = damp(this.bobAmount, targetBob, 8, dt);
    this.bobPhase += dt * (6 + speed * 1.35);

    const bobY = Math.sin(this.bobPhase * 2) * CAM.bobAmplitude * this.bobAmount * this.motionScale;
    const bobX = Math.sin(this.bobPhase) * CAM.bobLateral * this.bobAmount * this.motionScale;

    // --- landing spring ----------------------------------------------------
    const spring = CAM.landingSpring;
    this.landVelocity += (-this.landOffset * spring - this.landVelocity * 9) * dt;
    this.landOffset += this.landVelocity * dt;
    this.landOffset = clamp(this.landOffset, -0.3, 0.15);

    // --- pitch offset (vault) ----------------------------------------------
    this.pitchOffset = damp(this.pitchOffset, 0, 7, dt);

    // --- roll ---------------------------------------------------------------
    let targetRoll = 0;
    if (player.wallRunning) {
      // Tilt towards the wall that is being run.
      const right = player.right;
      const side = clamp(player.wallNormal.dot(right), -1, 1);
      targetRoll = side * CAM.wallRoll;
    } else {
      // Slight tilt when strafing.
      const right = player.right;
      const lateral = body.velocity.dot(right);
      targetRoll = clamp(-lateral * 0.35, -CAM.strafeRoll, CAM.strafeRoll);
    }
    this.roll = damp(this.roll, targetRoll * this.motionScale, CAM.rollLerp, dt);

    // --- field of view --------------------------------------------------------
    const sprintFactor = clamp((speed - PHYS.walkSpeed) / (PHYS.sprintSpeed - PHYS.walkSpeed), 0, 1);
    const targetFov = CAM.fovBase + CAM.fovSprintBonus * sprintFactor;
    this.fov = damp(this.fov, targetFov, CAM.fovLerp, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // --- place the camera ------------------------------------------------------
    const p = body.position;
    this.camera.position.set(p.x, p.y + this.eyeHeight + bobY + this.landOffset, p.z);

    // Lateral bob is applied along the camera right vector.
    this.tmp.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(bobX);
    this.camera.position.add(this.tmp);

    this.camera.rotation.set(
      this.pitch + this.pitchOffset,
      this.yaw,
      this.roll
    );
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
