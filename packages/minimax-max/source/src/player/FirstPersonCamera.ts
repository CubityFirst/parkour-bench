import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA, PHYSICS } from '../game/Config';
import type { PlayerController } from './PlayerController';

/**
 * First person camera rig.
 *
 * Everything the player feels - speed, landings, slides, wall runs - is
 * communicated through a small set of offsets that are layered on top of the
 * raw mouse look.
 */
export class FirstPersonCamera {
  yaw = 0;
  pitch = 0;

  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private bobPhase = 0;
  private eyeOffset = PHYSICS.eyeStand;
  private fov = CAMERA.fovBase;
  private roll = 0;
  private landingSpring = 0;
  private landingVelocity = 0;
  private vaultDip = 0;
  private readonly target = new Vector3();
  private readonly desired = new Vector3();

  constructor(readonly camera: PerspectiveCamera) {
    this.camera.rotation.order = 'YXZ';
  }

  /** Applies raw mouse movement (in pixels) to the look angles. */
  applyLook(deltaX: number, deltaY: number, sensitivity: number): void {
    const scale = 0.0022 * sensitivity;
    this.yaw -= deltaX * scale;
    this.pitch -= deltaY * scale;
    if (this.pitch > CAMERA.pitchLimit) this.pitch = CAMERA.pitchLimit;
    if (this.pitch < -CAMERA.pitchLimit) this.pitch = -CAMERA.pitchLimit;
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /** Called when the player hits the ground. */
  onLand(impact: number): void {
    this.landingVelocity -= impact * 3.4;
  }

  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0;
    this.landingSpring = 0;
    this.landingVelocity = 0;
    this.bobPhase = 0;
    this.vaultDip = 0;
  }

  update(dt: number, player: PlayerController, strafe: number, motion: number): void {
    const phys = player.physics;
    const parkour = player.parkour;

    // --- body height ------------------------------------------------------
    const slideAmount = Math.min(
      1,
      Math.max(0, (PHYSICS.standHeight - phys.height) / (PHYSICS.standHeight - PHYSICS.slideHeight)),
    );
    const targetEye = PHYSICS.eyeStand + (PHYSICS.eyeSlide - PHYSICS.eyeStand) * slideAmount;
    this.eyeOffset += (targetEye - this.eyeOffset) * Math.min(1, dt * 16);

    // --- head bob ---------------------------------------------------------
    const speedFactor = Math.min(1, player.speed / PHYSICS.sprintSpeed);
    const moving = phys.grounded ? speedFactor : Math.min(1, player.speed / PHYSICS.sprintSpeed) * 0.35;
    this.bobPhase += player.speed * dt * 1.55;
    const bobY = Math.sin(this.bobPhase * 2) * CAMERA.bobAmount * moving * motion;
    const bobX = Math.sin(this.bobPhase) * CAMERA.bobLateral * moving * motion;

    // --- landing spring ---------------------------------------------------
    const stiffness = 120;
    const damping = 15;
    this.landingVelocity += -this.landingSpring * stiffness * dt;
    this.landingVelocity *= Math.max(0, 1 - damping * dt);
    this.landingSpring += this.landingVelocity * dt;
    if (this.landingSpring < -0.45) this.landingSpring = -0.45;

    // --- vault dip --------------------------------------------------------
    const vaultTarget = parkour.state === 'vault' ? -0.22 : 0;
    this.vaultDip += (vaultTarget - this.vaultDip) * Math.min(1, dt * 12);

    // --- position ---------------------------------------------------------
    this.desired.set(
      phys.position.x + player.right.x * bobX,
      phys.position.y + this.eyeOffset + bobY + this.landingSpring * motion + this.vaultDip * motion,
      phys.position.z + player.right.z * bobX,
    );
    this.target.copy(this.desired);
    // A zero delta snaps the camera (used after a respawn).
    const follow = dt <= 0 ? 1 : Math.min(1, dt * CAMERA.positionLerp);
    this.camera.position.lerp(this.target, follow);

    // --- field of view ----------------------------------------------------
    const wallRunning = parkour.state === 'wallrun';
    const targetFov = wallRunning
      ? CAMERA.fovWall
      : CAMERA.fovBase + (CAMERA.fovSprint - CAMERA.fovBase) * Math.max(0, speedFactor - 0.25) * 1.3;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * CAMERA.fovLerp);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // --- roll -------------------------------------------------------------
    let targetRoll = -strafe * CAMERA.strafeRoll;
    if (wallRunning) {
      // Lean into the wall the player is running on.
      targetRoll = parkour.wallSide * CAMERA.wallRoll;
    }
    this.roll += (targetRoll * motion - this.roll) * Math.min(1, dt * 9);

    this.euler.set(this.pitch, this.yaw, this.roll);
    this.camera.quaternion.setFromEuler(this.euler);
  }
}
