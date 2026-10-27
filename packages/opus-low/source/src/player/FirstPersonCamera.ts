import * as THREE from 'three';
import type { PlayerController, PlayerEvent, PlayerInput } from './PlayerController';
import { Hands } from './Hands';

const BASE_FOV = 78;

/** Mouse look plus all procedural camera feedback (bob, roll, FOV, landing dip...). */
export class FirstPersonCamera {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  /** 1 = full camera motion, lower values reduce bob/roll/shake. */
  motion = 1;

  private eyeHeight = 1.65;
  private bobPhase = 0;
  private bobAmount = 0;
  private landDip = 0;
  private landVel = 0;
  private roll = 0;
  private fov = BASE_FOV;
  private jumpKick = 0;
  hands: Hands;

  constructor(public camera: THREE.PerspectiveCamera) {
    this.hands = new Hands(camera);
  }

  applyMouse(dx: number, dy: number) {
    const s = 0.0022 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * s, -1.5, 1.5);
  }

  handleEvent(e: PlayerEvent) {
    if (e.type === 'land') {
      const k = THREE.MathUtils.clamp((e.impact - 3) / 14, 0, 1);
      this.landVel -= (0.6 + k * 2.2) * this.motion;
    } else if (e.type === 'jump') {
      this.jumpKick = 1;
    }
  }

  reset(yaw: number) {
    this.yaw = yaw; this.pitch = 0; this.landDip = 0; this.landVel = 0; this.roll = 0;
  }

  /** `pos` is the interpolated feet position. */
  update(dt: number, player: PlayerController, pos: THREE.Vector3, inp: PlayerInput) {
    const m = this.motion;
    const body = player.body;
    const hs = player.horizontalSpeed;
    const kRate = (r: number) => 1 - Math.exp(-r * dt);

    // Eye height follows collider height smoothly (slide crouch).
    const targetEye = body.height - 0.15;
    this.eyeHeight += (targetEye - this.eyeHeight) * kRate(12);

    // Head bob while running on the ground.
    const onFoot = body.grounded && player.state === 'move';
    const targetBob = onFoot ? Math.min(hs / 10, 1) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * kRate(8);
    if (onFoot) this.bobPhase += dt * (4 + hs * 0.95);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.05 * this.bobAmount * m - 0.025 * this.bobAmount * m;
    const bobX = Math.cos(this.bobPhase) * 0.03 * this.bobAmount * m;

    // Landing impact: a damped spring pulling the eye down then back up.
    this.landVel += (-this.landDip * 160 - this.landVel * 16) * dt;
    this.landDip += this.landVel * dt;

    // Roll: strafe lean, wall-run tilt, slide lean.
    let targetRoll = -inp.right * 0.022;
    if (player.state === 'wallrun') targetRoll = -player.parkour.wallSide * 0.2;
    else if (player.state === 'slide') targetRoll = 0.05;
    this.roll += (targetRoll * m - this.roll) * kRate(8);

    // FOV widens with speed.
    const speedFactor = THREE.MathUtils.clamp((hs - 6) / 6, 0, 1);
    const targetFov = BASE_FOV + speedFactor * 12 * (0.5 + 0.5 * m) + (player.state === 'slide' ? 4 : 0);
    this.fov += (targetFov - this.fov) * kRate(5);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Vault / mantle: brief pitch dip.
    let pitchOffset = 0;
    if (player.state === 'traverse') {
      const t = player.parkour.traverseProgress;
      pitchOffset = -Math.sin(t * Math.PI) * (player.parkour.travKind === 'vault' ? 0.18 : 0.12) * m;
    }
    this.jumpKick = Math.max(0, this.jumpKick - dt * 5);
    pitchOffset += Math.sin(this.jumpKick * Math.PI) * 0.025 * m;

    const right = player.right;
    this.camera.position.set(
      pos.x + right.x * bobX,
      pos.y + this.eyeHeight + bobY + this.landDip * 0.12,
      pos.z + right.z * bobX,
    );
    this.camera.rotation.set(this.pitch + pitchOffset, this.yaw, this.roll, 'YXZ');

    this.hands.update(dt, player, this.bobPhase, this.bobAmount);
  }
}
