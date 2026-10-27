import * as THREE from 'three';
import { PLAYER } from '../game/GameState';

type Vec = THREE.Vector3;

interface ShakeOpts {
  kick: number; // vertical kick (m)
  roll: number; // roll change (rad)
}

/**
 * First-person camera with no-clip look dynamics: basic head bob, speed FOV,
 * wall-run tilt, landing kick, and vault animations. A master "intensity"
 * factor lets players turn the extra motion down.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;

  yaw = 0;
  pitch = 0;
  intensity = 1.0; // 1 = full motion, 0 = calm camera

  private horizon: Vec = new THREE.Vector3();
  private baseFov = 82;
  private bobPhase = 0;
  private bobAmt = 0;
  private rollTilt = 0; // strafe + wall-run tilt (rad)
  private shake: ShakeOpts = { kick: 0, roll: 0 };
  private vaultRoll = 0;
  private slideDip = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.05, 1200);
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** Feed smoothed yaw/pitch targets from input. */
  addLook(dxYaw: number, dyPitch: number): void {
    this.yaw -= dxYaw;
    this.pitch -= dyPitch;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.min(Math.max(this.pitch, -lim), lim);
  }

  /** Landing / vault feedback pulses. */
  land(strength: number): void {
    const s = Math.min(1, strength);
    this.shake.kick += -0.09 * s * this.intensity;
    this.shake.roll += 0.035 * s * this.intensity;
  }

  setSlideVisual(on: boolean): void {
    this.slideDip = on ? 1 : 0;
  }

  vault(): void {
    this.vaultRoll = 0.06 * this.intensity;
  }

  /**
   * Recompute camera world state from `eyePos` (already interpolated /
   * smoothed eye position in world space) plus contextual movement info.
   */
  update(
    eyePos: Vec,
    dt: number,
    opts: { speed: number; sprinting: boolean; grounded: boolean; strafe: number; wallSide: number; sliding: boolean }
  ): void {
    const t = dt;
    const speed01 = Math.min(1, opts.speed / PLAYER.sprintSpeed);

    // -- Head bob: only noticeable when grounded and moving
    const targetBob = opts.grounded ? speed01 * (opts.sprinting ? 1 : 0.55) : 0;
    this.bobAmt += (targetBob - this.bobAmt) * Math.min(1, t * 9);
    if (opts.grounded) this.bobPhase += t * (opts.sprinting ? 13.5 : 11);
    const bob = Math.sin(this.bobPhase * 2) * 0.028 * this.bobAmt * this.intensity;
    const sway = Math.cos(this.bobPhase) * 0.016 * this.bobAmt * this.intensity;

    // -- Strafe roll (mild)
    let desiredRoll = opts.strafe * -0.035 + opts.wallSide * -0.13;
    desiredRoll *= this.intensity;

    // -- Slide dip
    const dip = this.slideDip;

    // -- Shake decay: spring back to zero
    this.shake.kick *= Math.max(0, 1 - t * 11);
    this.shake.roll *= Math.max(0, 1 - t * 9);
    this.vaultRoll *= Math.max(0, 1 - t * 10);

    // -- FOV from speed
    const targetFov = this.baseFov + speed01 * 12 + (opts.sliding ? 4 : 0);
    const fovNow = this.camera.fov + (targetFov - this.camera.fov) * Math.min(1, t * 5);
    if (Math.abs(fovNow - this.camera.fov) > 0.001) {
      this.camera.fov = fovNow;
      this.camera.updateProjectionMatrix();
    }

    this.rollTilt += (desiredRoll - this.rollTilt) * Math.min(1, t * 8);
    const roll = this.rollTilt + this.shake.roll + this.vaultRoll;

    this.camera.position.set(eyePos.x, eyePos.y + bob + dip * -0.12, eyePos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = roll + sway;
  }

  get lookDir(): Vec {
    return this.camera.getWorldDirection(this.horizon);
  }
}
