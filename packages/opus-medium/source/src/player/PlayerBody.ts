import {
  BoxGeometry, Group, Mesh, MeshStandardMaterial, type PerspectiveCamera,
} from 'three';
import type { PlayerController } from './PlayerController';

const damp = (c: number, t: number, r: number, dt: number) => c + (t - c) * (1 - Math.exp(-r * dt));

interface Limb {
  root: Group;
  /** Current animated pose */
  x: number; y: number; z: number; rx: number; ry: number; rz: number;
}

/**
 * Minimal low-poly first-person arms and legs, parented to the camera.
 * They stay out of view while walking and appear during sprinting, vaulting,
 * mantling, wall-running and sliding to sell the motion.
 */
export class PlayerBody {
  readonly group = new Group();
  private left: Limb;
  private right: Limb;
  private legs: Group;
  private legL: Mesh;
  private legR: Mesh;
  private legsVisible = 0;
  private time = 0;

  constructor(camera: PerspectiveCamera) {
    const sleeve = new MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.75 });
    const glove = new MeshStandardMaterial({ color: 0xd8232a, roughness: 0.55 });
    const skin = new MeshStandardMaterial({ color: 0xe0b08c, roughness: 0.7 });
    const pants = new MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.8 });
    const shoe = new MeshStandardMaterial({ color: 0xd8232a, roughness: 0.5 });

    const forearmGeo = new BoxGeometry(0.085, 0.085, 0.42);
    forearmGeo.translate(0, 0, -0.21);
    const handGeo = new BoxGeometry(0.1, 0.05, 0.12);
    handGeo.translate(0, 0, -0.48);
    const thumbGeo = new BoxGeometry(0.03, 0.03, 0.06);
    thumbGeo.translate(0.055, 0.01, -0.44);
    const cuffGeo = new BoxGeometry(0.095, 0.095, 0.05);
    cuffGeo.translate(0, 0, -0.41);

    const makeArm = (side: number): Limb => {
      const root = new Group();
      const fore = new Mesh(forearmGeo, sleeve);
      const hand = new Mesh(handGeo, side > 0 ? glove : skin);
      const cuff = new Mesh(cuffGeo, glove);
      const thumb = new Mesh(thumbGeo, side > 0 ? glove : skin);
      thumb.position.x = side > 0 ? -0.11 : 0;
      root.add(fore, hand, cuff, thumb);
      root.visible = false;
      this.group.add(root);
      return { root, x: side * 0.3, y: -0.6, z: 0, rx: 0, ry: 0, rz: 0 };
    };
    this.left = makeArm(-1);
    this.right = makeArm(1);

    // Legs for slides: extend forward from below the camera.
    this.legs = new Group();
    const legGeo = new BoxGeometry(0.15, 0.15, 0.85);
    legGeo.translate(0, 0, -0.42);
    const shoeGeo = new BoxGeometry(0.14, 0.18, 0.26);
    shoeGeo.translate(0, 0.03, -0.9);
    this.legL = new Mesh(legGeo, pants);
    this.legR = new Mesh(legGeo, pants);
    this.legL.add(new Mesh(shoeGeo, shoe));
    this.legR.add(new Mesh(shoeGeo, shoe));
    this.legL.position.set(-0.13, 0, 0);
    this.legR.position.set(0.13, 0, 0);
    this.legs.add(this.legL, this.legR);
    this.legs.visible = false;
    this.group.add(this.legs);

    this.group.traverse((o) => { o.frustumCulled = false; o.renderOrder = 10; });
    camera.add(this.group);
  }

  update(player: PlayerController, dt: number, reducedMotion: boolean): void {
    this.time += dt;
    const st = player.state;
    const speed = player.speed;
    const phase = player.stridePhase * Math.PI;
    const hidden = { x: 0, y: -0.75, z: -0.1, rx: -0.9, ry: 0, rz: 0 };

    const poseFor = (side: number) => {
      const p = { ...hidden, x: side * 0.32 };
      if (st === 'vault') {
        // Hands planted forward/down onto the obstacle.
        const t = player.planT;
        p.x = side * 0.22; p.y = -0.32 - t * 0.15; p.z = -0.12;
        p.rx = -0.75; p.ry = side * 0.12; p.rz = 0;
      } else if (st === 'mantle') {
        const t = player.planT;
        p.x = side * 0.25; p.y = -0.12 - t * 0.35; p.z = -0.1;
        p.rx = -0.35 - t * 0.5; p.ry = side * 0.1;
      } else if (st === 'wallrun' && player.wall) {
        // Outer arm swings, wall-side arm stretched toward the wall.
        const wallSide = player.wall.side;
        if (side === wallSide) {
          p.x = side * 0.42; p.y = -0.12; p.z = -0.05; p.rx = 0.05; p.ry = -side * 0.9; p.rz = side * 0.2;
        } else {
          const sw = Math.sin(phase * 2) * 0.12;
          p.x = side * 0.26; p.y = -0.38 + sw * 0.4; p.z = -0.02 + sw; p.rx = -0.25; p.ry = side * 0.15;
        }
      } else if (st === 'slide') {
        p.x = side * 0.3; p.y = -0.33; p.z = 0.0; p.rx = side > 0 ? -0.2 : -0.55; p.ry = side * 0.25;
      } else if ((st === 'ground' || st === 'air') && player.sprinting && speed > 7) {
        // Sprint arm pump, alternating.
        const sw = Math.sin(phase + (side > 0 ? 0 : Math.PI));
        const amt = reducedMotion ? 0.4 : 1;
        p.x = side * 0.3; p.y = -0.44 + sw * 0.07 * amt; p.z = 0.02 - sw * 0.14 * amt;
        p.rx = -0.4 + sw * 0.35 * amt; p.ry = side * 0.18; p.rz = -side * 0.1;
        if (st === 'air') { p.y = -0.4; p.z = -0.05; p.rx = -0.25; }
      }
      return p;
    };

    for (const [limb, side] of [[this.left, -1], [this.right, 1]] as Array<[Limb, number]>) {
      const target = poseFor(side);
      const rate = st === 'vault' || st === 'mantle' ? 22 : 12;
      limb.x = damp(limb.x, target.x, rate, dt);
      limb.y = damp(limb.y, target.y, rate, dt);
      limb.z = damp(limb.z, target.z, rate, dt);
      limb.rx = damp(limb.rx, target.rx, rate, dt);
      limb.ry = damp(limb.ry, target.ry, rate, dt);
      limb.rz = damp(limb.rz, target.rz, rate, dt);
      limb.root.position.set(limb.x, limb.y, limb.z);
      limb.root.rotation.set(limb.rx, limb.ry, limb.rz);
      limb.root.visible = limb.y > -0.66;
    }

    // Legs during slide.
    const legTarget = st === 'slide' ? 1 : 0;
    this.legsVisible = damp(this.legsVisible, legTarget, 12, dt);
    this.legs.visible = this.legsVisible > 0.05;
    if (this.legs.visible) {
      const k = this.legsVisible;
      this.legs.position.set(0.05, -0.55 - (1 - k) * 0.5, 0.25);
      this.legs.rotation.set(-0.05 - player.pitch * 0.9, 0, 0);
      this.legL.rotation.set(0.05, 0.05, 0);
      this.legR.rotation.set(-0.12, -0.04, 0);
    }
  }
}
