import * as THREE from 'three';
import { PlayerController } from './PlayerController';
import { Input } from './Input';

export class FirstPersonCamera {
  reducedMotion = localStorage.getItem('upshift-motion') === 'reduced';
  private eyeHeight = 1.66;
  private bobTime = 0;
  private impact = 0;
  private smoothYaw = 0;
  private smoothPitch = 0;
  private arms = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private legs = new THREE.Group();
  constructor(readonly camera: THREE.PerspectiveCamera, readonly player: PlayerController, readonly input: Input) {
    camera.rotation.order = 'YXZ';
    const white = new THREE.MeshStandardMaterial({ color: '#eef0e7', roughness: 0.85 });
    const red = new THREE.MeshStandardMaterial({ color: '#d92e26', roughness: 0.65 });
    const skin = new THREE.MeshStandardMaterial({ color: '#ba876c', roughness: 0.8 });
    const black = new THREE.MeshStandardMaterial({ color: '#172b32', roughness: 0.9 });
    for (const [group, side] of [[this.leftArm, -1], [this.rightArm, 1]] as const) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.46, 7), white);
      sleeve.rotation.x = Math.PI / 2; sleeve.position.z = 0.17; group.add(sleeve);
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.2), side === -1 ? red : black);
      glove.position.z = -0.1; group.add(glove);
      const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.075, 0.08), skin);
      fingers.position.set(0, 0.01, -0.22); group.add(fingers);
      group.position.set(side * 0.31, -0.42, -0.4); this.arms.add(group);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 0.22), white);
      leg.position.set(side * 0.17, -0.65, -0.65); leg.rotation.x = -0.3; this.legs.add(leg);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.13, 0.34), black);
      shoe.position.set(side * 0.17, -0.93, -0.85); this.legs.add(shoe);
      const shoeStripe = new THREE.Mesh(new THREE.BoxGeometry(0.195, 0.04, 0.32), red);
      shoeStripe.position.set(side * 0.17, -0.89, -0.85); this.legs.add(shoeStripe);
    }
    camera.add(this.arms, this.legs);
    this.setVisible(false);
  }
  setVisible(visible: boolean) { this.arms.visible = visible; this.legs.visible = false; }
  land(strength = 0.5) { this.impact = strength * 0.15; }
  reset() { this.smoothYaw = this.input.yaw; this.smoothPitch = this.input.pitch; this.eyeHeight = 1.66; this.impact = 0; }
  update(dt: number) {
    const p = this.player, speed = p.speed;
    const gain = 1 - Math.exp(-18 * dt);
    this.smoothYaw = THREE.MathUtils.lerp(this.smoothYaw, this.input.yaw, 1 - Math.exp(-36 * dt));
    this.smoothPitch = THREE.MathUtils.lerp(this.smoothPitch, this.input.pitch, 1 - Math.exp(-36 * dt));
    this.eyeHeight = THREE.MathUtils.lerp(this.eyeHeight, p.height - 0.14, gain);
    this.bobTime += dt * (speed > 9 ? 13 : 10);
    const motion = this.reducedMotion ? 0 : 1;
    const bob = p.grounded && speed > 0.5 && !p.slideTime ? Math.sin(this.bobTime) * 0.024 * Math.min(1, speed / 7) * motion : 0;
    this.impact *= Math.exp(-11 * dt);
    this.camera.position.copy(p.position); this.camera.position.y += this.eyeHeight + bob - this.impact * motion;
    const roll = p.wall ? p.wallSide * 0.095 : -p.velocity.x * Math.cos(this.input.yaw) * 0.002;
    this.camera.rotation.set(this.smoothPitch, this.smoothYaw, THREE.MathUtils.lerp(this.camera.rotation.z, roll * motion, gain), 'YXZ');
    const fov = 78 + Math.max(0, speed - 6) * (this.reducedMotion ? 0.35 : 1.35);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, gain); this.camera.updateProjectionMatrix();
    const swinging = p.grounded && speed > 4 && !p.slideTime;
    this.arms.visible = true;
    for (const [arm, side] of [[this.leftArm, -1], [this.rightArm, 1]] as const) {
      const swing = swinging ? Math.sin(this.bobTime / 2 + (side > 0 ? Math.PI : 0)) * 0.065 : 0;
      const lift = p.vault ? 0.17 : p.wall && side === p.wallSide ? 0.13 : 0;
      arm.position.y = (speed > 4 ? -0.46 : -0.6) + swing * motion + lift;
      arm.position.z = -0.55 - swing * motion - lift;
      arm.rotation.set(-0.1 + swing, side * -0.2, side * 0.12);
    }
    this.legs.visible = p.slideTime > 0;
  }
}
