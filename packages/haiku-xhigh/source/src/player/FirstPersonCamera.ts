import * as THREE from 'three';
import { PlayerController, SPRINT_SPEED, WALK_SPEED } from './PlayerController';
import { SLIDE_HEIGHT, STAND_HEIGHT } from './PlayerPhysics';

const BASE_FOV = 72;
const MAX_EXTRA_FOV = 9;
const EYE_STAND = 1.6;
const EYE_SLIDE = 0.75;
const DEG = Math.PI / 180;

/**
 * First-person camera. It reads the player's state and turns it into subtle motion:
 * head bob, speed FOV, strafe and wall-lean roll, landing dip, and vault lift.
 * Every effect is scaled by `reduceMotion` so the player can turn them down.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  /** Multiplier on mouse look speed, set from the menu. */
  sensitivity = 1;
  /** When true, camera-shake style effects are reduced to a fraction of their normal size. */
  reduceMotion = false;

  private fov = BASE_FOV;
  private roll = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private landDip = 0;
  private pitchKick = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.05, 1500);
    this.camera.rotation.order = 'YXZ';
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Applies mouse movement in pixels. */
  look(dx: number, dy: number): void {
    const k = 0.0022 * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * k));
  }

  /** Teleports the view for respawns: face the route (-Z) and level the head. */
  resetView(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.landDip = 0;
    this.pitchKick = 0;
    this.bobAmount = 0;
  }

  /** Small nose-up kick on takeoff. */
  onJump(): void {
    this.pitchKick = 0.035;
  }

  /** Dip proportional to impact speed on landing. */
  onLand(impact: number): void {
    this.landDip = Math.min(0.2, impact * 0.012);
  }

  update(dt: number, feet: { x: number; y: number; z: number }, ctl: PlayerController): void {
    const motion = this.reduceMotion ? 0.35 : 1;
    const speed = ctl.speed;
    const physics = ctl.physics;
    const mode = ctl.mode;
    const scripted = mode === 'vault' || mode === 'mantle';

    // Eye height follows body height so sliding lowers the view smoothly.
    const crouch = Math.max(0, Math.min(1, (physics.height - SLIDE_HEIGHT) / (STAND_HEIGHT - SLIDE_HEIGHT)));
    const eyeBase = EYE_SLIDE + (EYE_STAND - EYE_SLIDE) * crouch;

    // Head bob while running on the ground.
    const moving = physics.grounded && mode === 'normal' && speed > 1;
    if (moving) this.bobPhase += dt * speed * 1.6;
    const targetBob = moving ? Math.min(1, speed / SPRINT_SPEED) * 0.04 : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmount * motion;
    const bobX = Math.cos(this.bobPhase) * this.bobAmount * 0.5 * motion;

    this.landDip *= Math.exp(-dt * 9);
    this.pitchKick *= Math.exp(-dt * 10);

    // Vault and mantle: lift the view over the obstacle, then settle.
    const arc = scripted ? Math.sin(Math.PI * ctl.scriptProgress) : 0;
    const liftScale = ctl.currentScriptKind === 'vault' ? 0.16 : 0.26;
    const vaultLift = arc * liftScale * motion;
    const vaultPitch = -arc * 0.07 * motion;

    // FOV widens with speed, and slightly more while wall-running.
    const speedFactor = Math.max(0, Math.min(1, (speed - WALK_SPEED) / (SPRINT_SPEED - WALK_SPEED)));
    const targetFov = BASE_FOV + speedFactor * MAX_EXTRA_FOV * motion + (mode === 'wallrun' ? 3 * motion : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Roll leans into strafing and into a wall while wall-running.
    const v = physics.velocity;
    const strafe = speed > 0.5 ? (v.x * Math.cos(this.yaw) - v.z * Math.sin(this.yaw)) / speed : 0;
    const targetRoll = (-strafe * 1.2 - ctl.wallLean * 6) * DEG * motion;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);

    const cam = this.camera;
    cam.position.set(
      feet.x + Math.cos(this.yaw) * bobX,
      feet.y + eyeBase + bobY + vaultLift - this.landDip * motion,
      feet.z - Math.sin(this.yaw) * bobX,
    );
    cam.rotation.set(this.pitch + this.pitchKick + vaultPitch, this.yaw, this.roll);
  }
}
