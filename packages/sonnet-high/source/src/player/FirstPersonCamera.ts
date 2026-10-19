import * as THREE from 'three';
import { MoveState } from './PlayerController.ts';
import type { PlayerController } from './PlayerController.ts';
import { MOVE } from './MovementConfig.ts';

const DEG = Math.PI / 180;

/**
 * First-person camera rig. It never affects physics; it only dresses the view:
 * head bob, strafe roll, wall-run tilt, speed FOV, landing impact spring, slide lowering,
 * smoothed step-ups and a brief dip while vaulting/mantling.
 *
 * `motionScale` (1 normally, ~0.15 with "reduce camera motion") scales every effect.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  motionScale = 1;
  baseFov = 80;

  /** Smoothed eye height above the feet (also used to place the body model). */
  eye = 1.65;
  bobPhase = 0;
  /** Final applied roll (for the view-model). */
  roll = 0;
  bobX = 0;
  bobY = 0;

  private stepOffset = 0;
  private landOffset = 0;
  private landVel = 0;
  private bobAmp = 0;
  private strafe = 0;
  private wallRoll = 0;
  private fov = 80;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.05, 3000);
    this.camera.rotation.order = 'YXZ';
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Called by the game for each physics tick that produced an automatic step-up/down. */
  addStep(delta: number): void {
    this.stepOffset -= delta;
  }

  /** A faint upward kick when leaving the ground. */
  onTakeoff(): void {
    this.landVel += 0.55 * this.motionScale;
  }

  onLand(impact: number): void {
    if (impact < 4) return;
    this.landVel -= Math.min((impact - 3) * 0.13, 2.6) * this.motionScale;
  }

  /** Immediately snap to the player (after a respawn). */
  snap(ctrl: PlayerController): void {
    this.eye = ctrl.eyeTarget;
    this.stepOffset = this.landOffset = this.landVel = 0;
    this.wallRoll = this.strafe = this.roll = 0;
  }

  update(dt: number, ctrl: PlayerController, yaw: number, pitch: number, alpha: number): void {
    const p = ctrl.phys;
    const m = this.motionScale;
    const x = ctrl.prevX + (p.x - ctrl.prevX) * alpha;
    const y = ctrl.prevY + (p.y - ctrl.prevY) * alpha;
    const z = ctrl.prevZ + (p.z - ctrl.prevZ) * alpha;
    const speed = ctrl.speedH;
    const grounded = ctrl.state === MoveState.Ground || ctrl.state === MoveState.Slide;

    // Eye height (slide lowers the camera smoothly, standing back up is slightly slower).
    const target = ctrl.eyeTarget;
    const rate = target < this.eye ? 14 : 9;
    this.eye += (target - this.eye) * (1 - Math.exp(-rate * dt));

    this.stepOffset *= Math.exp(-14 * dt);

    // Landing impact: a damped spring on vertical offset.
    const k = 190;
    const c = 17;
    this.landVel += (-k * this.landOffset - c * this.landVel) * dt;
    this.landOffset += this.landVel * dt;

    // Head bob: phase advances with distance travelled on the ground.
    const moving = ctrl.state === MoveState.Ground && speed > 1.5;
    const ratio = Math.min(speed / MOVE.sprintSpeed, 1.1);
    const ampTarget = moving ? ratio * m : 0;
    this.bobAmp += (ampTarget - this.bobAmp) * (1 - Math.exp(-9 * dt));
    if (moving) this.bobPhase += dt * speed * 1.15;
    this.bobY = Math.sin(this.bobPhase * 2) * 0.034 * this.bobAmp;
    this.bobX = Math.sin(this.bobPhase) * 0.024 * this.bobAmp;

    // Roll: leaning into strafes and tilting towards the wall while wall-running.
    const inp = ctrl.lastInput;
    const strafeTarget = speed > 3 && (grounded || ctrl.state === MoveState.Air) ? inp.moveX : 0;
    this.strafe += (strafeTarget - this.strafe) * (1 - Math.exp(-8 * dt));
    const wallTarget = ctrl.state === MoveState.WallRun ? ctrl.wallSide * 9 * DEG : 0;
    this.wallRoll += (wallTarget - this.wallRoll) * (1 - Math.exp(-7 * dt));
    // Positive rotation.z leans the view to the left, so negate to lean towards +side.
    let roll = -this.strafe * 1.7 * DEG * m - this.wallRoll * m;

    // Brief procedural dip for vault / mantle.
    let pitchOff = 0;
    let dip = 0;
    if (ctrl.actionKind) {
      const pulse = Math.sin(ctrl.actionProgress * Math.PI);
      if (ctrl.actionKind === 'vault') {
        pitchOff = -pulse * 0.1 * m;
        roll += Math.sin(ctrl.actionProgress * Math.PI * 2) * 0.025 * m;
        dip = -pulse * 0.1 * m;
      } else {
        pitchOff = pulse * 0.07 * m;
        dip = -pulse * 0.05 * m;
      }
    }

    // Speed-dependent field of view (plus a little extra while sliding).
    const boost = Math.min(Math.max((speed - MOVE.walkSpeed) / (MOVE.sprintSpeed - MOVE.walkSpeed), 0), 1.3);
    const fovTarget = this.baseFov + (boost * 13 + (ctrl.state === MoveState.Slide ? 3 : 0)) * m;
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-5 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Right vector for sideways bob.
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    this.camera.position.set(
      x + rx * this.bobX,
      y + this.eye + this.bobY + this.landOffset + this.stepOffset + dip,
      z + rz * this.bobX,
    );
    this.camera.rotation.set(pitch + pitchOff, yaw, roll);
    this.roll = roll;
  }
}
