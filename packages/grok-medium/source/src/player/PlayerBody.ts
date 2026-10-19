import * as THREE from 'three';
import type { PlayerController } from './PlayerController';

/** Low-poly sleeves, gloves, and shoes. Hands live in view space; shoes stay on the yaw. */
export class PlayerBody {
  private readonly hands = new THREE.Group();
  private readonly left: THREE.Group;
  private readonly right: THREE.Group;
  private readonly shoes = new THREE.Group();
  private readonly leftShoe: THREE.Group;
  private readonly rightShoe: THREE.Group;

  constructor(camera: THREE.Camera, scene: THREE.Scene) {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xf4f7f8, roughness: 0.72 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.55 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xd01218, roughness: 0.45, emissive: 0x4a0004, emissiveIntensity: 0.3 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 });

    this.left = makeArm(-1, sleeve, glove, stripe);
    this.right = makeArm(1, sleeve, glove, stripe);
    this.hands.add(this.left, this.right);
    camera.add(this.hands);

    this.leftShoe = makeShoe(-1, shoe, stripe);
    this.rightShoe = makeShoe(1, shoe, stripe);
    this.shoes.add(this.leftShoe, this.rightShoe);
    scene.add(this.shoes);
  }

  update(player: PlayerController, bobPhase: number): void {
    const swing = player.grounded && !player.sliding ? Math.sin(bobPhase) * (player.speed > 8 ? 0.55 : 0.28) : 0;
    const vault = player.actionKind === 'vault' || player.actionKind === 'mantle';
    this.left.rotation.x = vault ? -1.15 : swing;
    this.right.rotation.x = vault ? -1.15 : -swing;
    this.left.rotation.z = player.wallSide < 0 ? 0.7 : 0;
    this.right.rotation.z = player.wallSide > 0 ? -0.7 : 0;
    this.left.position.y = -0.34 + (player.sliding ? 0.06 : 0);
    this.right.position.y = -0.34 + (player.sliding ? 0.06 : 0);

    this.shoes.position.set(player.x, player.y, player.z);
    this.shoes.rotation.set(0, player.yaw, 0);
    const step = player.grounded && !player.sliding ? Math.sin(bobPhase) * 0.18 : 0;
    this.leftShoe.position.z = -0.16 + step * 0.2;
    this.rightShoe.position.z = -0.16 - step * 0.2;
    this.leftShoe.rotation.x = step;
    this.rightShoe.rotation.x = -step;
    this.shoes.visible = player.pitch < -0.35 || player.sliding;
  }
}

function makeArm(
  side: number,
  sleeveMat: THREE.Material,
  gloveMat: THREE.Material,
  stripeMat: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.26), sleeveMat);
  sleeve.position.set(0, 0, -0.02);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.03, 0.04), stripeMat);
  band.position.set(0, 0, -0.1);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.055, 0.09), gloveMat);
  hand.position.set(0, -0.01, -0.2);
  g.add(sleeve, band, hand);
  g.position.set(side * 0.26, -0.34, -0.46);
  return g;
}

function makeShoe(side: number, shoeMat: THREE.Material, stripeMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.26), shoeMat);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.02, 0.07), stripeMat);
  mark.position.set(0, 0.02, -0.06);
  g.add(sole, mark);
  g.position.set(side * 0.12, 0.06, -0.16);
  return g;
}
