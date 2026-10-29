import * as THREE from 'three';
import { CFG, type PlayerPhysics } from './PlayerPhysics';

/**
 * First person camera rig.
 *
 * Handles mouse look, speed based FOV, head bob, strafe roll, wall run tilt
 * and the small landing dip. Everything can be scaled down (or switched off)
 * through `motionScale` for players who are sensitive to camera motion.
 */
export class FirstPersonCamera {
  yaw = 0;
  pitch = 0;

  /** 0 = no camera motion at all, 1 = full. */
  motionScale = 1;
  sensitivity = 1;

  readonly camera: THREE.PerspectiveCamera;

  private readonly baseFov = 74;
  private readonly maxFov = 90;
  private fov = 74;

  private bobPhase = 0;
  private bobAmount = 0;
  private roll = 0;
  private targetRoll = 0;
  private dip = 0;
  private dipVel = 0;
  private vaultTilt = 0;
  private readonly smoothedPos = new THREE.Vector3();
  private initialised = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  look(dx: number, dy: number): void {
    const s = 0.0022 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    const limit = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  /** Horizontal forward vector of the camera. */
  flatForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  onLand(impact: number): void {
    const amount = Math.min(0.26, impact * 0.022) * this.motionScale;
    this.dipVel -= amount * 26;
  }

  onVault(): void {
    this.vaultTilt = 0.09 * this.motionScale;
  }

  /**
   * @param strafe   -1..1 strafe input (for the roll)
   * @param wallSide -1 = wall on the left, 1 = wall on the right, 0 = none
   */
  update(dt: number, physics: PlayerPhysics, strafe: number, wallSide: number): void {
    const speed = physics.horizontalSpeed;
    const motion = this.motionScale;

    // ---------------------------------------------------------- head bob
    const speedRatio = Math.min(1, speed / CFG.sprintSpeed);
    const targetBob = physics.grounded && !physics.sliding ? speedRatio * 0.055 : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, 8 * dt);
    if (speed > 0.4) this.bobPhase += dt * (5.5 + speed * 0.75);

    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmount * motion;
    const bobX = Math.sin(this.bobPhase) * this.bobAmount * 0.7 * motion;

    // ------------------------------------------------------------- roll
    this.targetRoll = -strafe * 0.022 * Math.min(1, speed / CFG.sprintSpeed) * motion;
    if (wallSide !== 0) {
      this.targetRoll += wallSide * 0.13 * motion;
    }
    this.vaultTilt *= Math.max(0, 1 - dt * 6);
    this.roll += (this.targetRoll - this.roll) * Math.min(1, 10 * dt);

    // -------------------------------------------------------- landing dip
    const spring = -this.dip * 120 - this.dipVel * 16;
    this.dipVel += spring * dt;
    this.dip += this.dipVel * dt;

    // -------------------------------------------------------------- FOV
    const sprintK = Math.max(0, (speed - CFG.walkSpeed) / (CFG.sprintSpeed - CFG.walkSpeed));
    const targetFov = this.baseFov + (this.maxFov - this.baseFov) * sprintK * motion;
    this.fov += (targetFov - this.fov) * Math.min(1, 6 * dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // ---------------------------------------------------------- position
    const eye = physics.position.y + physics.eyeHeight;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const target = new THREE.Vector3(
      physics.position.x + right.x * bobX,
      eye + bobY + this.dip,
      physics.position.z + right.z * bobX
    );

    if (!this.initialised) {
      this.smoothedPos.copy(target);
      this.initialised = true;
    } else {
      // light smoothing keeps the camera buttery without feeling laggy
      const k = 1 - Math.pow(0.0001, dt);
      this.smoothedPos.lerp(target, Math.min(1, k * 1.4));
    }

    this.camera.position.copy(this.smoothedPos);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll + this.vaultTilt, 'YXZ');
  }

  reset(): void {
    this.initialised = false;
    this.dip = 0;
    this.dipVel = 0;
    this.roll = 0;
    this.fov = this.baseFov;
  }
}
