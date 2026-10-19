/**
 * FirstPersonCamera - mouse look plus all the "feel" effects:
 *  head bob, strafe roll, wall-run tilt, speed FOV, landing/take-off impact, smooth
 *  slide height and procedural vault/mantle animation.
 *
 * Everything that is purely cosmetic lives here; the physics never reads these values.
 * A "motion" factor (1 normally, ~0.25 with "reduce camera motion") scales every effect.
 */

import * as THREE from 'three';
import { EYE, MOVE } from './MovementConfig';
import { type PlayerController } from './PlayerController';

const MOUSE_RAD_PER_PIXEL = 0.0022;
const PITCH_LIMIT = THREE.MathUtils.degToRad(88);

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** Smoothed look angles. The physics reads `yaw`. */
  yaw = 0;
  pitch = 0;
  private rawYaw = 0;
  private rawPitch = 0;

  sensitivity = 1;
  /** 1 = full effects, 0.25 = reduced camera motion. */
  motion = 1;

  readonly baseFov = 70;
  fov = 70;

  // ---- animated state
  private eye: number = EYE.stand;
  private bobAmp = 0;
  private bobPhase = 0;
  private roll = 0;
  private wallRoll = 0;
  private landOffset = 0;
  private landVel = 0;
  private pitchKick = 0;
  private pitchKickVel = 0;
  private fovKick = 0;

  /** Final eye position in world space, exposed so the body can follow it. */
  readonly eyePosition = new THREE.Vector3();
  /** Roll in radians that was applied this frame (positive = leaning right). */
  appliedRoll = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.05, 6000);
    this.camera.rotation.order = 'YXZ';
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = this.rawYaw = yaw;
    this.pitch = this.rawPitch = pitch;
  }

  /** Applies mouse movement (in pixels) to the raw look target. */
  addMouse(dx: number, dy: number): void {
    const k = MOUSE_RAD_PER_PIXEL * this.sensitivity;
    this.rawYaw -= dx * k;
    this.rawPitch -= dy * k;
    this.rawPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.rawPitch));
  }

  /** Light smoothing that removes mouse-event jitter without adding noticeable lag. */
  smoothLook(dt: number): void {
    const k = 1 - Math.exp(-dt * 70);
    this.yaw += (this.rawYaw - this.yaw) * k;
    this.pitch += (this.rawPitch - this.pitch) * k;
  }

  // ---------------------------------------------------------------- events

  onLand(impact: number): void {
    const k = Math.min(impact / 14, 1.2);
    this.landVel -= k * 1.7 * this.motion;
    this.pitchKickVel -= k * 0.5 * this.motion;
  }

  onJump(): void {
    this.landVel += 0.8 * this.motion;
    this.fovKick = 1.5 * this.motion;
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, ctrl: PlayerController, alpha: number): void {
    const p = ctrl.physics;
    const m = this.motion;

    // Interpolated body position
    const px = ctrl.prevX + (p.x - ctrl.prevX) * alpha;
    const py = ctrl.prevY + (p.y - ctrl.prevY) * alpha;
    const pz = ctrl.prevZ + (p.z - ctrl.prevZ) * alpha;

    const speed = p.horizontalSpeed;
    const speedT = Math.min(speed / MOVE.sprintSpeed, 1.15);
    const state = ctrl.state;
    const script = ctrl.parkour.active;

    // ---- eye height (smooth slide transition, never poking through a low ceiling)
    let eyeTarget: number = EYE.stand;
    if (state === 'slide') eyeTarget = EYE.slide;
    else if (state === 'vault' || state === 'mantle') eyeTarget = EYE.vault;
    const clearance = p.ceilingClearance(3);
    eyeTarget = Math.min(eyeTarget, clearance - 0.16);
    eyeTarget = Math.max(eyeTarget, 0.3);
    this.eye = damp(this.eye, eyeTarget, eyeTarget < this.eye ? 20 : 9, dt);
    // A hard clamp so a fast slide-in can never put the camera inside the beam.
    this.eye = Math.min(this.eye, Math.max(0.3, clearance - 0.12));

    // ---- head bob (grounded running only)
    const walking = state === 'ground' && p.grounded && speed > 1.5;
    this.bobAmp = damp(this.bobAmp, walking ? 1 : 0, walking ? 10 : 7, dt);
    this.bobPhase = ctrl.stridePhase;
    const bobScale = this.bobAmp * m * (0.35 + 0.65 * speedT);
    const bobY = Math.sin(this.bobPhase * 2) * 0.030 * bobScale;
    const bobX = Math.sin(this.bobPhase) * 0.020 * bobScale;
    const bobRoll = Math.sin(this.bobPhase) * 0.006 * bobScale;

    // ---- landing / take-off spring
    const k = 190;
    const c = 17;
    this.landVel += (-k * this.landOffset - c * this.landVel) * dt;
    this.landOffset += this.landVel * dt;
    this.landOffset = Math.max(-0.28, Math.min(0.2, this.landOffset));
    this.pitchKickVel += (-120 * this.pitchKick - 14 * this.pitchKickVel) * dt;
    this.pitchKick += this.pitchKickVel * dt;

    // ---- roll: strafing lean + wall run tilt
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const rightX = cosY;
    const rightZ = -sinY;
    const lateral = p.vx * rightX + p.vz * rightZ;
    const strafeRoll = (lateral / MOVE.sprintSpeed) * THREE.MathUtils.degToRad(3.2) * m;
    const wallTarget = ctrl.parkour.wall.active
      ? ctrl.parkour.wall.side * THREE.MathUtils.degToRad(12) * Math.max(m, 0.3)
      : 0;
    this.wallRoll = damp(this.wallRoll, wallTarget, 7, dt);
    this.roll = damp(this.roll, strafeRoll, 9, dt);
    // lean right = positive; camera.rotation.z is counter-clockwise positive, so negate.
    this.appliedRoll = this.roll + this.wallRoll + bobRoll;

    // ---- vault / mantle procedural animation
    let scriptPitch = 0;
    let scriptDrop = 0;
    let scriptRoll = 0;
    if (script) {
      const u = script.progress;
      const s = Math.sin(Math.PI * Math.min(1, u));
      if (script.kind === 'vault') {
        scriptPitch = -0.16 * s * Math.max(m, 0.4);
        scriptDrop = -0.14 * s * Math.max(m, 0.4);
        scriptRoll = 0.04 * Math.sin(u * Math.PI * 2) * m;
      } else {
        scriptPitch = (0.12 * Math.sin(Math.min(1, u * 1.4) * Math.PI) - 0.1 * s) * Math.max(m, 0.4);
        scriptDrop = -0.08 * s * Math.max(m, 0.4);
      }
    }
    this.appliedRoll += scriptRoll;

    // ---- FOV (speed dependent)
    const fovTarget = this.baseFov + (speedT * 9 + (state === 'slide' ? 3 : 0) + (state === 'wallrun' ? 3 : 0)) * m + this.fovKick;
    this.fovKick = damp(this.fovKick, 0, 6, dt);
    this.fov = damp(this.fov, fovTarget, 5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // ---- compose
    const eyeY = py + this.eye + bobY + this.landOffset + scriptDrop;
    this.eyePosition.set(px + rightX * bobX, eyeY, pz + rightZ * bobX);
    this.camera.position.copy(this.eyePosition);
    this.camera.rotation.set(this.pitch + this.pitchKick + scriptPitch, this.yaw, -this.appliedRoll, 'YXZ');
  }

  /** Forget all transient effects (respawn). */
  reset(): void {
    this.eye = EYE.stand;
    this.bobAmp = 0;
    this.roll = this.wallRoll = 0;
    this.landOffset = this.landVel = 0;
    this.pitchKick = this.pitchKickVel = 0;
    this.fovKick = 0;
  }
}
