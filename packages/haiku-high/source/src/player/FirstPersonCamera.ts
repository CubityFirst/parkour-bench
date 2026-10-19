import * as THREE from 'three';
import { Input } from '../input/Input';
import { PlayerController } from './PlayerController';

const BASE_FOV = 72;
const MAX_SPEED_FOV = 12;
const SLIDE_FOV = 4;
/** Multiplier applied to every camera motion effect when "reduce camera motion" is on. */
const REDUCED_SCALE = 0.25;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** Frame-rate independent exponential approach. */
const approach = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * Presents the player's collision body as a first-person camera and layers on the
 * feel effects: speed FOV, head bob, strafe roll, wall tilt, landing impact,
 * jump kick and the vault dip. Runs once per rendered frame.
 */
export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  reduceMotion = false;

  private eyeHeight = 1.6;
  private fov = BASE_FOV;
  private bobPhase = 0;
  private bobStrength = 0;
  private strafeRoll = 0;
  private wallRoll = 0;
  private landingDip = 0;
  private jumpKick = 0;
  private climbLift = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Snap to the player's current pose, e.g. after a respawn or when a run starts. */
  snap(player: PlayerController): void {
    this.eyeHeight = player.eyeHeight;
    this.landingDip = 0;
    this.jumpKick = 0;
    this.climbLift = 0;
    this.strafeRoll = 0;
    this.wallRoll = 0;
    this.placeCamera(player);
  }

  onLand(strength: number): void {
    // Dip proportional to the fall. Small falls barely register.
    this.landingDip = Math.max(this.landingDip, 0.12 * strength);
  }

  onJump(): void {
    this.jumpKick = 0.04;
  }

  update(dt: number, player: PlayerController, input: Input): void {
    const body = player.body;
    const motion = this.reduceMotion ? REDUCED_SCALE : 1;

    // Crouch height eases in, so sliding does not snap the view.
    this.eyeHeight = approach(this.eyeHeight, player.eyeHeight, 14, dt);

    // Speed-based FOV: a little wider as the player gets faster, and while sliding.
    const speedFactor = clamp01((player.horizontalSpeed - 6) / 8);
    const targetFov = BASE_FOV + MAX_SPEED_FOV * speedFactor * motion + (player.state === 'slide' ? SLIDE_FOV * motion : 0);
    this.fov = approach(this.fov, targetFov, 6, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Head bob while running on the ground, scaled by speed. Gentle by design.
    const moving = body.grounded && player.state !== 'slide' && player.horizontalSpeed > 1;
    const bobTarget = moving ? Math.min(0.045, player.horizontalSpeed * 0.0035) * motion : 0;
    this.bobStrength = approach(this.bobStrength, bobTarget, 8, dt);
    if (moving) this.bobPhase += dt * (player.horizontalSpeed * 1.1 + 2);

    // Strafe roll: lean slightly into lateral movement.
    const strafeIn = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    this.strafeRoll = approach(this.strafeRoll, -strafeIn * 0.02 * motion, 8, dt);

    // Wall-run tilt toward the wall; zero otherwise.
    const wallTarget = player.wallSide === 0 ? 0 : -player.wallSide * 0.12 * motion;
    this.wallRoll = approach(this.wallRoll, wallTarget, 6, dt);

    // Impacts decay back to zero.
    this.landingDip = approach(this.landingDip, 0, 9, dt);
    this.jumpKick = approach(this.jumpKick, 0, 10, dt);

    // Vault: a brief arc of the camera over the obstacle.
    const climb = player.climbProgress;
    const climbTarget = climb >= 0 && player.climbKind === 'vault' ? Math.sin(Math.PI * climb) * 0.16 * motion : 0;
    this.climbLift = approach(this.climbLift, climbTarget, 20, dt);

    this.placeCamera(player);
  }

  private placeCamera(player: PlayerController): void {
    const body = player.body;
    const cam = this.camera;

    const bobY = Math.sin(this.bobPhase * 2) * this.bobStrength;
    const bobX = Math.sin(this.bobPhase) * this.bobStrength * 0.5;
    const yOffset = bobY - this.landingDip + this.jumpKick + this.climbLift;

    // Local right vector for the head-bob sideways sway.
    const rightX = player.rightX;
    const rightZ = player.rightZ;

    cam.position.set(
      body.x + rightX * bobX,
      body.y + this.eyeHeight + yOffset,
      body.z + rightZ * bobX,
    );

    cam.rotation.set(player.pitch, player.yaw, this.strafeRoll + this.wallRoll, 'YXZ');
  }
}
