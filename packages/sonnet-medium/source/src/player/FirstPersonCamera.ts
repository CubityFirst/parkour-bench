import * as THREE from 'three';
import { BODY } from './PlayerPhysics';
import { MOVE, PlayerController } from './PlayerController';

/**
 * Owns the three.js camera: mouse look plus all the "feel" layers - speed FOV,
 * strafe roll, wall-run tilt, head bob, landing spring, slide lowering, vault/mantle motion.
 * Every motion layer is scaled by `motionScale` (the reduce-camera-motion option).
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  motionScale = 1;

  private eye: number = BODY.eyeStand;
  private roll = 0;
  private fov = 75;
  private bob = 0;
  private bobAmp = 0;
  private landY = 0;
  private landV = 0;
  private wasGrounded = true;
  private pitchKick = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.05, 4500);
    this.camera.rotation.order = 'YXZ';
  }

  setReduceMotion(on: boolean): void {
    this.motionScale = on ? 0.25 : 1;
  }

  look(dx: number, dy: number): void {
    const k = 0.0022 * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  /** Called when the player lands (impact in m/s). */
  onLand(impact: number): void {
    const d = Math.min(0.22, impact * 0.011);
    this.landV -= d * 14;
    this.pitchKick = Math.min(0.05, impact * 0.003);
  }

  onJump(): void {
    this.landV += 1.2;
  }

  /** Eye position (world) for a given feet position. */
  update(dt: number, pc: PlayerController, alpha: number): void {
    const p = pc.phys;
    const m = this.motionScale;
    const x = pc.prev[0] + (p.p[0] - pc.prev[0]) * alpha;
    const y = pc.prev[1] + (p.p[1] - pc.prev[1]) * alpha;
    const z = pc.prev[2] + (p.p[2] - pc.prev[2]) * alpha;
    const speed = pc.speed;
    const speedF = Math.min(1, Math.max(0, (speed - 4) / (MOVE.sprintSpeed - 4)));

    // eye height: lowers while sliding / crouched, smooth either way
    let targetEye = p.height < BODY.standHeight - 0.05 ? BODY.eyeSlide : BODY.eyeStand;
    if (pc.mode === 'script' && pc.scriptMove) {
      const s = pc.scriptT;
      targetEye = BODY.eyeStand - 0.25 * Math.sin(Math.PI * s);
    }
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-14 * dt));

    // landing spring
    this.landY += this.landV * dt;
    this.landV += (-170 * this.landY - 17 * this.landV) * dt;
    this.pitchKick *= Math.exp(-8 * dt);

    // head bob (only while running on the ground)
    const bobTarget = pc.mode === 'ground' && speed > 1 ? Math.min(1, speed / MOVE.sprintSpeed) : 0;
    this.bobAmp += (bobTarget - this.bobAmp) * (1 - Math.exp(-10 * dt));
    const bobY = -Math.abs(Math.sin(pc.bobPhase)) * 0.045 * this.bobAmp * m;
    const bobX = Math.sin(pc.bobPhase) * 0.02 * this.bobAmp * m;

    // roll: strafe + wall-run tilt (towards the wall)
    let rollTarget = -pc.lastInputX * 0.022 * (0.4 + speedF) * m;
    rollTarget += -pc.wallSide * 0.2 * m;
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-9 * dt));

    // FOV widens with speed
    const fovTarget = 75 + speedF * 15 * m + (pc.mode === 'slide' ? 4 * m : 0);
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-6 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // vault / mantle: brief dip + forward lean
    let scriptPitch = 0, scriptRoll = 0;
    if (pc.mode === 'script' && pc.scriptMove) {
      const s = Math.sin(Math.PI * pc.scriptT);
      scriptPitch = (pc.scriptMove.kind === 'vault' ? -0.09 : -0.14) * s * m;
      scriptRoll = 0.03 * s * m;
    }

    // wall-run keeps the jitter-free bob replaced by a gentle sway
    this.camera.position.set(x + bobX * Math.cos(this.yaw), y + this.eye + bobY + this.landY * m, z - bobX * Math.sin(this.yaw));
    this.camera.rotation.set(this.pitch + scriptPitch - this.pitchKick * m, this.yaw, this.roll + scriptRoll);
    this.wasGrounded = p.grounded;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Reset transient effects (respawn). */
  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.landY = this.landV = 0;
    this.eye = BODY.eyeStand;
    this.bobAmp = 0;
  }
}
