import { MathUtils, PerspectiveCamera } from 'three';
import { CAMERA, PHYS } from '../config';
import type { PlayerController } from './PlayerController';

const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * Turns the simulated player state into a camera transform: interpolated
 * position, eye height, head bob, landing dip, FOV kick and roll.
 */
export class FirstPersonCamera {
  readonly camera: PerspectiveCamera;
  sensitivity = CAMERA.defaultSensitivity;
  reducedMotion = false;

  private eye: number = PHYS.standEye;
  private roll = 0;
  private fov: number = CAMERA.baseFov;
  private landOffset = 0;
  private landVel = 0;
  private bobAmount = 0;
  private pitchKick = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(CAMERA.baseFov, aspect, 0.05, 2500);
    this.camera.rotation.order = 'YXZ';
  }

  applyMouse(player: PlayerController, dx: number, dy: number): void {
    const s = 0.0022 * this.sensitivity;
    player.yaw -= dx * s;
    player.pitch = MathUtils.clamp(player.pitch - dy * s, -1.52, 1.52);
  }

  /** Called when the player lands so the camera can dip. */
  land(impact: number): void {
    const k = this.reducedMotion ? 0.35 : 1;
    this.landVel -= Math.min(impact, 26) * 0.11 * k;
  }

  jump(): void {
    this.pitchKick += this.reducedMotion ? 0.004 : 0.012;
  }

  update(player: PlayerController, alpha: number, dt: number): void {
    const cam = this.camera;
    const b = player.body;
    const rm = this.reducedMotion;
    const px = player.prevPosition.x + (b.position.x - player.prevPosition.x) * alpha;
    const py = player.prevPosition.y + (b.position.y - player.prevPosition.y) * alpha;
    const pz = player.prevPosition.z + (b.position.z - player.prevPosition.z) * alpha;

    // Eye height follows the collider height smoothly.
    let eyeTarget = player.crouched || player.state === 'slide' ? PHYS.slideEye : PHYS.standEye;
    if (player.state === 'vault') eyeTarget = PHYS.standEye - 0.35;
    if (player.state === 'mantle') eyeTarget = PHYS.standEye - 0.25;
    this.eye = damp(this.eye, eyeTarget, player.state === 'slide' ? 14 : 10, dt);

    // Landing spring.
    this.landVel += (-this.landOffset * 120 - this.landVel * 16) * dt;
    this.landOffset += this.landVel * dt;
    this.landOffset = MathUtils.clamp(this.landOffset, -0.4, 0.15);

    // Head bob while running on the ground.
    const grounded = player.state === 'ground';
    const speed = player.speed;
    const bobTarget = grounded && speed > 0.5 ? Math.min(1, speed / PHYS.sprintSpeed) : 0;
    this.bobAmount = damp(this.bobAmount, bobTarget, 8, dt);
    const bobScale = (rm ? 0.25 : 1) * this.bobAmount;
    const phase = player.stridePhase * Math.PI;
    const bobY = -Math.abs(Math.sin(phase)) * 0.055 * bobScale + 0.025 * bobScale;
    const bobX = Math.sin(phase) * 0.03 * bobScale;

    // Wall-run bob is lighter.
    const wrBob = player.state === 'wallrun' ? Math.sin(player.stridePhase * Math.PI * 2) * 0.015 * (rm ? 0.3 : 1) : 0;

    const yaw = player.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    cam.position.set(
      px + rx * bobX,
      py + this.eye + bobY + wrBob + this.landOffset + player.stepSmooth,
      pz + rz * bobX,
    );

    // Roll: strafing lean + wall-run tilt toward the wall + small slide lean.
    let rollTarget = 0;
    if (!rm) rollTarget += -player.strafe * MathUtils.degToRad(1.4) * Math.min(1, speed / 6);
    if (player.state === 'wallrun' && player.wall) {
      rollTarget += -player.wall.side * MathUtils.degToRad(rm ? 3 : 9);
    }
    if (player.state === 'slide') rollTarget += MathUtils.degToRad(rm ? 1 : 3);
    this.roll = damp(this.roll, rollTarget, 7, dt);

    // Procedural pitch accents for vault / mantle / jump.
    let pitchOffset = 0;
    const s = rm ? 0.35 : 1;
    if (player.state === 'vault') pitchOffset -= Math.sin(player.planT * Math.PI) * 0.22 * s;
    if (player.state === 'mantle') pitchOffset -= Math.sin(player.planT * Math.PI) * 0.26 * s;
    this.pitchKick = damp(this.pitchKick, 0, 6, dt);
    pitchOffset += this.pitchKick + this.landOffset * 0.25;

    cam.rotation.set(player.pitch + pitchOffset, yaw, this.roll);

    // Speed-dependent FOV.
    const sp = player.state === 'vault' || player.state === 'mantle' ? speed * 0.5 : Math.hypot(b.velocity.x, b.velocity.z);
    const k = MathUtils.clamp((sp - PHYS.walkSpeed) / (PHYS.slideMaxSpeed - PHYS.walkSpeed), 0, 1);
    const fovTarget = CAMERA.baseFov + CAMERA.maxFovBoost * k * (rm ? 0.4 : 1);
    this.fov = damp(this.fov, fovTarget, 4, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  resetEffects(): void {
    this.landOffset = 0; this.landVel = 0; this.roll = 0; this.pitchKick = 0; this.eye = PHYS.standEye;
  }
}
