import * as THREE from 'three';
import { PLAYER } from '../game/Config';
import { PlayerController } from './PlayerController';

/**
 * A very simple low-poly player body: two forearms that appear at the bottom
 * of the screen. They react to sprinting, sliding, wall running and vaulting.
 * Deliberately tiny so they never obstruct the view.
 */
export class PlayerBody {
  readonly group = new THREE.Group();
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private swing = 0;
  private vaultRaise = 0;
  private wallReach = 0;

  constructor(palette: { white: THREE.Material; dark: THREE.Material; red: THREE.Material }) {
    const geometry = new THREE.BoxGeometry(0.062, 0.26, 0.072);
    const handGeometry = new THREE.BoxGeometry(0.072, 0.095, 0.088);

    const makeArm = (side: -1 | 1): THREE.Group => {
      const arm = new THREE.Group();
      const forearm = new THREE.Mesh(geometry, palette.white);
      forearm.position.set(0, -0.13, 0);
      forearm.castShadow = false;
      const hand = new THREE.Mesh(handGeometry, palette.dark);
      hand.position.set(0, -0.28, 0.012);
      arm.add(forearm, hand);
      arm.position.set(side * 0.29, -0.30, -0.46);
      arm.rotation.set(-0.62, 0, -side * 0.34);
      return arm;
    };

    this.leftArm = makeArm(-1);
    this.rightArm = makeArm(1);
    this.group.add(this.leftArm, this.rightArm);
    this.group.renderOrder = 5;
  }

  update(dt: number, player: PlayerController): void {
    const speedRatio = Math.min(1, player.speed / PLAYER.sprintSpeed);

    // Sprinting pumps the arms.
    if (player.grounded && speedRatio > 0.35) {
      this.swing += dt * (4 + speedRatio * 6);
    } else {
      this.swing += dt * 1.2;
    }
    const swingAmount = Math.sin(this.swing) * 0.35 * speedRatio;

    if (player.isScripted) this.vaultRaise = Math.min(1, this.vaultRaise + dt * 6);
    else this.vaultRaise = Math.max(0, this.vaultRaise - dt * 4);

    if (player.isWallRunning) this.wallReach = Math.min(1, this.wallReach + dt * 6);
    else this.wallReach = Math.max(0, this.wallReach - dt * 4);

    const baseY = -0.30;
    const baseZ = -0.46;

    // left arm
    this.leftArm.position.set(
      -0.29,
      baseY + this.vaultRaise * 0.20 - this.wallReach * 0.05,
      baseZ + swingAmount * 0.06,
    );
    this.leftArm.rotation.set(
      -0.62 - swingAmount - this.vaultRaise * 0.85 + this.wallReach * 0.3,
      0,
      -0.34 + this.wallReach * 0.25,
    );

    // right arm
    this.rightArm.position.set(
      0.29,
      baseY + this.vaultRaise * 0.20 - this.wallReach * 0.05,
      baseZ - swingAmount * 0.06,
    );
    this.rightArm.rotation.set(
      -0.62 + swingAmount - this.vaultRaise * 0.85 - this.wallReach * 0.3,
      0,
      0.34 - this.wallReach * 0.25,
    );

    // Hide the arms while sliding — the body is low and the arms would clip.
    const visibility = player.sliding ? 0.25 : 1;
    this.leftArm.scale.setScalar(visibility);
    this.rightArm.scale.setScalar(visibility);
  }
}
