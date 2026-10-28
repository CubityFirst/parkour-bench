import * as THREE from 'three';
import { CONST } from '../constants';
import type { PlayerController } from './PlayerController';

export interface CameraSettings {
  sensitivity: number; // mouse sensitivity multiplier
  cameraMotion: number; // 0 = reduced motion, 1 = full motion
}

const UP = new THREE.Vector3(0, 1, 0);

// Eye height expressed relative to the AABB *center* (the physics position is
// the box center, not the feet). feet = center - halfHeight.
const EYE_FROM_CENTER_STAND = CONST.eyeStand - CONST.heightStand / 2;
const EYE_FROM_CENTER_SLIDE = CONST.eyeSlide - CONST.heightSlide / 2;

/**
 * First-person camera: mouse look, speed-based FOV, head bob, strafe roll,
 * wall-run tilt, slide lowering, landing dip and vault/mantle follow. All
 * effects are subtle and can be scaled down via the "camera motion" setting.
 */
export class FirstPersonCamera {
  yaw = 0;
  pitch = 0;

  private roll = 0;
  private fov = CONST.fovBase;
  private eyeHeight = EYE_FROM_CENTER_STAND;
  private bobPhase = 0;
  private bobAmount = 0;
  private landDip = 0;
  private pos = new THREE.Vector3();

  private readonly forwardV = new THREE.Vector3();
  private readonly rightV = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private settings: CameraSettings,
  ) {
    camera.rotation.order = 'YXZ';
  }

  get forward(): THREE.Vector3 {
    return this.forwardV.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get right(): THREE.Vector3 {
    return this.rightV.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  setYaw(y: number): void {
    this.yaw = y;
  }

  applyLook(dx: number, dy: number): void {
    const s = this.settings.sensitivity * 0.0022;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  /** Reset camera position/roll with no interpolation (used on respawn). */
  snapTo(position: THREE.Vector3): void {
    this.pos.set(position.x, position.y + EYE_FROM_CENTER_STAND, position.z);
    this.roll = 0;
    this.landDip = 0;
    this.bobPhase = 0;
  }

  update(dt: number, controller: PlayerController, physicsPosition: THREE.Vector3): void {
    const motion = this.settings.cameraMotion;
    const speed = controller.horizontalSpeed;
    const grounded = controller.grounded;

    // --- eye height (stand vs slide) ---
    const eyeOffset = controller.sliding ? EYE_FROM_CENTER_SLIDE : EYE_FROM_CENTER_STAND;
    const k = 1 - Math.exp(-dt * 18);
    this.eyeHeight += (eyeOffset - this.eyeHeight) * k;

    // --- head bob ---
    const targetBob = grounded && controller.movingInput ? Math.min(speed / CONST.sprintSpeed, 1) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * (1 - Math.exp(-dt * 8));
    if (this.bobAmount > 0.01) {
      this.bobPhase += speed * dt * 2.4;
    }
    const bobY = Math.sin(this.bobPhase * 2) * 0.028 * this.bobAmount * motion;
    const bobX = Math.cos(this.bobPhase) * 0.02 * this.bobAmount * motion;

    // --- landing dip ---
    this.landDip = Math.max(0, this.landDip - dt * 2.5);
    const dipY = -this.landDip * 0.18;

    // --- roll: strafe + wall run ---
    let targetRoll = 0;
    if (grounded && controller.strafeInput !== 0) {
      targetRoll += -controller.strafeInput * 0.035 * motion;
    }
    if (controller.wallRunning) {
      targetRoll += -controller.wallRunLean * 0.24 * motion;
    }
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 10));

    // --- FOV ---
    const fovTarget = Math.min(
      CONST.fovMax,
      CONST.fovBase + (speed / CONST.fovSpeedRef) * (CONST.fovMax - CONST.fovBase),
    );
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-dt * 8));

    // --- position (smoothed toward physics center) ---
    const targetX = physicsPosition.x + bobX;
    const targetY = physicsPosition.y + this.eyeHeight + bobY + dipY;
    const targetZ = physicsPosition.z;
    const pk = 1 - Math.exp(-dt * 40);
    this.pos.x += (targetX - this.pos.x) * pk;
    this.pos.y += (targetY - this.pos.y) * pk;
    this.pos.z += (targetZ - this.pos.z) * pk;

    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Trigger a small downward dip on landing. */
  onLand(fallSpeed: number): void {
    this.landDip = Math.min(0.5, fallSpeed * 0.035);
  }
}
