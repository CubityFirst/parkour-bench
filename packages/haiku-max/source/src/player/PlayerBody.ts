import * as THREE from 'three';
import { MOVE } from './MovementConfig';
import type { PlayerController } from './PlayerController';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Where each shoulder rests relative to the camera. Kept low and wide so the view stays clear. */
const REST = { x: 0.27, y: -0.42, z: -0.32 };

/**
 * Low-poly arms parented to the camera. They sit in the lower corners of the view, out of
 * the way of the crosshair, and sway while sprinting and reach forward during vaults.
 */
export class PlayerBody {
  readonly group = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private swing = 0;
  private reach = 0;
  private phase = 0;

  constructor(camera: THREE.Object3D) {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.75, metalness: 0 });
    const hand = new THREE.MeshStandardMaterial({ color: 0xf4efe8, roughness: 0.7, metalness: 0 });
    const forearmGeometry = new THREE.CylinderGeometry(0.042, 0.052, 0.36, 10);
    const handGeometry = new THREE.SphereGeometry(0.06, 12, 8);

    for (const [arm, side] of [
      [this.rightArm, 1],
      [this.leftArm, -1],
    ] as const) {
      const forearm = new THREE.Mesh(forearmGeometry, sleeve);
      // Lay the forearm along the view direction, tipped up a little.
      forearm.rotation.x = -Math.PI / 2 + 0.25;
      forearm.position.set(0, 0.04, -0.18);

      const knuckles = new THREE.Mesh(handGeometry, hand);
      knuckles.position.set(0, 0.08, -0.37);

      arm.add(forearm, knuckles);
      arm.position.set(side * REST.x, REST.y, REST.z);
      this.group.add(arm);
    }

    camera.add(this.group);
  }

  update(dt: number, player: PlayerController): void {
    const grounded = player.mode === 'ground';
    const swingTarget = grounded ? Math.min(1, player.speed / MOVE.sprintSpeed) : 0;
    this.swing = lerp(this.swing, swingTarget, Math.min(1, dt * 8));
    this.phase += dt * (grounded ? 1.6 + player.speed * 0.95 : 1.2);

    const reachTarget = player.scriptKind ? Math.sin(Math.PI * player.scriptProgress) : 0;
    this.reach = lerp(this.reach, reachTarget, Math.min(1, dt * 16));

    const stride = Math.sin(this.phase) * 0.035 * this.swing;
    const reachForward = this.reach * 0.14;
    const reachLift = this.reach * 0.1;

    this.rightArm.position.set(REST.x, REST.y + reachLift - stride * 0.5, REST.z - stride - reachForward);
    this.leftArm.position.set(-REST.x, REST.y + reachLift + stride * 0.5, REST.z + stride - reachForward);
    this.rightArm.rotation.x = -this.reach * 0.35;
    this.leftArm.rotation.x = -this.reach * 0.35;
  }
}
