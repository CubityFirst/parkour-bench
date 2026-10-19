import { BoxGeometry, Group, Mesh, PerspectiveCamera } from 'three';
import { materials } from '../world/Assets';
import { MOVE } from './MoveConfig';
import { PlayerController } from './PlayerController';

const BASE_FOV = 72;

/**
 * Camera feedback: head bob, landing dip, takeoff lift, strafe and wall-run roll,
 * speed-based FOV, and a brief arm sweep during vaults. `reduceMotion` scales all of it down.
 */
export class FirstPersonCamera {
  readonly camera = new PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 900);
  private readonly arms = new Group();
  private eyeHeight = MOVE.standHeight * 0.9;
  private bobPhase = 0;
  private bobAmount = 0;
  private landDip = 0;
  private takeoffLift = 0;
  private roll = 0;
  private fov = BASE_FOV;

  constructor() {
    const armGeometry = new BoxGeometry(0.13, 0.13, 0.5);
    for (const side of [-1, 1]) {
      const arm = new Mesh(armGeometry, materials.arm);
      arm.position.set(side * 0.24, -0.42, -0.5);
      this.arms.add(arm);
    }
    this.arms.visible = false;
    this.camera.add(this.arms);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  addImpulse(strength: number): void {
    this.landDip = Math.max(this.landDip, strength * 0.12);
  }

  addTakeoff(): void {
    this.takeoffLift = 1;
  }

  update(dt: number, player: PlayerController, reduceMotion: boolean): void {
    const k = reduceMotion ? 0.3 : 1;
    const speed = player.horizontalSpeed;
    const parkour = player.parkour;
    const climbing = parkour.isClimbing;
    const climbArc = climbing ? Math.sin(Math.PI * parkour.climbProgress) : 0;

    // Eye height follows crouching smoothly
    const targetEye = player.height * 0.9;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 14);

    // Head bob: ground movement only, scaled by speed
    const moving = player.grounded && !player.sliding && !climbing && speed > 1;
    this.bobAmount += ((moving ? Math.min(speed / 12, 1) : 0) - this.bobAmount) * Math.min(1, dt * 6);
    this.bobPhase += dt * speed * 3.2;
    const bobY = Math.sin(this.bobPhase * 2) * 0.03 * this.bobAmount * k;
    const bobX = Math.cos(this.bobPhase) * 0.02 * this.bobAmount * k;

    this.landDip *= Math.exp(-dt * 9);
    this.takeoffLift *= Math.exp(-dt * 8);

    // Lean into strafing, and into a wall run
    const right = player.right();
    const strafe = Math.max(-1, Math.min(1,
      (player.velocity.x * right.x + player.velocity.z * right.z) / MOVE.sprintSpeed));
    let rollTarget = -strafe * 0.025 * k;
    if (parkour.wallRunning) rollTarget -= parkour.wallSide * 0.14 * k;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 8);

    // Widen FOV at high speed
    const fovTarget = BASE_FOV + Math.min(1, Math.max(0, (speed - 8) / 5)) * 12 * (reduceMotion ? 0.5 : 1);
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Vault / mantle: arms sweep forward and the camera dips briefly
    this.arms.visible = climbing;
    this.arms.position.set(0, -climbArc * 0.12, -climbArc * 0.2);

    this.camera.position.set(
      player.position.x + bobX,
      player.position.y + this.eyeHeight + bobY - this.landDip - climbArc * 0.05 * k,
      player.position.z,
    );
    const pitch = player.pitch + this.takeoffLift * 0.025 * k - climbArc * 0.06 * k;
    this.camera.rotation.set(pitch, player.yaw, this.roll, 'YXZ');
  }
}
