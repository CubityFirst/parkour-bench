import * as THREE from 'three';
import { CAMERA, MOVE, PLAYER, WALL } from '../config.ts';
import type { PlayerController } from './PlayerController.ts';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing factor. */
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export interface CameraSettings {
  /** Horizontal field of view in degrees at rest. */
  hfov: number;
  /** Radians per pixel multiplier (slider value). */
  sensitivity: number;
  /** 0..1 - scales head bob, roll, FOV kick, landing impacts and vault / mantle animation. */
  motion: number;
}

/**
 * First-person camera: mouse look plus all the "feel" layers (bob, landing spring, FOV, roll, vault /
 * mantle animation). It renders the interpolated physics state, so motion is smooth at any frame rate.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  settings: CameraSettings = { hfov: CAMERA.baseHFov, sensitivity: 1, motion: 1 };

  private eye: number = PLAYER.eyeStand;
  private roll = 0;
  private fovBoost = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private landX = 0; // vertical landing spring (m)
  private landV = 0;
  private stepOffset = 0;
  private scriptPitch = 0;
  private scriptRoll = 0;
  private scriptY = 0;
  private scriptFov = 0;
  private time = 0;
  private aspect = 16 / 9;
  private readonly pos = new THREE.Vector3();
  private readonly prevFeet = new THREE.Vector3();
  private readonly curFeet = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
  }

  /** Teleport: snap the camera to a spot and facing, clearing every transient effect. */
  snapTo(player: PlayerController, yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
    const b = player.body;
    this.prevFeet.set(b.x, b.y, b.z);
    this.curFeet.set(b.x, b.y, b.z);
    this.eye = player.crouched ? PLAYER.eyeSlide : PLAYER.eyeStand;
    this.roll = 0;
    this.fovBoost = 0;
    this.bobAmp = 0;
    this.landX = 0;
    this.landV = 0;
    this.stepOffset = 0;
    this.scriptPitch = this.scriptRoll = this.scriptY = this.scriptFov = 0;
  }

  /** Record the physics state after each fixed step (used for interpolation). */
  capture(player: PlayerController): void {
    const b = player.body;
    this.prevFeet.copy(this.curFeet);
    this.curFeet.set(b.x, b.y, b.z);
    // Teleports (respawn / scripted jumps over 3 m) should not smear.
    if (this.prevFeet.distanceToSquared(this.curFeet) > 9) this.prevFeet.copy(this.curFeet);
    if (b.steppedUp > 0) this.stepOffset -= b.steppedUp;
  }

  // ---- one-shot reactions -----------------------------------------------------------------

  onJump(): void {
    this.landV -= 0.9 * this.settings.motion;
  }

  onLand(impact: number): void {
    const m = this.settings.motion;
    this.landV -= clamp(impact * 0.07, 0, 1.9) * m;
  }

  onBump(speedLost: number): void {
    this.landV -= clamp(speedLost * 0.05, 0, 0.9) * this.settings.motion;
  }

  // ---- per frame --------------------------------------------------------------------------

  /** Apply raw mouse movement (pixels). Called before the physics ticks so movement uses the freshest yaw. */
  applyLook(dx: number, dy: number): void {
    const sens = CAMERA.radiansPerPixel * this.settings.sensitivity;
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -CAMERA.maxPitch, CAMERA.maxPitch);
  }

  update(dt: number, alpha: number, player: PlayerController): void {
    this.time += dt;
    const m = this.settings.motion;
    const b = player.body;

    // Interpolated feet position.
    this.pos.lerpVectors(this.prevFeet, this.curFeet, clamp(alpha, 0, 1));

    // Eye height eases toward standing / crouched. Scripted vaults / mantles keep a standing eye height
    // (their collision box is shrunk for clearance checks, but the head should not drop).
    const lowered = player.crouched && player.state !== 'scripted';
    const targetEye = lowered ? PLAYER.eyeSlide : PLAYER.eyeStand;
    const eyeRate = targetEye < this.eye ? 16 : 9;
    this.eye += (targetEye - this.eye) * damp(eyeRate, dt);

    // Step-up smoothing (curbs / small ledges).
    this.stepOffset += (0 - this.stepOffset) * damp(14, dt);

    // Landing / takeoff spring (critically damped-ish).
    const k = 190;
    const c = 17;
    this.landV += (-k * this.landX - c * this.landV) * dt;
    this.landX += this.landV * dt;
    this.landX = clamp(this.landX, -0.34, 0.12);

    // Head bob.
    const speed = b.horizontalSpeed;
    const grounded = player.state === 'ground' || player.state === 'slide';
    const bobWanted =
      player.state === 'ground' && speed > 1.5 ? clamp(speed / MOVE.sprintSpeed, 0, 1.2) : player.state === 'wallrun' ? 0.6 : 0;
    this.bobAmp += (bobWanted - this.bobAmp) * damp(bobWanted > this.bobAmp ? 6 : 10, dt);
    if (grounded || player.state === 'wallrun') {
      const stride = 1.15 + 0.17 * speed;
      this.bobPhase += ((speed * dt) / (2 * stride)) * Math.PI * 2;
    }
    const bobY = Math.sin(this.bobPhase * 2) * 0.026 * this.bobAmp * m;
    const bobX = Math.sin(this.bobPhase) * 0.016 * this.bobAmp * m;
    const bobRoll = Math.sin(this.bobPhase) * 0.0045 * this.bobAmp * m;

    // Roll: strafing lean + wall-run tilt toward the wall.
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const strafe = b.vx * rx + b.vz * rz;
    let rollTarget = -clamp(strafe / 10, -1, 1) * 0.042 * m;
    if (player.state === 'wallrun' && player.wall) rollTarget += -player.wall.side * WALL.cameraRoll * m;
    this.roll += (rollTarget - this.roll) * damp(player.state === 'wallrun' ? 9 : 6, dt);

    // Scripted move (vault / mantle) animation.
    let sPitch = 0;
    let sRoll = 0;
    let sY = 0;
    let sFov = 0;
    const sm = player.scripted;
    if (sm) {
      const u = sm.progress;
      if (sm.kind === 'vault') {
        sPitch = -0.12 * Math.sin(Math.PI * u);
        sRoll = 0.035 * Math.sin(Math.PI * u * 2) * (sm.dirX + sm.dirZ >= 0 ? 1 : -1);
        sY = -0.12 * Math.sin(Math.PI * u);
        sFov = 4 * Math.sin(Math.PI * u);
      } else {
        const pull = Math.sin(Math.PI * Math.min(1, u / 0.62));
        sPitch = -0.22 * pull + 0.04 * Math.sin(Math.PI * u);
        sY = -0.1 * pull + Math.sin(u * 22) * 0.008 * (1 - u);
        sRoll = Math.sin(u * 14) * 0.012 * (1 - u);
        sFov = -2 * pull;
      }
    }
    this.scriptPitch += (sPitch * m - this.scriptPitch) * damp(18, dt);
    this.scriptRoll += (sRoll * m - this.scriptRoll) * damp(18, dt);
    this.scriptY += (sY * m - this.scriptY) * damp(18, dt);
    this.scriptFov += (sFov * m - this.scriptFov) * damp(12, dt);

    // Speed-dependent FOV.
    const fovKick = smoothstep(6.2, 11, speed) * CAMERA.maxFovBoost + (player.state === 'wallrun' ? 3 : 0) + (player.state === 'slide' ? 2.5 : 0);
    this.fovBoost += (fovKick * m - this.fovBoost) * damp(4.5, dt);
    const hfov = this.settings.hfov + this.fovBoost + this.scriptFov;
    const vfov = 2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / this.aspect) * (180 / Math.PI);
    const cam = this.camera;
    const newFov = clamp(vfov, 38, 112);
    if (Math.abs(cam.fov - newFov) > 0.002) {
      cam.fov = newFov;
      cam.updateProjectionMatrix();
    }

    // Compose.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const eyeY = this.eye + bobY + this.landX * m + this.stepOffset + this.scriptY;
    cam.position.set(this.pos.x + cos * bobX, this.pos.y + eyeY, this.pos.z - sin * bobX);
    this.euler.set(clamp(this.pitch + this.scriptPitch, -1.55, 1.55), this.yaw, this.roll + bobRoll + this.scriptRoll, 'YXZ');
    cam.quaternion.setFromEuler(this.euler);
  }

  /** Interpolated feet position (used by the view model's legs). */
  get feetPosition(): THREE.Vector3 {
    return this.pos;
  }

  /** Apply the configured field of view without any speed effects (menu backdrop). */
  syncFov(): void {
    const vfov = 2 * Math.atan(Math.tan((this.settings.hfov * Math.PI) / 360) / this.aspect) * (180 / Math.PI);
    const newFov = clamp(vfov, 38, 112);
    if (Math.abs(this.camera.fov - newFov) > 0.002) {
      this.camera.fov = newFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
