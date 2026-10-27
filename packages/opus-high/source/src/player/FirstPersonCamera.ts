import * as THREE from 'three';
import type { PlayerController } from './PlayerController';
import { PLAYER } from './PlayerPhysics';

export type CameraMotion = 'full' | 'reduced' | 'minimal';

const MOTION_SCALE: Record<CameraMotion, number> = { full: 1, reduced: 0.45, minimal: 0.1 };
const FOV_SCALE: Record<CameraMotion, number> = { full: 1, reduced: 0.6, minimal: 0.3 };

/** Critically damped spring used for landing dips and kick animations. */
class Spring {
  value = 0;
  velocity = 0;
  constructor(private stiffness: number, private damping: number) {}
  update(dt: number, target = 0): number {
    // Sub-step so the spring stays stable even during long frames.
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = (target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  kick(v: number): void {
    this.velocity += v;
  }
}

const _pos = new THREE.Vector3();

/**
 * Mouse look plus all procedural first-person camera motion:
 * head bob, speed FOV, strafe roll, wall-run tilt, landing dip, slide height
 * and vault/mantle kicks. Everything is scaled by the camera-motion setting.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  motion: CameraMotion = 'full';
  baseFov = 78;

  private eyeHeight: number = PLAYER.eyeStand;
  private roll = 0;
  private fov = 78;
  private landSpring = new Spring(140, 18);
  private pitchSpring = new Spring(120, 16);
  private rollSpring = new Spring(90, 14);
  private stepOffset = 0;
  private bobAmount = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.05, 4000);
    this.camera.rotation.order = 'YXZ';
  }

  /** Raw mouse deltas in pixels. */
  look(dx: number, dy: number): void {
    const k = 0.0022 * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.55, 1.55);
  }

  setOrientation(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  // Event hooks ---------------------------------------------------------------

  onLand(impact: number): void {
    const s = MOTION_SCALE[this.motion];
    const k = Math.min(impact, 22);
    this.landSpring.kick(-k * 0.25 * s);
    this.pitchSpring.kick(-k * 0.08 * s);
  }

  onJump(): void {
    const s = MOTION_SCALE[this.motion];
    this.landSpring.kick(0.6 * s);
    this.pitchSpring.kick(0.5 * s);
  }

  onVault(): void {
    const s = MOTION_SCALE[this.motion];
    this.pitchSpring.kick(-2.6 * s);
    this.rollSpring.kick(1.5 * s);
  }

  onMantle(): void {
    const s = MOTION_SCALE[this.motion];
    this.pitchSpring.kick(-2.0 * s);
    this.landSpring.kick(-1.0 * s);
  }

  onSlideStart(): void {
    const s = MOTION_SCALE[this.motion];
    this.landSpring.kick(-1.5 * s);
  }

  /** Called every rendered frame with the interpolation factor between physics steps. */
  update(dt: number, player: PlayerController, alpha: number): void {
    const s = MOTION_SCALE[this.motion];
    const speed = player.horizontalSpeed;

    // Interpolated feet position for smooth rendering at any refresh rate.
    _pos.lerpVectors(player.prevPosition, player.position, alpha);

    // Smooth eye height for crouch / slide / vault.
    this.eyeHeight = THREE.MathUtils.damp(this.eyeHeight, player.eyeHeightTarget, 14, dt);

    // Step-ups move the body instantly; the camera catches up smoothly.
    if (player.pendingStepUp > 0) {
      this.stepOffset -= player.pendingStepUp;
      player.pendingStepUp = 0;
    }
    this.stepOffset = THREE.MathUtils.damp(this.stepOffset, 0, 16, dt);

    // Head bob (only when running on the ground).
    const bobTarget = player.state === 'ground' ? THREE.MathUtils.clamp(speed / PLAYER.sprintSpeed, 0, 1) : 0;
    this.bobAmount = THREE.MathUtils.damp(this.bobAmount, bobTarget, 10, dt);
    const ph = player.bobPhase;
    const bobY = Math.abs(Math.sin(ph)) * 0.055 * this.bobAmount * s - 0.03 * this.bobAmount * s;
    const bobX = Math.cos(ph) * 0.03 * this.bobAmount * s;
    const wallBob = player.state === 'wallrun' ? Math.abs(Math.sin(ph)) * 0.03 * s : 0;

    // Roll: strafe lean + wall-run tilt toward the wall + a touch while sliding.
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const lateral = player.velocity.x * rightX + player.velocity.z * rightZ;
    let rollTarget = -lateral * 0.0035;
    if (player.state === 'wallrun' && player.wallRun) rollTarget = player.wallRun.side * 0.17;
    if (player.state === 'slide') rollTarget += 0.045;
    rollTarget *= s;
    this.roll = THREE.MathUtils.damp(this.roll, rollTarget, 7, dt);

    const land = this.landSpring.update(dt);
    const pitchKick = this.pitchSpring.update(dt);
    const rollKick = this.rollSpring.update(dt);

    // Speed-dependent field of view.
    const speedFactor = THREE.MathUtils.clamp((speed - 6) / 7, 0, 1);
    const fovTarget = this.baseFov + speedFactor * 12 * FOV_SCALE[this.motion] + (player.state === 'slide' ? 3 : 0);
    this.fov = THREE.MathUtils.damp(this.fov, fovTarget, 5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.set(
      _pos.x + rightX * bobX,
      _pos.y + this.eyeHeight + bobY + wallBob + land + this.stepOffset,
      _pos.z + rightZ * bobX,
    );
    this.camera.rotation.set(
      THREE.MathUtils.clamp(this.pitch + pitchKick, -1.56, 1.56),
      this.yaw,
      this.roll + rollKick,
    );
  }

  /** Slow cinematic orbit used behind the main menu. */
  updateMenu(time: number, center: THREE.Vector3): void {
    const yaw = 0.35 * Math.sin(time * 0.05) + 0.2;
    this.camera.position.set(center.x - 2, center.y + 2.4, center.z + 4);
    this.camera.rotation.set(-0.06 + 0.03 * Math.sin(time * 0.11), yaw, 0);
    if (this.camera.fov !== this.baseFov) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
