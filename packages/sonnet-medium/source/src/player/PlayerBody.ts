import * as THREE from 'three';
import { MOVE, PlayerController } from './PlayerController';

/**
 * Minimal first-person body: two low-poly arms riding on the camera (pumping while sprinting,
 * reaching during vaults/mantles, braced against the wall) and two legs that follow the player's
 * feet so they appear when looking down. Arms render on top of the world so they never clip the view.
 */
export class PlayerBody {
  readonly arms = new THREE.Group();
  readonly legs = new THREE.Group();
  private armL: THREE.Group;
  private armR: THREE.Group;
  private footL: THREE.Group;
  private footR: THREE.Group;
  private weight = 0;
  private reach = 0;
  private slide = 0;
  private wallL = 0;
  private wallR = 0;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor() {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.9, depthTest: false, depthWrite: false });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8b99a, roughness: 0.8, depthTest: false, depthWrite: false });
    const glove = new THREE.MeshStandardMaterial({ color: 0xc81f1a, roughness: 0.8, depthTest: false, depthWrite: false });
    const shoeWhite = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.8 });
    const shoeRed = new THREE.MeshStandardMaterial({ color: 0xd9201b, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.9 });
    this.mats.push(sleeve, skin, glove, shoeWhite, shoeRed, pants);

    const box = (w: number, h: number, d: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      this.geos.push(g);
      return g;
    };

    const makeArm = (side: number): THREE.Group => {
      const g = new THREE.Group();
      const fore = new THREE.Mesh(box(0.1, 0.1, 0.42), sleeve);
      fore.position.z = -0.21;
      const wrist = new THREE.Mesh(box(0.085, 0.085, 0.07), skin);
      wrist.position.z = -0.45;
      const hand = new THREE.Mesh(box(0.11, 0.05, 0.13), side < 0 ? skin : skin);
      hand.position.z = -0.53;
      const band = new THREE.Mesh(box(0.105, 0.105, 0.04), glove);
      band.position.z = -0.4;
      g.add(fore, band, wrist, hand);
      g.traverse((o) => { o.renderOrder = 20; });
      return g;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);
    this.arms.add(this.armL, this.armR);

    const makeFoot = (): THREE.Group => {
      const g = new THREE.Group();
      const shoe = new THREE.Mesh(box(0.13, 0.1, 0.32), shoeWhite);
      shoe.position.set(0, 0.06, -0.06);
      const sole = new THREE.Mesh(box(0.14, 0.035, 0.33), shoeRed);
      sole.position.set(0, 0.0175, -0.06);
      const shin = new THREE.Mesh(box(0.13, 0.55, 0.15), pants);
      shin.position.set(0, 0.4, 0.04);
      g.add(shoe, sole, shin);
      return g;
    };
    this.footL = makeFoot();
    this.footR = makeFoot();
    this.footL.position.x = -0.13;
    this.footR.position.x = 0.13;
    this.legs.add(this.footL, this.footR);
  }

  update(dt: number, pc: PlayerController, alpha: number, yaw: number): void {
    const p = pc.phys;
    const speed = pc.speed;
    const k = (r: number) => 1 - Math.exp(-r * dt);

    // --- arm pose blending
    const sprintW = pc.mode === 'ground' && pc.sprinting ? Math.min(1, speed / MOVE.sprintSpeed) : 0;
    const airW = pc.mode === 'air' ? 0.35 : 0;
    const scriptW = pc.mode === 'script' ? 1 : 0;
    const targetWeight = Math.max(sprintW * 0.8, airW, scriptW, pc.mode === 'wallrun' ? 0.9 : 0);
    this.weight += (targetWeight - this.weight) * k(10);
    this.reach += (scriptW - this.reach) * k(14);
    this.slide += ((pc.mode === 'slide' ? 1 : 0) - this.slide) * k(10);
    this.wallL += ((pc.wallSide < 0 ? 1 : 0) - this.wallL) * k(14);
    this.wallR += ((pc.wallSide > 0 ? 1 : 0) - this.wallR) * k(14);

    const t = pc.bobPhase;
    const pump = Math.sin(t) * 0.55 * sprintW;
    // hidden pose is below the frame; visible pose sits low-left/right
    const baseY = -0.62 + this.weight * 0.3 + this.reach * 0.12;
    const baseZ = -0.25 - this.reach * 0.12;

    const pose = (arm: THREE.Group, side: number, swing: number, wall: number) => {
      const x = side * (0.27 + wall * 0.32 + this.reach * 0.02);
      arm.position.set(x, baseY + swing * 0.04 - wall * 0.05, baseZ + swing * -0.1);
      arm.rotation.set(
        -0.35 - this.reach * 0.75 + swing * 0.45 + this.slide * 0.2,
        side * (-0.1 - wall * 0.9),
        side * (0.05 + wall * 0.15),
      );
    };
    pose(this.armL, -1, pump, this.wallL);
    pose(this.armR, 1, -pump, this.wallR);

    // --- legs: follow the feet (interpolated), face the camera yaw
    const x = pc.prev[0] + (p.p[0] - pc.prev[0]) * alpha;
    const y = pc.prev[1] + (p.p[1] - pc.prev[1]) * alpha;
    const z = pc.prev[2] + (p.p[2] - pc.prev[2]) * alpha;
    this.legs.position.set(x, y, z);
    this.legs.rotation.y = yaw;
    const swing = Math.sin(t) * 0.28 * (pc.mode === 'ground' ? Math.min(1, speed / MOVE.sprintSpeed) : 0);
    const tuck = pc.mode === 'air' ? 0.18 : 0;
    const slideFwd = this.slide * 0.55;
    // slide: legs stretch forward, low; otherwise alternating stride
    const setFoot = (f: THREE.Group, s: number) => {
      f.position.z = -s * 0.9 - slideFwd - tuck * 0.5;
      f.position.y = Math.max(0, s) * 0.14 + tuck + this.slide * 0.18;
      f.rotation.x = this.slide * 1.1;
      f.visible = pc.mode !== 'script';
    };
    setFoot(this.footL, swing / 0.28 * 0.3);
    setFoot(this.footR, -swing / 0.28 * 0.3);
  }

  attach(camera: THREE.Camera, scene: THREE.Scene): void {
    camera.add(this.arms);
    scene.add(this.legs);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
