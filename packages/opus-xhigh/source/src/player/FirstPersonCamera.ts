import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { MOVE } from './MovementConfig';
import type { PlayerController, PlayerEvent } from './PlayerController';

/** Critically-damped-ish spring used for camera impulses (landing, jumps…). */
class Spring {
  value = 0;
  velocity = 0;
  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
  ) {}

  update(dt: number): void {
    // Sub-step for stability with long frames.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const accel = -this.stiffness * this.value - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
  }

  kick(v: number): void {
    this.velocity += v;
  }

  reset(): void {
    this.value = 0;
    this.velocity = 0;
  }
}

export interface CameraSettings {
  sensitivity: number;
  /** Horizontal field of view (degrees) at rest. */
  baseFov: number;
  /** 1 = full camera motion, ~0.3 = reduced. */
  motion: number;
  invertY: boolean;
}

const DEG = Math.PI / 180;

/**
 * Turns the player's simulated state into a first-person camera: mouse look,
 * eye height, head bob, speed FOV, strafe and wall-run roll, and spring-based
 * reactions to landing, jumping, vaulting and mantling.
 */
export class FirstPersonCamera {
  yaw = 0;
  pitch = 0;

  /** Final effect values, exposed for the body/arms. */
  bobX = 0;
  bobY = 0;
  roll = 0;
  speedFactor = 0;

  private eyeHeight: number = MOVE.STAND_EYE;
  private stepOffset = 0;
  private bobWeight = 0;
  private strafeRoll = 0;
  private wallRoll = 0;
  private slideRoll = 0;
  private slidePitch = 0;
  private fov = 80;
  private readonly heightSpring = new Spring(140, 15);
  private readonly pitchSpring = new Spring(110, 13);
  private readonly rollSpring = new Spring(90, 11);

  readonly worldPosition = new Vector3();

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly settings: CameraSettings,
  ) {
    this.camera.rotation.order = 'YXZ';
    this.fov = settings.baseFov;
  }

  /** Raw mouse movement (pixels). */
  look(dx: number, dy: number): void {
    const k = 0.0019 * this.settings.sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (this.settings.invertY ? -1 : 1);
    this.pitch = MathUtils.clamp(this.pitch, -88 * DEG, 88 * DEG);
    // Keep yaw bounded to avoid precision drift over long sessions.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  setOrientation(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Instantly settle all effects (on respawn). */
  reset(): void {
    this.eyeHeight = MOVE.STAND_EYE;
    this.stepOffset = 0;
    this.bobWeight = 0;
    this.strafeRoll = 0;
    this.wallRoll = 0;
    this.slideRoll = 0;
    this.slidePitch = 0;
    this.heightSpring.reset();
    this.pitchSpring.reset();
    this.rollSpring.reset();
    this.fov = this.settings.baseFov;
  }

  handleEvent(e: PlayerEvent): void {
    const m = this.settings.motion;
    switch (e.type) {
      case 'land': {
        const impact = Math.min(e.impact, 24);
        this.heightSpring.kick(-impact * 0.28 * (e.hard ? 1.5 : 1) * (0.4 + 0.6 * m));
        this.pitchSpring.kick(-impact * 0.07 * m);
        if (e.hard) this.rollSpring.kick((Math.random() < 0.5 ? -1 : 1) * 0.6 * m);
        break;
      }
      case 'jump':
        this.heightSpring.kick(-0.9 * m);
        this.pitchSpring.kick(0.3 * m);
        break;
      case 'walljump':
        this.pitchSpring.kick(0.3 * m);
        this.rollSpring.kick(-this.wallRoll * 2.5);
        break;
      case 'vault':
        this.pitchSpring.kick(-1.1 * m);
        this.rollSpring.kick(0.8 * m);
        break;
      case 'mantle':
        this.pitchSpring.kick(-1.4 * m);
        this.heightSpring.kick(-1.2 * m);
        break;
      case 'step':
        // Physics moved us by dy instantly; let the camera catch up smoothly.
        this.stepOffset -= e.dy;
        break;
      case 'slideStart':
        this.heightSpring.kick(-1.0 * m);
        break;
      default:
        break;
    }
  }

  /**
   * Updates the camera for this render frame.
   * @param feet interpolated feet position
   */
  update(dt: number, feet: Vector3, player: PlayerController): void {
    const m = this.settings.motion;
    const speed = player.horizontalSpeed;
    const state = player.state;
    const groundedMove = (state === 'ground' || state === 'crouch') && player.grounded;

    // Eye height (crouch/slide lowers the camera smoothly).
    const targetEye = player.isCrouched ? MOVE.CROUCH_EYE : MOVE.STAND_EYE;
    this.eyeHeight = damp(this.eyeHeight, targetEye, 12, dt);
    this.stepOffset = damp(this.stepOffset, 0, 16, dt);

    // Head bob, phase-locked to footsteps.
    const bobTarget = groundedMove && speed > 0.8 ? 1 : state === 'wallrun' ? 0.6 : 0;
    this.bobWeight = damp(this.bobWeight, bobTarget, 10, dt);
    const phase = player.stepPhase;
    const intensity = MathUtils.clamp(speed / MOVE.SPRINT_SPEED, 0, 1.1);
    const amp = 0.042 * intensity * this.bobWeight * m;
    this.bobY = -amp * (1 + Math.cos(phase * Math.PI * 2)) * 0.5;
    this.bobX = amp * 0.6 * Math.sin(phase * Math.PI);

    // Roll: strafe lean, wall-run tilt toward the wall, slide lean.
    this.strafeRoll = damp(this.strafeRoll, -player.inputStrafe * 1.5 * DEG * m, 8, dt);
    const wallTarget = state === 'wallrun' && player.wall ? -player.wall.side * 11 * DEG * (0.35 + 0.65 * m) : 0;
    this.wallRoll = damp(this.wallRoll, wallTarget, state === 'wallrun' ? 9 : 6, dt);
    this.slideRoll = damp(this.slideRoll, state === 'slide' ? 3.5 * DEG * m : 0, 8, dt);
    this.slidePitch = damp(this.slidePitch, state === 'slide' ? -6 * DEG : 0, 8, dt);

    // Traversal camera moves: a gentle dip/roll that follows the move's progress.
    let traversalPitch = 0;
    let traversalRoll = 0;
    if (player.traversal) {
      const p = player.traversal.progress;
      const s = Math.sin(Math.PI * p);
      if (player.traversal.kind === 'vault') {
        traversalPitch = -5 * DEG * s * m;
        traversalRoll = 4 * DEG * s * m;
      } else {
        traversalPitch = -7 * DEG * s * m;
      }
    }

    this.heightSpring.update(dt);
    this.pitchSpring.update(dt);
    this.rollSpring.update(dt);

    this.roll = this.strafeRoll + this.wallRoll + this.slideRoll + traversalRoll + this.rollSpring.value + this.bobX * 0.6;

    // Speed-dependent FOV.
    this.speedFactor = MathUtils.clamp((speed - 5) / (MOVE.SPRINT_SPEED + 1.5 - 5), 0, 1);
    const fall = MathUtils.clamp((-player.vel.y - 10) / 15, 0, 1);
    const fovTarget = this.settings.baseFov + (12 * this.speedFactor + (state === 'slide' ? 4 : 0) + 6 * fall) * (0.3 + 0.7 * m);
    this.fov = damp(this.fov, fovTarget, 4, dt);
    // The setting is horizontal FOV (what players expect); three.js wants vertical.
    const vertical = (2 * Math.atan(Math.tan((this.fov * DEG) / 2) / this.camera.aspect)) / DEG;
    if (Math.abs(this.camera.fov - vertical) > 0.01) {
      this.camera.fov = vertical;
      this.camera.updateProjectionMatrix();
    }

    // Compose the transform.
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const y = feet.y + this.eyeHeight + this.stepOffset + this.bobY + MathUtils.clamp(this.heightSpring.value, -0.38, 0.12);
    this.worldPosition.set(feet.x + rightX * this.bobX, y, feet.z + rightZ * this.bobX);
    this.camera.position.copy(this.worldPosition);
    const pitch = MathUtils.clamp(this.pitch + this.pitchSpring.value + traversalPitch + this.slidePitch, -89 * DEG, 89 * DEG);
    this.camera.rotation.set(pitch, this.yaw, this.roll);
  }
}

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}
