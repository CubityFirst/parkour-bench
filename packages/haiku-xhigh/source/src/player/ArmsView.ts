import * as THREE from 'three';
import { PlayerController } from './PlayerController';

/**
 * Stylised forearms in the lower corners of the view. They sway with sprint and
 * reach forward during vaults and mantles. They sit low and small so they never block the route.
 */
export class ArmsView {
  readonly group = new THREE.Group();
  private readonly arms: THREE.Mesh[] = [];
  private readonly restPose = { y: -0.3, z: -0.42, rotX: 0.15 };
  private readonly reachPose = { y: -0.14, z: -0.58, rotX: -0.35 };
  private reach = 0;
  private swayPhase = 0;

  constructor(camera: THREE.Camera) {
    const material = new THREE.MeshStandardMaterial({ color: 0xf3f5f7, roughness: 0.8, metalness: 0 });
    const forearm = new THREE.BoxGeometry(0.12, 0.12, 0.4);
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(forearm, material);
      mesh.position.x = side * 0.2;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.arms.push(mesh);
      this.group.add(mesh);
    }
    camera.add(this.group);
  }

  update(dt: number, ctl: PlayerController): void {
    const acting = ctl.mode === 'vault' || ctl.mode === 'mantle';
    this.reach += ((acting ? 1 : 0) - this.reach) * Math.min(1, dt * 10);
    this.swayPhase += dt * ctl.speed * 0.9;

    const sprintSway = Math.sin(this.swayPhase) * Math.min(1, ctl.speed / 11) * 0.018;
    const t = this.reach;
    const y = lerp(this.restPose.y, this.reachPose.y, t) + sprintSway;
    const z = lerp(this.restPose.z, this.reachPose.z, t);
    const rotX = lerp(this.restPose.rotX, this.reachPose.rotX, t);

    this.group.position.set(0, y, z);
    this.group.rotation.x = rotX;
    this.arms[0].position.y = sprintSway * -0.5;
    this.arms[1].position.y = sprintSway * 0.5;
  }

  dispose(): void {
    for (const mesh of this.arms) mesh.geometry.dispose();
    (this.arms[0].material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
