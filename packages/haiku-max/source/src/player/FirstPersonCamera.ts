import * as THREE from 'three';
import { MOVE } from './MovementConfig';
import type { PlayerController } from './PlayerController';

const BASE_FOV = 74;
/** Radians of view rotation per mouse pixel at sensitivity 1. */
const LOOK_PER_PIXEL = 0.0022;
const PITCH_LIMIT = 1.45;
/** Camera motion multiplier when "reduced camera motion" is chosen. */
const REDUCED_MOTION = 0.3;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * First-person camera. Mouse look is applied immediately, while the body-driven effects
 * (bob, landing spring, tilt, FOV) are layered on top every rendered frame.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  /** 1 = full camera motion; REDUCED_MOTION when the player has asked for less. */
  motionScale = 1;

  private roll = 0;
  private fov = BASE_FOV;
  private bobPhase = 0;
  private bobAmount = 0;
  private landOffset = 0;
  private landVelocity = 0;
  private pitchKick = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.05, 2400);
    this.camera.rotation.order = 'YXZ';
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setMotion(reduced: boolean): void {
    this.motionScale = reduced ? REDUCED_MOTION : 1;
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_PER_PIXEL * this.sensitivity;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy * LOOK_PER_PIXEL * this.sensitivity));
  }

  /** Points the view along a yaw, e.g. at a checkpoint's facing. */
  setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  /** A landing gives the view a small downward spring. Harder landings push further. */
  onLand(impactSpeed: number): void {
    const strength = Math.min(0.16, impactSpeed * 0.012) * this.motionScale;
    this.landVelocity -= strength * 14;
  }

  /** Takeoff lifts the view slightly. */
  onJump(): void {
    this.pitchKick = 0.03 * this.motionScale;
  }

  /** Re-centres the springs so a respawn does not carry old motion over. */
  snap(): void {
    this.landOffset = 0;
    this.landVelocity = 0;
    this.pitchKick = 0;
    this.bobAmount = 0;
    this.roll = 0;
  }

  /** Updates camera position and rotation from the player. alpha blends between physics steps. */
  update(dt: number, player: PlayerController, alpha: number): void {
    const p = player.pos;
    const x = lerp(player.prev.x, p.x, alpha);
    const y = lerp(player.prev.y, p.y, alpha);
    const z = lerp(player.prev.z, p.z, alpha);

    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    // Head bob, only while running on the ground. Sprinting bobs more.
    const grounded = player.mode === 'ground';
    const bobTarget = grounded && player.speed > 1 ? Math.min(1, Math.max(0.25, player.speed / MOVE.sprintSpeed)) : 0;
    this.bobAmount = lerp(this.bobAmount, bobTarget, Math.min(1, dt * 7));
    this.bobPhase += dt * (grounded ? 1.6 + player.speed * 0.95 : 0);
    const bobY = Math.sin(this.bobPhase) * 0.028 * this.bobAmount * this.motionScale;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.02 * this.bobAmount * this.motionScale;

    // Landing spring: a damped oscillator that returns the view to rest.
    this.landVelocity += (-220 * this.landOffset - 18 * this.landVelocity) * dt;
    this.landOffset += this.landVelocity * dt;
    this.pitchKick = lerp(this.pitchKick, 0, Math.min(1, dt * 7));

    // Strafe roll, wall-run tilt toward the wall, and a gentle dip during vaults and mantles.
    const strafeRoll = -player.strafe * 0.012 * this.motionScale;
    const wallTilt = player.wallSide !== 0 ? -player.wallSide * 0.13 * this.motionScale : 0;
    const scriptDip = player.scriptKind ? Math.sin(Math.PI * player.scriptProgress) : 0;
    const targetRoll = strafeRoll + wallTilt;
    this.roll = lerp(this.roll, targetRoll, Math.min(1, dt * 8));

    // Speed-dependent FOV, widened a little for slides and wall runs.
    let fovTarget = BASE_FOV;
    if (player.speed > MOVE.walkSpeed) {
      fovTarget += Math.min(1, (player.speed - MOVE.walkSpeed) / (MOVE.sprintSpeed - MOVE.walkSpeed)) * 7 * this.motionScale;
    }
    if (player.mode === 'slide') fovTarget += 3 * this.motionScale;
    if (player.mode === 'wallrun') fovTarget += 4 * this.motionScale;
    this.fov = lerp(this.fov, fovTarget, Math.min(1, dt * 5));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    const eyeY = y + player.eyeHeight + bobY + this.landOffset + scriptDip * 0.08 * this.motionScale;
    this.camera.position.set(
      x + rightX * bobX,
      eyeY,
      z + rightZ * bobX,
    );
    this.camera.rotation.set(this.pitch + this.pitchKick + scriptDip * 0.03 * this.motionScale, this.yaw, this.roll);
  }
}
