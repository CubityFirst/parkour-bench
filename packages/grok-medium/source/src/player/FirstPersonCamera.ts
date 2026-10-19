import * as THREE from 'three';
import { clamp, damp, PHYS } from './constants';
import type { PlayerController } from './PlayerController';

const BASE_FOV = 74;

/** Camera is a child of the player's view so roll and bob cannot steer movement. */
export class FirstPersonCamera {
  readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 900);
  bobPhase = 0;
  private roll = 0;
  private fov = BASE_FOV;
  private dip = 0;
  private extraPitch = 0;
  private lastTeleport = -1;

  constructor(view: THREE.Object3D) {
    this.camera.rotation.order = 'YXZ';
    view.add(this.camera);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  kick(impact: number, motion: number): void {
    if (impact > 3.2) this.dip = Math.min(0.1, impact * 0.0065) * motion;
  }

  update(dt: number, player: PlayerController, motion: number): void {
    if (player.teleportTick !== this.lastTeleport) {
      this.dip = 0;
      this.extraPitch = 0;
      this.roll = 0;
      this.lastTeleport = player.teleportTick;
    }

    const eye = PHYS.eyeStand + (PHYS.eyeSlide - PHYS.eyeStand) * player.crouch;
    player.view.position.set(player.x, player.y + eye, player.z);

    const speed = player.speed;
    const stepping = player.grounded && !player.sliding && speed > 2.1 && !player.actionKind;
    if (stepping) this.bobPhase += dt * (speed > 8.2 ? 10.8 : 7.8);
    const amp = (stepping ? Math.min(0.042, 0.012 + speed * 0.0024) : 0) * motion;
    const bobY = Math.sin(this.bobPhase * 2) * amp;
    const bobX = Math.cos(this.bobPhase) * amp * 0.5;

    const b = player.basis();
    const lateral = player.vx * b.rx + player.vz * b.rz;
    // wallSide +1 means the wall is on the player's right; roll toward it.
    const targetRoll = (-player.wallSide * 0.24 + clamp(-lateral * 0.01, -0.045, 0.045)) * motion;
    this.roll = damp(this.roll, targetRoll, 8, dt);

    const vaultPitch = player.actionKind === 'vault' ? -0.07 : player.actionKind === 'mantle' ? -0.1 : 0;
    const slidePitch = player.sliding ? 0.075 : 0;
    this.extraPitch = damp(this.extraPitch, (vaultPitch + slidePitch) * motion, 8, dt);
    this.dip = damp(this.dip, 0, 7, dt);

    this.camera.position.set(bobX, bobY - this.dip, 0);
    this.camera.rotation.x = this.extraPitch;
    this.camera.rotation.z = this.roll;

    const extraFov = clamp(speed / PHYS.sprint, 0, 1.15) * 12 * motion;
    const targetFov = BASE_FOV + extraFov + (player.sliding ? 2.5 * motion : 0);
    this.fov = damp(this.fov, targetFov, 4.2, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.02) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
