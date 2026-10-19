import * as THREE from 'three';
import { Settings } from '../game/GameState';
import { PlayerPhysics, TUNING } from './PlayerPhysics';
import { ParkourSystem } from './ParkourSystem';

const BASE_FOV = 74;
const MAX_FOV_BOOST = 10;
const EYE_OFFSET = 0.13; // eye sits this far below the top of the collision box
const LOOK_SENSITIVITY = 0.0022;
const PITCH_LIMIT = 1.45;

/**
 * First-person camera. Turns mouse input into yaw and pitch, and layers on
 * speed-based FOV, head bob, strafe roll, wall tilt, landing dip, and the
 * vault pulse. Every effect is scaled down when reduce-motion is on.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Yaw 0 looks down -Z, which is the route direction. */
  yaw = 0;
  pitch = 0;

  private eyeHeight = TUNING.standHeight - EYE_OFFSET;
  private fov = BASE_FOV;
  private bobTime = 0;
  private bobAmount = 0;
  private roll = 0;
  private landingDip = 0;
  private takeoffKick = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
  }

  /** Forward and right vectors on the horizontal plane. Useful for movement input. */
  get forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  get right(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Applies raw mouse deltas (pixels) from pointer lock. */
  look(dx: number, dy: number, settings: Settings): void {
    const k = LOOK_SENSITIVITY * settings.sensitivity;
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Snaps the view to a facing, used on respawn and restart. */
  setView(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Call once per rendered frame with the latest physics state. */
  update(
    dt: number,
    phys: PlayerPhysics,
    parkour: ParkourSystem,
    settings: Settings,
  ): void {
    const motion = settings.reduceMotion ? 0.3 : 1;
    const rt = this.right;
    const speed = phys.speed;

    // Eye height follows the collision box (slides lower the eye). Smoothed so
    // the drop reads as motion rather than a snap.
    const targetEye = phys.height - EYE_OFFSET;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 14);

    // Speed-based FOV, with a little extra kick while sprinting.
    const speedT = THREE.MathUtils.clamp((speed - 6) / 7, 0, 1);
    const targetFov = BASE_FOV + speedT * MAX_FOV_BOOST * motion;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 5);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Head bob: only on the ground, scaled by speed. Light by design.
    const grounded = phys.grounded && !parkour.isAnimating();
    const bobTarget = grounded ? THREE.MathUtils.clamp(speed / TUNING.sprintSpeed, 0, 1) : 0;
    this.bobAmount += (bobTarget - this.bobAmount) * Math.min(1, dt * 8);
    this.bobTime += dt * (6 + speed * 0.9);
    const bobY = Math.sin(this.bobTime * 2) * 0.035 * this.bobAmount * motion;
    const bobX = Math.cos(this.bobTime) * 0.02 * this.bobAmount * motion;

    // Strafe roll: lean into lateral movement. Wall run tilt: lean away from the wall.
    const strafe = phys.vel.x * rt.x + phys.vel.z * rt.z;
    const strafeRoll = -THREE.MathUtils.clamp(strafe / 12, -1, 1) * 0.035 * motion;
    const wallRoll = -parkour.wallSide * 0.16 * (parkour.isWallRunning ? 1 : 0) * motion;
    this.roll += (strafeRoll + wallRoll - this.roll) * Math.min(1, dt * 8);

    // Landing dip (set in onLand) and takeoff kick (set in onJump) decay over time.
    this.landingDip *= Math.max(0, 1 - dt * 9);
    this.takeoffKick *= Math.max(0, 1 - dt * 7);

    // Vault: the body rises and settles through the arc.
    const vaultLift = parkour.actionPulse * 0.22 * motion;

    const eyeY = phys.pos.y + this.eyeHeight - this.landingDip + vaultLift + bobY;
    this.camera.position.set(
      phys.pos.x + bobX * rt.x,
      eyeY,
      phys.pos.z + bobX * rt.z,
    );

    // Positive pitch looks up, so the takeoff kick adds to it.
    this.camera.rotation.set(
      this.pitch + this.takeoffKick,
      this.yaw,
      this.roll - parkour.actionPulse * 0.04 * motion,
      'YXZ',
    );
  }

  /** Called on landing. `impactSpeed` is the downward speed at touchdown. */
  onLand(impactSpeed: number, settings: Settings): void {
    const scale = settings.reduceMotion ? 0.3 : 1;
    const amount = THREE.MathUtils.clamp(impactSpeed / 18, 0, 1) * 0.16 * scale;
    this.landingDip = Math.max(this.landingDip, amount);
  }

  /** Called on jump takeoff. A small upward pitch kick, scaled by reduce-motion. */
  onJump(settings: Settings): void {
    this.takeoffKick = settings.reduceMotion ? 0.005 : 0.02;
  }
}
