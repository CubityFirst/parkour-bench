import * as THREE from 'three';
import { PlayerConfig as C } from './PlayerConfig.ts';
import { MoveMode, type PlayerController, type PlayerEvent } from './PlayerController.ts';

const MAX_PITCH = THREE.MathUtils.degToRad(88);
const DEG = Math.PI / 180;

/** Frame-rate independent exponential smoothing. */
const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** Critically damped-ish spring used for camera kicks. */
class Spring {
  value = 0;
  velocity = 0;
  private readonly stiffness: number;
  private readonly damping: number;

  constructor(stiffness: number, dampingRatio: number) {
    this.stiffness = stiffness;
    this.damping = 2 * Math.sqrt(stiffness) * dampingRatio;
  }

  update(dt: number): void {
    // Semi-implicit Euler with a couple of sub-steps for stability at low frame rates.
    const steps = dt > 1 / 90 ? 3 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity += (-this.stiffness * this.value - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
  }

  reset(): void {
    this.value = 0;
    this.velocity = 0;
  }
}

export interface CameraOptions {
  /** Horizontal field of view in degrees. */
  fov: number;
  /** 0 = no camera motion effects, 1 = full. */
  motion: number;
}

/**
 * First-person camera: mouse look plus all the procedural motion that sells speed and
 * weight (head bob synced to footsteps, speed FOV, strafe and wall-run roll, landing dip,
 * vault/mantle kicks, smooth crouch/slide height and step smoothing).
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;

  private eyeHeight: number = C.EYE_STAND;
  /** Hides the instant pops of step-ups and ground snapping. */
  private stepOffset = 0;
  private readonly land = new Spring(150, 0.62);
  private readonly pitchKick = new Spring(120, 0.7);
  private readonly rollKick = new Spring(90, 0.65);
  private roll = 0;
  private fovBoost = 0;
  private bobAmount = 0;
  private bobParity = 0;
  private lastPhase = 0;
  private shake = 0;
  private time = 0;
  /** Current horizontal FOV after effects (for HUD / body overlay). */
  currentFov = 90;

  private readonly tmpPos = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 7000);
    this.camera.rotation.order = 'YXZ';
  }

  /** Applies raw mouse movement (pixels). */
  look(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    const k = 0.0016 * sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
    // Keep yaw bounded so float precision never degrades over a long session.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /** Snap all smoothing state (respawn / restart). */
  reset(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.eyeHeight = C.EYE_STAND;
    this.stepOffset = 0;
    this.land.reset();
    this.pitchKick.reset();
    this.rollKick.reset();
    this.roll = 0;
    this.fovBoost = 0;
    this.bobAmount = 0;
    this.shake = 0;
  }

  /** Physics popped the body vertically by `amount`; keep the camera where it was and ease. */
  absorbStep(amount: number): void {
    this.stepOffset = Math.max(-0.6, Math.min(0.6, this.stepOffset - amount));
  }

  onEvent(e: PlayerEvent, motion: number): void {
    switch (e.type) {
      case 'land': {
        const k = Math.min(e.impact, 22);
        this.land.velocity -= Math.min(k * 0.24, 6.5) * (0.3 + 0.7 * motion);
        this.pitchKick.velocity -= Math.min(k * 0.022, 0.5) * motion;
        if (e.hard) this.shake = Math.max(this.shake, 0.6 * motion);
        break;
      }
      case 'jump':
        this.land.velocity -= 0.7 * motion;
        this.pitchKick.velocity += 0.35 * motion;
        break;
      case 'wallJump':
        this.pitchKick.velocity += 0.5 * motion;
        this.rollKick.velocity += 0.6 * motion * (this.roll > 0 ? -1 : 1);
        break;
      case 'vault':
        this.pitchKick.velocity -= 1.1 * motion;
        this.rollKick.velocity += 0.9 * motion;
        break;
      case 'mantle':
        this.pitchKick.velocity -= (0.9 + e.height * 0.35) * motion;
        break;
      case 'slideStart':
        this.rollKick.velocity -= 0.35 * motion;
        break;
      case 'bonk':
        this.shake = Math.max(this.shake, 0.35 * motion);
        this.pitchKick.velocity += 0.6 * motion;
        break;
      case 'zipAttach':
        this.land.velocity -= 1.2 * motion;
        this.pitchKick.velocity -= 0.4 * motion;
        break;
      default:
        break;
    }
  }

  update(dt: number, player: PlayerController, alpha: number, opts: CameraOptions): void {
    this.time += dt;
    const motion = opts.motion;
    const mode = player.mode;
    const speed = player.horizontalSpeed;

    // --- Position: interpolate between the last two physics states.
    const pos = this.tmpPos.copy(player.prevPos).lerp(player.position, alpha);

    let eyeTarget: number = C.EYE_STAND;
    if (mode === MoveMode.Slide) eyeTarget = C.EYE_SLIDE;
    else if (player.crouched) eyeTarget = C.EYE_CROUCH;
    else if (mode === MoveMode.Vault) eyeTarget = C.EYE_STAND - 0.22;
    else if (mode === MoveMode.Mantle) eyeTarget = C.EYE_STAND - 0.1;
    this.eyeHeight = damp(this.eyeHeight, eyeTarget, mode === MoveMode.Slide ? 16 : 11, dt);
    this.stepOffset = damp(this.stepOffset, 0, 14, dt);

    this.land.update(dt);
    this.pitchKick.update(dt);
    this.rollKick.update(dt);
    this.land.value = Math.max(-0.42, Math.min(0.2, this.land.value));

    // --- Head bob, synced to the controller's stride phase (footstep sounds use the same phase).
    const grounded = mode === MoveMode.Ground;
    const bobTarget = (grounded || mode === MoveMode.WallRun) && speed > 0.8 ? Math.min(1, speed / C.SPRINT_SPEED) : 0;
    this.bobAmount = damp(this.bobAmount, bobTarget, 9, dt);
    const phase = player.stridePhase;
    if (phase < this.lastPhase) this.bobParity ^= 1;
    this.lastPhase = phase;
    const ampV = (0.022 + 0.022 * this.bobAmount) * this.bobAmount * motion;
    const ampH = 0.016 * this.bobAmount * motion;
    const bobY = -ampV * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2));
    const sway = Math.sin((phase + this.bobParity) * Math.PI);
    const bobX = ampH * sway;
    const bobRoll = 0.35 * DEG * sway * this.bobAmount * motion;

    // --- Roll: strafing lean, wall-run tilt, slide tilt, zipline sway.
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const lateral = player.velocity.x * rightX + player.velocity.z * rightZ;
    let rollTarget = -(lateral / C.SPRINT_SPEED) * 1.6 * DEG;
    // Head leans away from the wall, so the horizon dips towards it.
    if (mode === MoveMode.WallRun) rollTarget = player.wallSide * 11 * DEG;
    else if (mode === MoveMode.Slide) rollTarget += 2.5 * DEG;
    else if (mode === MoveMode.Zipline) rollTarget += Math.sin(this.time * 1.7) * 1.2 * DEG;
    this.roll = damp(this.roll, rollTarget * motion, mode === MoveMode.WallRun ? 7 : 6, dt);

    // --- Shake (hard landings, ceiling bumps).
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake;
    const shakeX = (Math.sin(this.time * 71) + Math.sin(this.time * 43)) * 0.012 * sh;
    const shakeY = (Math.sin(this.time * 59) + Math.sin(this.time * 31)) * 0.012 * sh;

    const y = pos.y + this.eyeHeight + this.stepOffset + this.land.value + bobY + shakeY;
    this.camera.position.set(pos.x + rightX * (bobX + shakeX), y, pos.z + rightZ * (bobX + shakeX));
    this.camera.rotation.set(
      this.pitch + this.pitchKick.value * 0.06,
      this.yaw,
      this.roll + bobRoll + this.rollKick.value * 0.035,
      'YXZ',
    );

    // --- Speed-dependent field of view.
    let boost = 13 * THREE.MathUtils.smoothstep(speed, 6.5, 14);
    if (mode === MoveMode.Slide) boost += 4;
    if (mode === MoveMode.Zipline) boost += 3;
    this.fovBoost = damp(this.fovBoost, boost * (0.25 + 0.75 * motion), 3.5, dt);
    this.currentFov = opts.fov + this.fovBoost;
    this.applyFov();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.applyFov();
  }

  private applyFov(): void {
    const h = THREE.MathUtils.degToRad(this.currentFov);
    const v = 2 * Math.atan(Math.tan(h / 2) / this.camera.aspect);
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(v), 40, 105);
    this.camera.updateProjectionMatrix();
  }
}
