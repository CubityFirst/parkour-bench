import * as THREE from 'three';
import type { PlayerController } from './PlayerController';

/** Simple sleeves, gloves, and shoes. They stay out of the center of the view. */
export class PlayerView {
  readonly hands = new THREE.Group();
  private readonly left: THREE.Group;
  private readonly right: THREE.Group;
  private readonly legs = new THREE.Group();
  private readonly leftLeg: THREE.Group;
  private readonly rightLeg: THREE.Group;

  constructor(camera: THREE.Camera, scene: THREE.Scene) {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xd7dee6, roughness: 0.72 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.55 });
    const band = new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.4, emissive: 0x5a0c08, emissiveIntensity: 0.3 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.5 });
    this.left = this.makeArm(sleeve, glove, band);
    this.right = this.makeArm(sleeve, glove, band);
    this.left.position.set(-0.36, -0.16, -0.52);
    this.right.position.set(0.36, -0.16, -0.52);
    this.hands.add(this.left, this.right);
    camera.add(this.hands);

    this.leftLeg = this.makeLeg(sleeve, shoe, band);
    this.rightLeg = this.makeLeg(sleeve, shoe, band);
    this.legs.add(this.leftLeg, this.rightLeg);
    scene.add(this.legs);
  }

  setVisible(visible: boolean): void {
    this.hands.visible = visible;
    this.legs.visible = visible;
  }

  update(player: PlayerController, fx: number, fz: number, rx: number, rz: number): void {
    const swing = Math.sin(player.stepCycle) * Math.min(1, player.horizontalSpeed / 8);
    const tuck = player.state === 'slide' ? 0.8 : 0;
    this.left.rotation.x = 0.18 + swing * 0.4 + tuck * 0.7;
    this.right.rotation.x = 0.18 - swing * 0.4 + tuck * 0.7;
    if (player.state === 'vault' || player.state === 'mantle') {
      this.left.rotation.x = -0.9;
      this.right.rotation.x = -0.9;
    } else if (player.state === 'wallrun') {
      const side = rx * player.wallNx + rz * player.wallNz;
      if (side > 0) this.left.rotation.z = 0.5;
      else this.right.rotation.z = -0.5;
    } else {
      this.left.rotation.z = 0;
      this.right.rotation.z = 0;
    }

    const stride = Math.sin(player.stepCycle);
    this.placeLeg(this.leftLeg, player, fx, fz, rx, rz, -1, stride);
    this.placeLeg(this.rightLeg, player, fx, fz, rx, rz, 1, -stride);
  }

  private placeLeg(
    leg: THREE.Group,
    player: PlayerController,
    fx: number,
    fz: number,
    rx: number,
    rz: number,
    side: number,
    stride: number,
  ): void {
    const reach = player.state === 'slide' ? 0.42 : 0.22;
    leg.position.set(
      player.x + fx * reach + rx * side * 0.12,
      player.y + (player.state === 'slide' ? 0.08 : 0),
      player.z + fz * reach + rz * side * 0.12,
    );
    leg.rotation.order = 'YXZ';
    leg.rotation.y = Math.atan2(fx, fz);
    leg.rotation.x = stride * 0.4;
  }

  private makeArm(
    sleeve: THREE.Material,
    glove: THREE.Material,
    band: THREE.Material,
  ): THREE.Group {
    const group = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.08), sleeve);
    upper.position.y = -0.1;
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.18, 0.07), sleeve);
    fore.position.set(0, -0.26, -0.02);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.028, 0.082), band);
    stripe.position.y = -0.2;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.08, 0.08), glove);
    hand.position.set(0, -0.38, -0.03);
    group.add(upper, fore, stripe, hand);
    return group;
  }

  private makeLeg(cloth: THREE.Material, shoeMat: THREE.Material, band: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.1), cloth);
    thigh.position.y = 0.72;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.09), cloth);
    shin.position.y = 0.36;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.2), shoeMat);
    shoe.position.set(0, 0.05, 0.04);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.025, 0.08), band);
    stripe.position.set(0, 0.07, 0.08);
    group.add(thigh, shin, shoe, stripe);
    return group;
  }
}
